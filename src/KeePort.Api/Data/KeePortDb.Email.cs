using System.Globalization;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>Storage for e-mail: settings, the outgoing queue, one-time account tokens and per-user e-mail preferences.</summary>
public sealed partial class KeePortDb
{
    /// <summary>Creates the e-mail tables and user columns; called from schema initialization.</summary>
    /// <param name="connection">An open connection.</param>
    private void EnsureEmailSchema(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS email_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                recipient TEXT NOT NULL,
                subject TEXT NOT NULL,
                text_body TEXT NULL,
                html_body TEXT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NOT NULL,
                sent_at TEXT NULL,
                failed_at TEXT NULL,
                last_error TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(sent_at, failed_at, next_attempt_at);

            CREATE TABLE IF NOT EXISTS account_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset', 'verify')),
                email TEXT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                used_at TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, purpose);
            """);
        EnsureColumn("users", "email_verified_at", "TEXT NULL");
        EnsureColumn("users", "notify_sign_in", "INTEGER NOT NULL DEFAULT 1");
        EnsureColumn("users", "notify_app_password", "INTEGER NOT NULL DEFAULT 1");
    }

    /// <summary>Reads a text value from app_state, or null when it is not set.</summary>
    /// <param name="key">The app_state key.</param>
    public string? GetState(string key)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = @key;";
        command.Parameters.AddWithValue("@key", key);
        return command.ExecuteScalar() as string;
    }

    /// <summary>Stores a text value in app_state; null removes it.</summary>
    /// <param name="key">The app_state key.</param>
    /// <param name="value">The value, or null to remove it.</param>
    public void SetState(string key, string? value)
    {
        using var connection = Open();
        connection.Open();
        if (value is null)
        {
            Execute(connection, "DELETE FROM app_state WHERE key = @key;", new SqliteParameter("@key", key));
            return;
        }
        Execute(connection, """
            INSERT INTO app_state (key, value) VALUES (@key, @value)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """, new SqliteParameter("@key", key), new SqliteParameter("@value", value));
    }

    /// <summary>Queues one rendered e-mail for sending and returns its ID.</summary>
    /// <param name="kind">The template name, e.g. "verify" or "invite", for the admin status.</param>
    /// <param name="recipient">The recipient address.</param>
    /// <param name="subject">The subject line.</param>
    /// <param name="textBody">The plain-text body.</param>
    /// <param name="htmlBody">The HTML body.</param>
    public long EnqueueEmail(string kind, string recipient, string subject, string textBody, string htmlBody)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO email_outbox (created_at, kind, recipient, subject, text_body, html_body, next_attempt_at)
            VALUES (@now, @kind, @recipient, @subject, @text, @html, @now);
            SELECT last_insert_rowid();
            """;
        var now = DateTimeOffset.UtcNow.ToString("O");
        command.Parameters.AddWithValue("@now", now);
        command.Parameters.AddWithValue("@kind", kind);
        command.Parameters.AddWithValue("@recipient", recipient);
        command.Parameters.AddWithValue("@subject", subject);
        command.Parameters.AddWithValue("@text", textBody);
        command.Parameters.AddWithValue("@html", htmlBody);
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Lists queued e-mails that are due for a (re)try, oldest first.</summary>
    /// <param name="now">The current time.</param>
    /// <param name="limit">The most e-mails to return.</param>
    public IReadOnlyList<OutboxEmail> ListDueEmails(DateTimeOffset now, int limit)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, kind, recipient, subject, text_body, html_body, attempts
            FROM email_outbox
            WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= @now
            ORDER BY id LIMIT @limit;
            """;
        command.Parameters.AddWithValue("@now", now.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue("@limit", limit);
        using var reader = command.ExecuteReader();
        var emails = new List<OutboxEmail>();
        while (reader.Read())
        {
            emails.Add(new OutboxEmail(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? string.Empty : reader.GetString(4), reader.IsDBNull(5) ? string.Empty : reader.GetString(5), reader.GetInt32(6)));
        }
        return emails;
    }

    /// <summary>Marks an e-mail as sent and removes its bodies, so no codes or links stay in the database.</summary>
    /// <param name="id">The e-mail's ID.</param>
    public void MarkEmailSent(long id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE email_outbox SET sent_at = @now, text_body = NULL, html_body = NULL, last_error = NULL WHERE id = @id;",
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@id", id));
    }

    /// <summary>Records a failed attempt; after the last attempt the e-mail is given up and its bodies are removed.</summary>
    /// <param name="id">The e-mail's ID.</param>
    /// <param name="error">A short description of the error.</param>
    /// <param name="nextAttempt">When to try again, or null to give up.</param>
    public void MarkEmailFailed(long id, string error, DateTimeOffset? nextAttempt)
    {
        using var connection = Open();
        connection.Open();
        if (nextAttempt is { } next)
        {
            Execute(connection, "UPDATE email_outbox SET attempts = attempts + 1, last_error = @error, next_attempt_at = @next WHERE id = @id;",
                new SqliteParameter("@error", error), new SqliteParameter("@next", next.ToUniversalTime().ToString("O")), new SqliteParameter("@id", id));
        }
        else
        {
            Execute(connection, "UPDATE email_outbox SET attempts = attempts + 1, last_error = @error, failed_at = @now, text_body = NULL, html_body = NULL WHERE id = @id;",
                new SqliteParameter("@error", error), new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@id", id));
        }
    }

    /// <summary>Removes queue entries that were sent or given up more than a number of days ago.</summary>
    /// <param name="days">How many days finished entries are kept for the status display.</param>
    public void PurgeEmailOutbox(int days)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM email_outbox WHERE COALESCE(sent_at, failed_at) < @cutoff;",
            new SqliteParameter("@cutoff", DateTimeOffset.UtcNow.AddDays(-days).ToString("O")));
    }

    /// <summary>Summarises the queue for the admin console: waiting, sent and failed in 7 days, last error.</summary>
    public EmailQueueStatusDto GetEmailQueueStatus()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                COALESCE(SUM(sent_at IS NULL AND failed_at IS NULL), 0),
                COALESCE(SUM(sent_at >= @week), 0),
                COALESCE(SUM(failed_at >= @week), 0),
                MAX(sent_at),
                (SELECT last_error FROM email_outbox WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1)
            FROM email_outbox;
            """;
        command.Parameters.AddWithValue("@week", DateTimeOffset.UtcNow.AddDays(-7).ToString("O"));
        using var reader = command.ExecuteReader();
        reader.Read();
        return new EmailQueueStatusDto(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2),
            reader.IsDBNull(3) ? null : ParseDate(reader.GetString(3)), reader.IsDBNull(4) ? null : reader.GetString(4));
    }

    /// <summary>Reads the newest queued e-mail of a kind to an address; used by tests to read codes and links.</summary>
    /// <param name="recipient">The recipient address.</param>
    /// <param name="kind">The template name.</param>
    public OutboxEmail? GetLatestEmail(string recipient, string kind)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, kind, recipient, subject, text_body, html_body, attempts FROM email_outbox
            WHERE recipient = @recipient AND kind = @kind ORDER BY id DESC LIMIT 1;
            """;
        command.Parameters.AddWithValue("@recipient", recipient);
        command.Parameters.AddWithValue("@kind", kind);
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new OutboxEmail(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? string.Empty : reader.GetString(4), reader.IsDBNull(5) ? string.Empty : reader.GetString(5), reader.GetInt32(6))
            : null;
    }

    /// <summary>Stores a one-time token (as its hash) and invalidates older unused tokens of the same purpose for the user.</summary>
    /// <param name="tokenHash">The SHA-256 of the token or code.</param>
    /// <param name="userId">The account the token belongs to.</param>
    /// <param name="purpose">invite, reset or verify.</param>
    /// <param name="email">The address the token was sent to.</param>
    /// <param name="expiresAt">When the token stops working.</param>
    public void CreateAccountToken(string tokenHash, string userId, string purpose, string? email, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, "DELETE FROM account_tokens WHERE user_id = @userId AND purpose = @purpose AND used_at IS NULL;",
            new SqliteParameter("@userId", userId), new SqliteParameter("@purpose", purpose));
        Execute(connection, transaction, """
            INSERT INTO account_tokens (token_hash, user_id, purpose, email, created_at, expires_at)
            VALUES (@hash, @userId, @purpose, @email, @now, @expires);
            """,
            new SqliteParameter("@hash", tokenHash), new SqliteParameter("@userId", userId), new SqliteParameter("@purpose", purpose),
            new SqliteParameter("@email", DbValue(email)), new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")),
            new SqliteParameter("@expires", expiresAt.ToUniversalTime().ToString("O")));
        Execute(connection, transaction, "DELETE FROM account_tokens WHERE expires_at < @old;",
            new SqliteParameter("@old", DateTimeOffset.UtcNow.AddDays(-7).ToString("O")));
        transaction.Commit();
    }

    /// <summary>Finds an unused, unexpired token by its hash.</summary>
    /// <param name="tokenHash">The SHA-256 of the token.</param>
    /// <param name="purpose">The expected purpose.</param>
    public AccountTokenRecord? FindAccountToken(string tokenHash, string purpose)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT token_hash, user_id, purpose, email, expires_at, attempts FROM account_tokens
            WHERE token_hash = @hash AND purpose = @purpose AND used_at IS NULL AND expires_at > @now;
            """;
        command.Parameters.AddWithValue("@hash", tokenHash);
        command.Parameters.AddWithValue("@purpose", purpose);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new AccountTokenRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), ParseDate(reader.GetString(4)), reader.GetInt32(5))
            : null;
    }

    /// <summary>Finds the user's current unused verification code entry, if any.</summary>
    /// <param name="userId">The account's ID.</param>
    public AccountTokenRecord? FindVerificationCode(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT token_hash, user_id, purpose, email, expires_at, attempts FROM account_tokens
            WHERE user_id = @userId AND purpose = 'verify' AND used_at IS NULL AND expires_at > @now
            ORDER BY created_at DESC LIMIT 1;
            """;
        command.Parameters.AddWithValue("@userId", userId);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new AccountTokenRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), ParseDate(reader.GetString(4)), reader.GetInt32(5))
            : null;
    }

    /// <summary>Counts how many tokens of a purpose were created for a user since a time, for throttling.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="purpose">The purpose.</param>
    /// <param name="since">The start of the window.</param>
    public int CountAccountTokens(string userId, string purpose, DateTimeOffset since)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM account_tokens WHERE user_id = @userId AND purpose = @purpose AND created_at >= @since;";
        command.Parameters.AddWithValue("@userId", userId);
        command.Parameters.AddWithValue("@purpose", purpose);
        command.Parameters.AddWithValue("@since", since.ToUniversalTime().ToString("O"));
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Counts a wrong attempt against a token.</summary>
    /// <param name="tokenHash">The token's hash.</param>
    public void CountAccountTokenAttempt(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE account_tokens SET attempts = attempts + 1 WHERE token_hash = @hash;", new SqliteParameter("@hash", tokenHash));
    }

    /// <summary>Marks a token as used so it cannot be used again.</summary>
    /// <param name="tokenHash">The token's hash.</param>
    public void UseAccountToken(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE account_tokens SET used_at = @now WHERE token_hash = @hash;",
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@hash", tokenHash));
    }

    /// <summary>Removes all unused tokens of a user, e.g. after the e-mail address changed.</summary>
    /// <param name="userId">The account's ID.</param>
    public void DeleteAccountTokens(string userId)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM account_tokens WHERE user_id = @userId AND used_at IS NULL;", new SqliteParameter("@userId", userId));
    }

    /// <summary>Stores when the account's e-mail address was confirmed; null marks it unconfirmed.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="verifiedAt">The time of confirmation, or null.</param>
    public void SetEmailVerified(string userId, DateTimeOffset? verifiedAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET email_verified_at = @value WHERE id = @id;",
            new SqliteParameter("@value", DbValue(verifiedAt?.ToUniversalTime().ToString("O"))), new SqliteParameter("@id", userId));
    }

    /// <summary>Stores which security notifications the account receives by e-mail.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="signIn">Notify about sign-ins from a new browser or device.</param>
    /// <param name="appPassword">Notify about new WebDAV app passwords.</param>
    public void SetEmailNotifications(string userId, bool signIn, bool appPassword)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET notify_sign_in = @signIn, notify_app_password = @appPassword WHERE id = @id;",
            new SqliteParameter("@signIn", signIn ? 1 : 0), new SqliteParameter("@appPassword", appPassword ? 1 : 0), new SqliteParameter("@id", userId));
    }

    /// <summary>Checks whether the account signed in successfully with this browser before, within a number of days.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="userAgent">The stored, shortened user agent.</param>
    /// <param name="days">How far back to look.</param>
    public bool HasSignedInWith(string userId, string? userAgent, int days)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM audit_log
            WHERE actor_id = @userId AND action = 'LoginSucceeded' AND user_agent IS @ua AND occurred_at >= @since;
            """;
        command.Parameters.AddWithValue("@userId", userId);
        command.Parameters.AddWithValue("@ua", (object?)userAgent ?? DBNull.Value);
        command.Parameters.AddWithValue("@since", DateTimeOffset.UtcNow.AddDays(-days).ToString("O"));
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture) > 0;
    }

    /// <summary>Counts failed sign-ins in the audit log since a time.</summary>
    /// <param name="since">The start of the window.</param>
    public long CountFailedSignInsSince(DateTimeOffset since)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM audit_log WHERE action = 'LoginFailed' AND occurred_at >= @since;";
        command.Parameters.AddWithValue("@since", since.ToUniversalTime().ToString("O"));
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }
}
