using KeePort.Api.Data;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace KeePort.Api.Services;

/// <summary>
/// Puts e-mails into the outgoing queue in the database. A background worker sends them, so requests never wait for the
/// mail server and failed e-mails are retried.
/// </summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
/// <param name="settings">The SMTP settings.</param>
public sealed class EmailQueue(KeePortDb db, EmailSettingsService settings)
{
    private readonly SemaphoreSlim _signal = new(0);

    /// <summary>Whether e-mails can be sent: SMTP server, sender and web vault address are set.</summary>
    public bool IsConfigured => settings.Get().Configured;

    /// <summary>Renders and queues one e-mail; returns false without queueing when e-mail is not set up.</summary>
    /// <param name="kind">One of <see cref="EmailTemplates.Kinds"/>.</param>
    /// <param name="recipient">The recipient address.</param>
    /// <param name="language">The recipient's language; null gives English.</param>
    /// <param name="values">Placeholder values.</param>
    public bool Enqueue(string kind, string recipient, string? language, IReadOnlyDictionary<string, string> values)
    {
        var current = settings.Get();
        if (!current.Configured)
        {
            return false;
        }
        var email = EmailTemplates.Render(kind, language, current.PublicUrl!, values);
        db.EnqueueEmail(kind, recipient, email.Subject, email.Text, email.Html);
        _signal.Release();
        return true;
    }

    /// <summary>Waits until an e-mail is queued or the timeout passes.</summary>
    /// <param name="timeout">The longest time to wait.</param>
    /// <param name="cancellationToken">Signals that the app is stopping.</param>
    public Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken) => _signal.WaitAsync(timeout, cancellationToken);
}

/// <summary>Sends one e-mail over SMTP with MailKit.</summary>
public static class SmtpMailer
{
    /// <summary>Connects to the SMTP server, signs in if a user is set, and sends one e-mail.</summary>
    /// <param name="settings">The SMTP settings.</param>
    /// <param name="password">The decrypted SMTP password, if any.</param>
    /// <param name="recipient">The recipient address.</param>
    /// <param name="subject">The subject line.</param>
    /// <param name="text">The plain-text body.</param>
    /// <param name="html">The HTML body.</param>
    /// <param name="cancellationToken">A token that cancels the operation.</param>
    public static async Task SendAsync(StoredEmailSettings settings, string? password, string recipient, string subject, string text, string html, CancellationToken cancellationToken)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(settings.FromName ?? "KeePort", settings.FromAddress ?? throw new InvalidOperationException("No sender address is set.")));
        message.To.Add(MailboxAddress.Parse(recipient));
        message.Subject = subject;
        message.Body = new BodyBuilder { TextBody = text, HtmlBody = html }.ToMessageBody();

        using var client = new SmtpClient { Timeout = 30_000 };
        var security = settings.Security switch
        {
            "ssl" => SecureSocketOptions.SslOnConnect,
            "none" => SecureSocketOptions.None,
            _ => SecureSocketOptions.StartTls
        };
        await client.ConnectAsync(settings.Host ?? throw new InvalidOperationException("No SMTP server is set."), settings.Port, security, cancellationToken);
        if (!string.IsNullOrEmpty(settings.Username))
        {
            await client.AuthenticateAsync(settings.Username, password ?? string.Empty, cancellationToken);
        }
        await client.SendAsync(new SendRequest(message), cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }

    /// <summary>Shortens an exception into a message for the admin console, without stack traces.</summary>
    /// <param name="ex">The error.</param>
    public static string Describe(Exception ex)
    {
        var message = ex.GetBaseException().Message;
        return message.Length > 300 ? message[..299] + "…" : message;
    }
}

/// <summary>
/// Sends queued e-mails in the background. Failed e-mails are retried after 1, 5, 15 and 60 minutes and then given up;
/// sent and given-up entries lose their bodies right away and stay in the log for the chosen number of days (30 by default).
/// </summary>
/// <param name="queue">The queue that signals new e-mails.</param>
/// <param name="db">The SQLite store for KeePort metadata.</param>
/// <param name="settings">The SMTP settings.</param>
/// <param name="logger">The container log.</param>
public sealed class EmailWorker(EmailQueue queue, KeePortDb db, EmailSettingsService settings, ILogger<EmailWorker> logger) : BackgroundService
{
    private static readonly TimeSpan[] RetryDelays = [TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(60)];

    /// <summary>Sends due e-mails whenever one is queued, and at least every 30 seconds, until the app stops.</summary>
    /// <param name="stoppingToken">Signals that the app is stopping.</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastPurge = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await queue.WaitAsync(TimeSpan.FromSeconds(30), stoppingToken);
                await SendDueAsync(stoppingToken);
                if (DateTimeOffset.UtcNow - lastPurge > TimeSpan.FromHours(1))
                {
                    db.PurgeEmailOutbox(settings.Get().LogDays);
                    lastPurge = DateTimeOffset.UtcNow;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException)
            {
                logger.LogWarning(ex, "The e-mail queue could not be processed.");
            }
        }
    }

    /// <summary>Sends all due e-mails once; does nothing while e-mail is not set up.</summary>
    /// <param name="cancellationToken">Signals that the app is stopping.</param>
    private async Task SendDueAsync(CancellationToken cancellationToken)
    {
        var current = settings.Get();
        if (!current.Configured)
        {
            return;
        }
        var password = settings.RevealPassword(current);
        foreach (var email in db.ListDueEmails(DateTimeOffset.UtcNow, 20))
        {
            try
            {
                await SmtpMailer.SendAsync(current, password, email.Recipient, email.Subject, email.TextBody, email.HtmlBody, cancellationToken);
                db.MarkEmailSent(email.Id);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                var next = email.Attempts < RetryDelays.Length ? DateTimeOffset.UtcNow + RetryDelays[email.Attempts] : (DateTimeOffset?)null;
                db.MarkEmailFailed(email.Id, SmtpMailer.Describe(ex), next);
                logger.LogWarning("Could not send the {Kind} e-mail (attempt {Attempt}): {Error}", email.Kind, email.Attempts + 1, SmtpMailer.Describe(ex));
            }
        }
    }
}
