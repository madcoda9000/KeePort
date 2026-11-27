using System.Globalization;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>
/// A shared secret as stored on the server: only ciphertext and metadata. The key is in the link's fragment and never
/// reaches the server; the server keeps a hash of a proof derived from it.
/// </summary>
public sealed record ShareRecord
{
    public required string Id { get; init; }
    public required string OwnerUserId { get; init; }
    /// <summary>The owner's username, joined from the users table.</summary>
    public required string OwnerName { get; init; }
    public string? VaultFileId { get; init; }
    /// <summary>The vault's current name, joined from vault_files.</summary>
    public string? VaultName { get; init; }
    public string? EntryUuid { get; init; }
    public required string Label { get; init; }
    public string? Ciphertext { get; init; }
    public string? Iv { get; init; }
    public required string KdfSalt { get; init; }
    public string? KdfParams { get; init; }
    public required string ProofHash { get; init; }
    public string? RecipientEmail { get; init; }
    public bool RequireEmailCode { get; init; }
    public bool SentByEmail { get; init; }
    public required int MaxViews { get; init; }
    public int ViewCount { get; init; }
    public int FailedAttempts { get; init; }
    public string? CodeHash { get; init; }
    public DateTimeOffset? CodeExpiresAt { get; init; }
    public DateTimeOffset? CodeSentAt { get; init; }
    public int CodesSent { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public DateTimeOffset? RevokedAt { get; init; }
    public DateTimeOffset? LastViewedAt { get; init; }
    public DateTimeOffset? EndedAt { get; init; }
    /// <summary>Why the ciphertext was removed: used, expired, revoked or locked; null while it is still there.</summary>
    public string? EndReason { get; init; }

    /// <summary>Whether the secret can still be revealed at the given time.</summary>
    /// <param name="now">The current time.</param>
    public bool IsActive(DateTimeOffset now) => Ciphertext is not null && RevokedAt is null && ExpiresAt > now && ViewCount < MaxViews;
}

/// <summary>What is stored when a share is created.</summary>
/// <param name="Id">The random ID used in the link.</param>
/// <param name="OwnerUserId">The account that shares.</param>
/// <param name="VaultFileId">The vault the entry comes from.</param>
/// <param name="EntryUuid">The entry's UUID in the vault.</param>
/// <param name="Label">The label the owner typed; the only readable text.</param>
/// <param name="Ciphertext">The encrypted secret, Base64.</param>
/// <param name="Iv">The AES-GCM nonce, Base64.</param>
/// <param name="KdfSalt">The salt of the key derivation, Base64.</param>
/// <param name="KdfParams">The Argon2 parameters when a recipient password is used, otherwise null.</param>
/// <param name="ProofHash">The SHA-256 hash of the access proof.</param>
/// <param name="RecipientEmail">The recipient's address, for sending the link or a code.</param>
/// <param name="RequireEmailCode">Whether the recipient must enter a code sent to that address.</param>
/// <param name="MaxViews">How often the secret can be revealed.</param>
/// <param name="ExpiresAt">When the share ends.</param>
public sealed record NewShare(
    string Id,
    string OwnerUserId,
    string VaultFileId,
    string EntryUuid,
    string Label,
    string Ciphertext,
    string Iv,
    string KdfSalt,
    string? KdfParams,
    string ProofHash,
    string? RecipientEmail,
    bool RequireEmailCode,
    int MaxViews,
    DateTimeOffset ExpiresAt);

/// <summary>Storage for shared secrets, the per-user sharing overrides and the vaults that may not be shared from.</summary>
public sealed partial class KeePortDb
{
    private const string ShareColumns = """
        s.id, s.owner_user_id, u.username, s.vault_file_id, f.name, s.entry_uuid, s.label, s.ciphertext, s.iv, s.kdf_salt,
        s.kdf_params, s.proof_hash, s.recipient_email, s.require_email_code, s.sent_by_email, s.max_views, s.view_count,
        s.failed_attempts, s.code_hash, s.code_expires_at, s.code_sent_at, s.codes_sent, s.created_at, s.expires_at,
        s.revoked_at, s.last_viewed_at, s.ended_at, s.end_reason
        """;

    private const string ShareFrom = "FROM shares s JOIN users u ON u.id = s.owner_user_id LEFT JOIN vault_files f ON f.id = s.vault_file_id";

