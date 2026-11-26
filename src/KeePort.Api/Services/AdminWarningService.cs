using System.Globalization;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>
/// Checks every 10 minutes for situations administrators should know about and e-mails every active administrator with
/// a confirmed address: many failed sign-ins (at most hourly), an admin certificate that expires within 30 days, data
/// outside a host folder (weekly) and low disk space (daily). Each warning can be turned off in the e-mail settings.
/// </summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
/// <param name="queue">The e-mail queue.</param>
/// <param name="settings">The e-mail settings with the warning switches.</param>
/// <param name="server">Server facts such as the admin certificate's expiry.</param>
/// <param name="storage">Where the data lives.</param>
/// <param name="logger">The container log.</param>
public sealed class AdminWarningService(
    KeePortDb db,
    EmailQueue queue,
    EmailSettingsService settings,
    ServerInfo server,
    DataStorageInfo storage,
    ILogger<AdminWarningService> logger) : BackgroundService
{
    /// <summary>Failed sign-ins within this window trigger a warning.</summary>
    public static readonly TimeSpan FailedSignInWindow = TimeSpan.FromMinutes(15);

    /// <summary>How many failed sign-ins within the window trigger a warning.</summary>
    public const int FailedSignInThreshold = 10;

    /// <summary>Runs the checks after a short delay and then every 10 minutes until the app stops.</summary>
    /// <param name="stoppingToken">Signals that the app is stopping.</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
            do
            {
                try
                {
                    CheckOnce(DateTimeOffset.UtcNow);
                }
                catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or InvalidOperationException or UnauthorizedAccessException)
                {
                    logger.LogWarning(ex, "Could not check for admin warnings.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // The app is stopping.
        }
    }

    /// <summary>Runs all checks once and queues the warnings that are due.</summary>
    /// <param name="now">The current time.</param>
    public void CheckOnce(DateTimeOffset now)
    {
        var current = settings.Get();
        if (!current.Configured)
        {
            return;
        }

        if (current.WarnFailedSignIns)
        {
            var failed = db.CountFailedSignInsSince(now - FailedSignInWindow);
            if (failed >= FailedSignInThreshold)
            {
                Warn("failed", TimeSpan.FromHours(1), now, EmailTemplates.Kinds.WarnFailedSignIns, new Dictionary<string, string>
                {
                    ["count"] = failed.ToString(CultureInfo.InvariantCulture),
                    ["minutes"] = ((int)FailedSignInWindow.TotalMinutes).ToString(CultureInfo.InvariantCulture)
                });
            }
        }

        if (current.WarnCertificate && server.AdminCertificateNotAfter is { } notAfter && notAfter - now < TimeSpan.FromDays(30))
        {
            var days = Math.Max(0, (int)Math.Floor((notAfter - now).TotalDays));
            Warn("certificate", TimeSpan.FromDays(7), now, EmailTemplates.Kinds.WarnCertificate, new Dictionary<string, string>
            {
                ["date"] = notAfter.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["days"] = days.ToString(CultureInfo.InvariantCulture)
            });
        }

        if (current.WarnStorage && storage.NeedsAttention)
        {
            Warn("storage", TimeSpan.FromDays(7), now, EmailTemplates.Kinds.WarnStorage, new Dictionary<string, string>());
        }

        if (current.WarnDiskSpace && LowDiskSpace(out var free, out var total))
        {
            Warn("disk", TimeSpan.FromDays(1), now, EmailTemplates.Kinds.WarnDiskSpace, new Dictionary<string, string>
            {
                ["free"] = FormatBytes(free),
                ["total"] = FormatBytes(total)
            });
        }
    }

    /// <summary>Queues a warning for every administrator with a confirmed address, unless it was sent recently.</summary>
    /// <param name="key">The warning's name for the "last sent" record.</param>
    /// <param name="interval">The least time between two warnings of this kind.</param>
    /// <param name="now">The current time.</param>
    /// <param name="kind">The e-mail template.</param>
    /// <param name="values">Placeholder values.</param>
    private void Warn(string key, TimeSpan interval, DateTimeOffset now, string kind, Dictionary<string, string> values)
    {
        var stateKey = "admin_warning_" + key;
        if (DateTimeOffset.TryParse(db.GetState(stateKey), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var last) && now - last < interval)
        {
            return;
        }
        var recipients = db.ListUsers().Where(/* Active admins with a confirmed address. */ u =>
            u.Role == UserRole.Admin && !u.Disabled && u.Email is not null && u.EmailVerifiedAt is not null).ToList();
        if (recipients.Count == 0)
        {
            return;
        }
        foreach (var admin in recipients)
        {
            queue.Enqueue(kind, admin.Email!, admin.Language, values);
        }
        db.SetState(stateKey, now.ToString("O"));
    }

    /// <summary>Reads the disk space where the data is stored; low means under 1 GB or under 5 % free.</summary>
    /// <param name="free">Free bytes.</param>
    /// <param name="total">Total bytes.</param>
    private bool LowDiskSpace(out long free, out long total)
    {
        free = total = 0;
        try
        {
            var drive = new DriveInfo(db.DataDir);
            free = drive.AvailableFreeSpace;
            total = drive.TotalSize;
            return total > 0 && (free < 1024L * 1024 * 1024 || free * 20 < total);
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>Formats a size in GB or MB for an e-mail.</summary>
    /// <param name="bytes">The size in bytes.</param>
    private static string FormatBytes(long bytes) => bytes >= 1024L * 1024 * 1024
        ? (bytes / (1024d * 1024 * 1024)).ToString("0.0", CultureInfo.InvariantCulture) + " GB"
        : (bytes / (1024d * 1024)).ToString("0", CultureInfo.InvariantCulture) + " MB";
}
