using System.Globalization;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>A sign-in that passed the password check and waits for the second factor.</summary>
/// <param name="TokenHash">The SHA-256 of the token the browser holds.</param>
/// <param name="UserId">The account.</param>
/// <param name="Role">The area the sign-in is for (admin console or web vault).</param>
/// <param name="ExpiresAt">When the sign-in has to start over.</param>
/// <param name="Attempts">How many wrong codes were entered.</param>
public sealed record MfaPendingRecord(string TokenHash, string UserId, UserRole Role, DateTimeOffset ExpiresAt, int Attempts);

/// <summary>The stored two-factor secrets of an account; the TOTP secrets are encrypted with Data Protection.</summary>
/// <param name="TotpSecret">The active TOTP secret, encrypted, or null.</param>
/// <param name="TotpPending">A TOTP secret that is being set up and not yet confirmed, encrypted, or null.</param>
/// <param name="TotpLastStep">The last 30-second step a code was accepted for, so a code cannot be used twice.</param>
public sealed record MfaSecrets(string? TotpSecret, string? TotpPending, long TotpLastStep);

/// <summary>Storage for two-factor sign-in: TOTP secrets, e-mail codes, recovery codes and pending sign-ins.</summary>
public sealed partial class KeePortDb
{
    /// <summary>Creates the two-factor tables and user columns; called from schema initialization.</summary>
    /// <param name="connection">An open connection.</param>
    private void EnsureMfaSchema(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
                code_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                used_at TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON mfa_recovery_codes(user_id);

            CREATE TABLE IF NOT EXISTS mfa_pending (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('Admin', 'User')),
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS mfa_email_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mfa_email_codes_user ON mfa_email_codes(user_id, created_at);
            """);
        EnsureColumn("users", "mfa_totp_secret", "TEXT NULL");
        EnsureColumn("users", "mfa_totp_pending", "TEXT NULL");
        EnsureColumn("users", "mfa_totp_last_step", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("users", "mfa_totp_enabled_at", "TEXT NULL");
        EnsureColumn("users", "mfa_email_enabled_at", "TEXT NULL");
    }

    /// <summary>Reads the stored two-factor secrets of an account.</summary>
    /// <param name="userId">The account's ID.</param>
    public MfaSecrets GetMfaSecrets(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT mfa_totp_secret, mfa_totp_pending, mfa_totp_last_step FROM users WHERE id = @id;";
        command.Parameters.AddWithValue("@id", userId);
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new MfaSecrets(reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetInt64(2))
            : new MfaSecrets(null, null, 0);
    }

    /// <summary>Stores a TOTP secret that is being set up; it becomes active only after a correct code.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="protectedSecret">The encrypted secret, or null to cancel the setup.</param>
    public void SetPendingTotp(string userId, string? protectedSecret)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET mfa_totp_pending = @secret WHERE id = @id;",
            new SqliteParameter("@secret", DbValue(protectedSecret)), new SqliteParameter("@id", userId));
    }

    /// <summary>Turns on TOTP with the confirmed secret and remembers the step of the code that confirmed it.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="protectedSecret">The encrypted secret.</param>
    /// <param name="step">The 30-second step of the confirming code.</param>
    public void EnableTotp(string userId, string protectedSecret, long step)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            UPDATE users SET mfa_totp_secret = @secret, mfa_totp_pending = NULL, mfa_totp_last_step = @step, mfa_totp_enabled_at = @now
            WHERE id = @id;
            """,
            new SqliteParameter("@secret", protectedSecret), new SqliteParameter("@step", step),
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@id", userId));
    }

