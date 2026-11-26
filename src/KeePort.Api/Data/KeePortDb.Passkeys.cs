using System.Globalization;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>A stored passkey (WebAuthn credential) of an account.</summary>
/// <param name="Id">KeePort's ID of the passkey.</param>
/// <param name="UserId">The account.</param>
/// <param name="CredentialId">The authenticator's credential ID, Base64url.</param>
/// <param name="PublicKey">The COSE public key.</param>
/// <param name="SignCount">The last signature counter.</param>
/// <param name="RpId">The domain the passkey was created for.</param>
/// <param name="Name">The name the user gave it.</param>
/// <param name="CreatedAt">When it was added.</param>
/// <param name="LastUsedAt">When it was last used to sign in.</param>
public sealed record PasskeyRecord(string Id, string UserId, string CredentialId, byte[] PublicKey, uint SignCount, string RpId, string Name, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

/// <summary>A WebAuthn ceremony that was started and waits for the browser's answer.</summary>
/// <param name="Purpose">register, login or mfa.</param>
/// <param name="UserId">The account, or null for a sign-in without username.</param>
/// <param name="Role">The area (admin console or web vault).</param>
/// <param name="OptionsJson">The options sent to the browser, needed to check the answer.</param>
public sealed record PasskeyChallengeRecord(string Purpose, string? UserId, UserRole Role, string OptionsJson);

/// <summary>Storage for passkeys and their pending ceremonies.</summary>
public sealed partial class KeePortDb
{
    /// <summary>Creates the passkey tables; called from schema initialization.</summary>
    /// <param name="connection">An open connection.</param>
    private void EnsurePasskeySchema(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS webauthn_credentials (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                credential_id TEXT NOT NULL UNIQUE,
                public_key BLOB NOT NULL,
                sign_count INTEGER NOT NULL DEFAULT 0,
                rp_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);

            CREATE TABLE IF NOT EXISTS webauthn_challenges (
                id_hash TEXT PRIMARY KEY,
                purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'mfa')),
                user_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('Admin', 'User')),
                options TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            """);
    }

    /// <summary>Lists the passkeys of an account, oldest first.</summary>
    /// <param name="userId">The account's ID.</param>
    public IReadOnlyList<PasskeyRecord> ListPasskeys(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"{PasskeySelect} WHERE user_id = @userId ORDER BY created_at;";
        command.Parameters.AddWithValue("@userId", userId);
        using var reader = command.ExecuteReader();
        var passkeys = new List<PasskeyRecord>();
        while (reader.Read())
        {
            passkeys.Add(ReadPasskey(reader));
        }
        return passkeys;
    }

    /// <summary>Counts the passkeys of an account.</summary>
    /// <param name="userId">The account's ID.</param>
    public int CountPasskeys(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = @userId;";
        command.Parameters.AddWithValue("@userId", userId);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Finds a passkey by the authenticator's credential ID.</summary>
    /// <param name="credentialId">The credential ID, Base64url.</param>
    public PasskeyRecord? FindPasskeyByCredentialId(string credentialId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"{PasskeySelect} WHERE credential_id = @credentialId;";
        command.Parameters.AddWithValue("@credentialId", credentialId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadPasskey(reader) : null;
    }

    /// <summary>Stores a new passkey.</summary>
    /// <param name="passkey">The passkey.</param>
    public void AddPasskey(PasskeyRecord passkey)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, sign_count, rp_id, name, created_at)
            VALUES (@id, @userId, @credentialId, @publicKey, @signCount, @rpId, @name, @createdAt);
            """,
            new SqliteParameter("@id", passkey.Id), new SqliteParameter("@userId", passkey.UserId),
            new SqliteParameter("@credentialId", passkey.CredentialId), new SqliteParameter("@publicKey", passkey.PublicKey),
            new SqliteParameter("@signCount", (long)passkey.SignCount), new SqliteParameter("@rpId", passkey.RpId),
            new SqliteParameter("@name", passkey.Name), new SqliteParameter("@createdAt", passkey.CreatedAt.ToString("O")));
    }

    /// <summary>Records a sign-in with a passkey: the new signature counter and the time.</summary>
    /// <param name="id">KeePort's ID of the passkey.</param>
    /// <param name="signCount">The new signature counter.</param>
    public void TouchPasskey(string id, uint signCount)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE webauthn_credentials SET sign_count = @signCount, last_used_at = @now WHERE id = @id;",
            new SqliteParameter("@signCount", (long)signCount), new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")), new SqliteParameter("@id", id));
    }

    /// <summary>Removes one passkey of an account; returns whether it existed.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="id">KeePort's ID of the passkey.</param>
    public bool DeletePasskey(string userId, string id)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM webauthn_credentials WHERE id = @id AND user_id = @userId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@userId", userId);
        return command.ExecuteNonQuery() == 1;
    }

    /// <summary>Stores a started WebAuthn ceremony and removes expired ones.</summary>
    /// <param name="idHash">The SHA-256 of the ceremony's ID.</param>
    /// <param name="challenge">The ceremony.</param>
    /// <param name="expiresAt">When it expires.</param>
    public void CreatePasskeyChallenge(string idHash, PasskeyChallengeRecord challenge, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM webauthn_challenges WHERE expires_at < @now;", new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")));
        Execute(connection, """
            INSERT INTO webauthn_challenges (id_hash, purpose, user_id, role, options, expires_at) VALUES (@hash, @purpose, @userId, @role, @options, @expires);
            """,
            new SqliteParameter("@hash", idHash), new SqliteParameter("@purpose", challenge.Purpose), new SqliteParameter("@userId", DbValue(challenge.UserId)),
            new SqliteParameter("@role", challenge.Role.ToString()), new SqliteParameter("@options", challenge.OptionsJson),
            new SqliteParameter("@expires", expiresAt.ToUniversalTime().ToString("O")));
    }

    /// <summary>Takes a started ceremony out of storage, so it can be answered only once; null when unknown or expired.</summary>
    /// <param name="idHash">The SHA-256 of the ceremony's ID.</param>
    public PasskeyChallengeRecord? TakePasskeyChallenge(string idHash)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM webauthn_challenges WHERE id_hash = @hash AND expires_at > @now RETURNING purpose, user_id, role, options;";
        command.Parameters.AddWithValue("@hash", idHash);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? new PasskeyChallengeRecord(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), Enum.Parse<UserRole>(reader.GetString(2)), reader.GetString(3))
            : null;
    }

    private const string PasskeySelect = "SELECT id, user_id, credential_id, public_key, sign_count, rp_id, name, created_at, last_used_at FROM webauthn_credentials";

    /// <summary>Reads a passkey from the current row.</summary>
    /// <param name="reader">The reader positioned on the row.</param>
    private static PasskeyRecord ReadPasskey(SqliteDataReader reader) => new(
        reader.GetString(0), reader.GetString(1), reader.GetString(2), (byte[])reader[3], (uint)reader.GetInt64(4), reader.GetString(5),
        reader.GetString(6), ParseDate(reader.GetString(7)), reader.IsDBNull(8) ? null : ParseDate(reader.GetString(8)));
}