    /// <summary>Creates the sharing tables; called from schema initialization.</summary>
    /// <param name="connection">An open connection.</param>
    private void EnsureShareSchema(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS shares (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                vault_file_id TEXT NULL,
                entry_uuid TEXT NULL,
                label TEXT NOT NULL,
                ciphertext TEXT NULL,
                iv TEXT NULL,
                kdf_salt TEXT NOT NULL,
                kdf_params TEXT NULL,
                proof_hash TEXT NOT NULL,
                recipient_email TEXT NULL,
                require_email_code INTEGER NOT NULL DEFAULT 0,
                sent_by_email INTEGER NOT NULL DEFAULT 0,
                max_views INTEGER NOT NULL,
                view_count INTEGER NOT NULL DEFAULT 0,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                code_hash TEXT NULL,
                code_expires_at TEXT NULL,
                code_sent_at TEXT NULL,
                codes_sent INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT NULL,
                last_viewed_at TEXT NULL,
                ended_at TEXT NULL,
                end_reason TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);

            CREATE TABLE IF NOT EXISTS share_user_overrides (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                mode TEXT NOT NULL CHECK (mode IN ('allowed', 'blocked'))
            );

            CREATE TABLE IF NOT EXISTS share_vault_blocks (
                vault_file_id TEXT PRIMARY KEY
            );
            """);
    }

    /// <summary>Stores a new share.</summary>
    /// <param name="share">The share to store.</param>
    public void CreateShare(NewShare share)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO shares (id, owner_user_id, vault_file_id, entry_uuid, label, ciphertext, iv, kdf_salt, kdf_params, proof_hash,
                recipient_email, require_email_code, max_views, created_at, expires_at)
            VALUES (@id, @owner, @vault, @entry, @label, @ciphertext, @iv, @salt, @params, @proof, @email, @code, @max, @now, @expires);
            """,
            new SqliteParameter("@id", share.Id),
            new SqliteParameter("@owner", share.OwnerUserId),
            new SqliteParameter("@vault", share.VaultFileId),
            new SqliteParameter("@entry", share.EntryUuid),
            new SqliteParameter("@label", share.Label),
            new SqliteParameter("@ciphertext", share.Ciphertext),
            new SqliteParameter("@iv", share.Iv),
            new SqliteParameter("@salt", share.KdfSalt),
            new SqliteParameter("@params", (object?)share.KdfParams ?? DBNull.Value),
            new SqliteParameter("@proof", share.ProofHash),
            new SqliteParameter("@email", (object?)share.RecipientEmail ?? DBNull.Value),
            new SqliteParameter("@code", share.RequireEmailCode ? 1 : 0),
            new SqliteParameter("@max", share.MaxViews),
            new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")),
            new SqliteParameter("@expires", share.ExpiresAt.ToString("O")));
    }

    /// <summary>Reads one share, or null when it does not exist.</summary>
    /// <param name="id">The share's ID.</param>
    public ShareRecord? GetShare(string id)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {ShareColumns} {ShareFrom} WHERE s.id = @id;";
        command.Parameters.AddWithValue("@id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadShare(reader) : null;
    }

    /// <summary>Lists shares, newest first: those of one owner, or all of them.</summary>
    /// <param name="ownerUserId">The owner, or null for every share.</param>
    public IReadOnlyList<ShareRecord> ListShares(string? ownerUserId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {ShareColumns} {ShareFrom} {(ownerUserId is null ? string.Empty : "WHERE s.owner_user_id = @owner")} ORDER BY s.created_at DESC LIMIT 500;";
        if (ownerUserId is not null)
        {
            command.Parameters.AddWithValue("@owner", ownerUserId);
        }
        using var reader = command.ExecuteReader();
        var shares = new List<ShareRecord>();
        while (reader.Read())
        {
            shares.Add(ReadShare(reader));
        }
        return shares;
    }