    /// <summary>
    /// Records the step of an accepted TOTP code, but only if it is newer than the last one. Returns false when the
    /// step was already used, so a code cannot be used twice even by two requests at the same moment.
    /// </summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="step">The 30-second step of the accepted code.</param>
    public bool TryUseTotpStep(string userId, long step)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE users SET mfa_totp_last_step = @step WHERE id = @id AND mfa_totp_last_step < @step;";
        command.Parameters.AddWithValue("@step", step);
        command.Parameters.AddWithValue("@id", userId);
        return command.ExecuteNonQuery() == 1;
    }

    /// <summary>Turns off TOTP and removes its secrets.</summary>
    /// <param name="userId">The account's ID.</param>
    public void DisableTotp(string userId)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET mfa_totp_secret = NULL, mfa_totp_pending = NULL, mfa_totp_enabled_at = NULL WHERE id = @id;",
            new SqliteParameter("@id", userId));
    }

    /// <summary>Turns e-mail codes as second factor on or off.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="enabled">Whether e-mail codes are on.</param>
    public void SetEmailMfa(string userId, bool enabled)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE users SET mfa_email_enabled_at = @value WHERE id = @id;",
            new SqliteParameter("@value", enabled ? DateTimeOffset.UtcNow.ToString("O") : DBNull.Value), new SqliteParameter("@id", userId));
    }

    /// <summary>Turns off every second factor of an account and removes recovery codes, e-mail codes and pending sign-ins.</summary>
    /// <param name="userId">The account's ID.</param>
    public void ResetMfa(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        var id = new SqliteParameter("@id", userId);
        Execute(connection, transaction, """
            UPDATE users SET mfa_totp_secret = NULL, mfa_totp_pending = NULL, mfa_totp_enabled_at = NULL, mfa_email_enabled_at = NULL
            WHERE id = @id;
            """, id);
        Execute(connection, transaction, "DELETE FROM mfa_recovery_codes WHERE user_id = @id;", new SqliteParameter("@id", userId));
        Execute(connection, transaction, "DELETE FROM mfa_email_codes WHERE user_id = @id;", new SqliteParameter("@id", userId));
        Execute(connection, transaction, "DELETE FROM mfa_pending WHERE user_id = @id;", new SqliteParameter("@id", userId));
        transaction.Commit();
    }

    /// <summary>Replaces all recovery codes of an account with new ones (stored as hashes).</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="codeHashes">The hashes of the new codes; empty removes all codes.</param>
    public void ReplaceRecoveryCodes(string userId, IEnumerable<string> codeHashes)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, "DELETE FROM mfa_recovery_codes WHERE user_id = @id;", new SqliteParameter("@id", userId));
        var now = DateTimeOffset.UtcNow.ToString("O");
        foreach (var hash in codeHashes)
        {
            Execute(connection, transaction, "INSERT INTO mfa_recovery_codes (code_hash, user_id, created_at) VALUES (@hash, @id, @now);",
                new SqliteParameter("@hash", hash), new SqliteParameter("@id", userId), new SqliteParameter("@now", now));
        }
        transaction.Commit();
    }

    /// <summary>Counts the unused recovery codes of an account.</summary>
    /// <param name="userId">The account's ID.</param>
    public int CountRecoveryCodes(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = @id AND used_at IS NULL;";
        command.Parameters.AddWithValue("@id", userId);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Uses up an unused recovery code; returns false when the account has no such unused code.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="codeHash">The hash of the entered code.</param>
    public bool TryUseRecoveryCode(string userId, string codeHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE mfa_recovery_codes SET used_at = @now WHERE user_id = @id AND code_hash = @hash AND used_at IS NULL;";
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("@id", userId);
        command.Parameters.AddWithValue("@hash", codeHash);
        return command.ExecuteNonQuery() == 1;
    }

    /// <summary>Stores a pending sign-in and removes expired ones.</summary>
    /// <param name="tokenHash">The SHA-256 of the token.</param>
    /// <param name="userId">The account's ID.</param>
    /// <param name="role">The area of the sign-in.</param>
    /// <param name="expiresAt">When it expires.</param>
    public void CreateMfaPending(string tokenHash, string userId, UserRole role, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM mfa_pending WHERE expires_at < @now;", new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")));
        Execute(connection, """
            INSERT INTO mfa_pending (token_hash, user_id, role, created_at, expires_at) VALUES (@hash, @userId, @role, @now, @expires);
            """,
            new SqliteParameter("@hash", tokenHash), new SqliteParameter("@userId", userId), new SqliteParameter("@role", role.ToString()),
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@expires", expiresAt.ToUniversalTime().ToString("O")));
    }

    /// <summary>Finds an unexpired pending sign-in by its token hash.</summary>
    /// <param name="tokenHash">The SHA-256 of the token.</param>
    public MfaPendingRecord? FindMfaPending(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT token_hash, user_id, role, expires_at, attempts FROM mfa_pending WHERE token_hash = @hash AND expires_at > @now;";
        command.Parameters.AddWithValue("@hash", tokenHash);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new MfaPendingRecord(reader.GetString(0), reader.GetString(1), Enum.Parse<UserRole>(reader.GetString(2)), ParseDate(reader.GetString(3)), reader.GetInt32(4))
            : null;
    }

    /// <summary>Counts a wrong code against a pending sign-in and returns the new number of attempts.</summary>
    /// <param name="tokenHash">The SHA-256 of the token.</param>
    public int CountMfaAttempt(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE mfa_pending SET attempts = attempts + 1 WHERE token_hash = @hash RETURNING attempts;";
        command.Parameters.AddWithValue("@hash", tokenHash);
        return Convert.ToInt32(command.ExecuteScalar() ?? 0, CultureInfo.InvariantCulture);
    }

    /// <summary>Removes a pending sign-in, after it succeeded or failed too often.</summary>
    /// <param name="tokenHash">The SHA-256 of the token.</param>
    public void DeleteMfaPending(string tokenHash)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM mfa_pending WHERE token_hash = @hash;", new SqliteParameter("@hash", tokenHash));
    }

    /// <summary>Stores a new sign-in code sent by e-mail; older unused codes of the account stop working.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="codeHash">The hash of the code.</param>
    /// <param name="expiresAt">When the code expires.</param>
    public void CreateMfaEmailCode(string userId, string codeHash, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        var now = DateTimeOffset.UtcNow;
        Execute(connection, transaction, "UPDATE mfa_email_codes SET used_at = @now WHERE user_id = @id AND used_at IS NULL;",
            new SqliteParameter("@now", now.ToString("O")), new SqliteParameter("@id", userId));
        Execute(connection, transaction, "DELETE FROM mfa_email_codes WHERE created_at < @old;",
            new SqliteParameter("@old", now.AddDays(-1).ToString("O")));
        Execute(connection, transaction, "INSERT INTO mfa_email_codes (user_id, code_hash, created_at, expires_at) VALUES (@id, @hash, @now, @expires);",
            new SqliteParameter("@id", userId), new SqliteParameter("@hash", codeHash), new SqliteParameter("@now", now.ToString("O")),
            new SqliteParameter("@expires", expiresAt.ToUniversalTime().ToString("O")));
        transaction.Commit();
    }

    /// <summary>Uses up the account's current e-mail sign-in code if it matches and has not expired.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="codeHash">The hash of the entered code.</param>
    public bool TryUseMfaEmailCode(string userId, string codeHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE mfa_email_codes SET used_at = @now
            WHERE user_id = @id AND code_hash = @hash AND used_at IS NULL AND expires_at > @now;
            """;
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("@id", userId);
        command.Parameters.AddWithValue("@hash", codeHash);
        return command.ExecuteNonQuery() == 1;
    }

    /// <summary>Counts the e-mail sign-in codes sent to an account since a time, for throttling.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="since">The start of the window.</param>
    public int CountMfaEmailCodes(string userId, DateTimeOffset since)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM mfa_email_codes WHERE user_id = @id AND created_at >= @since;";
        command.Parameters.AddWithValue("@id", userId);
        command.Parameters.AddWithValue("@since", since.ToUniversalTime().ToString("O"));
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }
}