    /// <summary>
    /// Counts one view of an active share and hands out its ciphertext. When the last view is used, the ciphertext is
    /// removed in the same transaction, so two requests can never both use the last view.
    /// </summary>
    /// <param name="id">The share's ID.</param>
    /// <param name="now">The current time.</param>
    /// <returns>The ciphertext, nonce and remaining views, or null when the share is no longer active.</returns>
    public (string Ciphertext, string Iv, int Remaining)? ConsumeShareView(string id, DateTimeOffset now)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        string ciphertext;
        string iv;
        int remaining;
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                SELECT ciphertext, iv, max_views - view_count - 1 FROM shares
                WHERE id = @id AND ciphertext IS NOT NULL AND revoked_at IS NULL AND expires_at > @now AND view_count < max_views;
                """;
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@now", now.ToString("O"));
            using var reader = command.ExecuteReader();
            if (!reader.Read())
            {
                return null;
            }
            ciphertext = reader.GetString(0);
            iv = reader.GetString(1);
            remaining = reader.GetInt32(2);
        }
        Execute(connection, transaction, """
            UPDATE shares SET view_count = view_count + 1, last_viewed_at = @now, failed_attempts = 0, code_hash = NULL,
                ciphertext = CASE WHEN view_count + 1 >= max_views THEN NULL ELSE ciphertext END,
                iv = CASE WHEN view_count + 1 >= max_views THEN NULL ELSE iv END,
                ended_at = CASE WHEN view_count + 1 >= max_views THEN @now ELSE ended_at END,
                end_reason = CASE WHEN view_count + 1 >= max_views THEN 'used' ELSE end_reason END
            WHERE id = @id;
            """, new SqliteParameter("@id", id), new SqliteParameter("@now", now.ToString("O")));
        transaction.Commit();
        return (ciphertext, iv, remaining);
    }

    /// <summary>Counts a wrong password or code; at the limit the ciphertext is removed and the share is locked.</summary>
    /// <param name="id">The share's ID.</param>
    /// <param name="limit">The number of failed attempts that locks the share.</param>
    /// <returns>True when the share is now locked.</returns>
    public bool CountShareFailure(string id, int limit)
    {
        using var connection = Open();
        connection.Open();
        var now = DateTimeOffset.UtcNow.ToString("O");
        Execute(connection, """
            UPDATE shares SET failed_attempts = failed_attempts + 1,
                ciphertext = CASE WHEN failed_attempts + 1 >= @limit THEN NULL ELSE ciphertext END,
                iv = CASE WHEN failed_attempts + 1 >= @limit THEN NULL ELSE iv END,
                code_hash = CASE WHEN failed_attempts + 1 >= @limit THEN NULL ELSE code_hash END,
                ended_at = CASE WHEN failed_attempts + 1 >= @limit AND ended_at IS NULL THEN @now ELSE ended_at END,
                end_reason = CASE WHEN failed_attempts + 1 >= @limit AND end_reason IS NULL THEN 'locked' ELSE end_reason END
            WHERE id = @id AND ciphertext IS NOT NULL;
            """, new SqliteParameter("@id", id), new SqliteParameter("@limit", limit), new SqliteParameter("@now", now));
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT end_reason FROM shares WHERE id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteScalar() as string == "locked";
    }

    /// <summary>Stores a new e-mail code for a share (as hash) and counts it.</summary>
    /// <param name="id">The share's ID.</param>
    /// <param name="codeHash">The hash of the code.</param>
    /// <param name="expiresAt">When the code stops working.</param>
    public void SetShareCode(string id, string codeHash, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            UPDATE shares SET code_hash = @hash, code_expires_at = @expires, code_sent_at = @now, codes_sent = codes_sent + 1 WHERE id = @id;
            """, new SqliteParameter("@id", id), new SqliteParameter("@hash", codeHash),
            new SqliteParameter("@expires", expiresAt.ToString("O")), new SqliteParameter("@now", DateTimeOffset.UtcNow.ToString("O")));
    }

    /// <summary>Records that KeePort sent the link to the recipient.</summary>
    /// <param name="id">The share's ID.</param>
    public void MarkShareSentByEmail(string id)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "UPDATE shares SET sent_by_email = 1 WHERE id = @id;", new SqliteParameter("@id", id));
    }

    /// <summary>Revokes a share: the ciphertext is removed at once, the metadata stays for the lists.</summary>
    /// <param name="id">The share's ID.</param>
    /// <returns>True when an active share was revoked.</returns>
    public bool RevokeShare(string id)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE shares SET revoked_at = @now, ciphertext = NULL, iv = NULL, code_hash = NULL, ended_at = COALESCE(ended_at, @now),
                end_reason = COALESCE(end_reason, 'revoked')
            WHERE id = @id AND revoked_at IS NULL AND ciphertext IS NOT NULL;
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O"));
        return command.ExecuteNonQuery() > 0;
    }

    /// <summary>
    /// Removes the ciphertext of expired shares and deletes the metadata of shares that ended more than the given days ago.
    /// </summary>
    /// <param name="now">The current time.</param>
    /// <param name="keepDays">Days the metadata of ended shares is kept.</param>
    /// <returns>The number of shares whose ciphertext was removed now.</returns>
    public int CleanUpShares(DateTimeOffset now, int keepDays)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        int expired;
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE shares SET ciphertext = NULL, iv = NULL, code_hash = NULL, ended_at = @now, end_reason = 'expired'
                WHERE ciphertext IS NOT NULL AND expires_at <= @now;
                """;
            command.Parameters.AddWithValue("@now", now.ToString("O"));
            expired = command.ExecuteNonQuery();
        }
        Execute(connection, transaction, "DELETE FROM shares WHERE ended_at IS NOT NULL AND ended_at < @limit;",
            new SqliteParameter("@limit", now.AddDays(-keepDays).ToString("O")));
        transaction.Commit();
        return expired;
    }

    /// <summary>Returns the sharing override of every account that has one: allowed or blocked.</summary>
    public IReadOnlyDictionary<string, string> ListShareUserOverrides()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT user_id, mode FROM share_user_overrides;";
        using var reader = command.ExecuteReader();
        var overrides = new Dictionary<string, string>(StringComparer.Ordinal);
        while (reader.Read())
        {
            overrides[reader.GetString(0)] = reader.GetString(1);
        }
        return overrides;
    }

    /// <summary>Returns an account's sharing override (allowed or blocked), or null for the global setting.</summary>
    /// <param name="userId">The account's ID.</param>
    public string? GetShareUserOverride(string userId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT mode FROM share_user_overrides WHERE user_id = @id;";
        command.Parameters.AddWithValue("@id", userId);
        return command.ExecuteScalar() as string;
    }

    /// <summary>Sets or removes an account's sharing override.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="mode">allowed, blocked, or null to follow the global setting.</param>
    public void SetShareUserOverride(string userId, string? mode)
    {
        using var connection = Open();
        connection.Open();
        if (mode is null)
        {
            Execute(connection, "DELETE FROM share_user_overrides WHERE user_id = @id;", new SqliteParameter("@id", userId));
            return;
        }
        Execute(connection, """
            INSERT INTO share_user_overrides (user_id, mode) VALUES (@id, @mode) ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode;
            """, new SqliteParameter("@id", userId), new SqliteParameter("@mode", mode));
    }

    /// <summary>Lists the vaults that may not be shared from.</summary>
    public IReadOnlySet<string> ListShareVaultBlocks()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT vault_file_id FROM share_vault_blocks;";
        using var reader = command.ExecuteReader();
        var blocked = new HashSet<string>(StringComparer.Ordinal);
        while (reader.Read())
        {
            blocked.Add(reader.GetString(0));
        }
        return blocked;
    }

    /// <summary>Allows or forbids sharing from a vault.</summary>
    /// <param name="vaultFileId">The vault's ID.</param>
    /// <param name="allowed">Whether entries of the vault may be shared.</param>
    public void SetShareVaultAllowed(string vaultFileId, bool allowed)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, allowed
            ? "DELETE FROM share_vault_blocks WHERE vault_file_id = @id;"
            : "INSERT INTO share_vault_blocks (vault_file_id) VALUES (@id) ON CONFLICT(vault_file_id) DO NOTHING;",
            new SqliteParameter("@id", vaultFileId));
    }

    /// <summary>Reads a share from the current row in the order of <see cref="ShareColumns"/>.</summary>
    /// <param name="reader">The reader positioned on the row.</param>
    private static ShareRecord ReadShare(SqliteDataReader reader)
    {
        // Reads an optional date column.
        // <param name="index">The column index.</param>
        DateTimeOffset? Date(int index) => reader.IsDBNull(index) ? null : ParseDate(reader.GetString(index));
        // Reads an optional text column.
        // <param name="index">The column index.</param>
        string? Text(int index) => reader.IsDBNull(index) ? null : reader.GetString(index);
        return new ShareRecord
        {
            Id = reader.GetString(0),
            OwnerUserId = reader.GetString(1),
            OwnerName = reader.GetString(2),
            VaultFileId = Text(3),
            VaultName = Text(4),
            EntryUuid = Text(5),
            Label = reader.GetString(6),
            Ciphertext = Text(7),
            Iv = Text(8),
            KdfSalt = reader.GetString(9),
            KdfParams = Text(10),
            ProofHash = reader.GetString(11),
            RecipientEmail = Text(12),
            RequireEmailCode = reader.GetInt32(13) != 0,
            SentByEmail = reader.GetInt32(14) != 0,
            MaxViews = reader.GetInt32(15),
            ViewCount = reader.GetInt32(16),
            FailedAttempts = reader.GetInt32(17),
            CodeHash = Text(18),
            CodeExpiresAt = Date(19),
            CodeSentAt = Date(20),
            CodesSent = reader.GetInt32(21),
            CreatedAt = ParseDate(reader.GetString(22)),
            ExpiresAt = ParseDate(reader.GetString(23)),
            RevokedAt = Date(24),
            LastViewedAt = Date(25),
            EndedAt = Date(26),
            EndReason = Text(27)
        };
    }
}
