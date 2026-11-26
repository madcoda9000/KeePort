using System.Globalization;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>Storage of vault revisions: who saved each one and which earlier ones are kept as files.</summary>
public sealed partial class KeePortDb
{
    /// <summary>The default number of earlier versions kept per vault.</summary>
    public const int DefaultVersionMaxCount = 30;

    /// <summary>The default age in days after which earlier versions are removed.</summary>
    public const int DefaultVersionMaxDays = 90;

    /// <summary>Creates the revision table; called from schema initialization.</summary>
    /// <param name="connection">An open connection.</param>
    private static void EnsureRevisionSchema(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS vault_revisions (
                file_id TEXT NOT NULL REFERENCES vault_files(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL,
                size INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                saved_at TEXT NOT NULL,
                saved_by TEXT NULL,
                saved_by_name TEXT NULL,
                source TEXT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (file_id, revision)
            );
            """);
    }

    /// <summary>Records who saved a revision and how; an existing record of the same revision is replaced.</summary>
    /// <param name="revision">The revision's metadata; Archived is stored as given.</param>
    public void RecordRevision(VaultRevisionRecord revision)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, """
            INSERT INTO vault_revisions (file_id, revision, size, sha256, saved_at, saved_by, saved_by_name, source, archived)
            VALUES (@fileId, @revision, @size, @sha256, @savedAt, @savedBy, @savedByName, @source, @archived)
            ON CONFLICT(file_id, revision) DO UPDATE SET
                size = excluded.size, sha256 = excluded.sha256, saved_at = excluded.saved_at, saved_by = excluded.saved_by,
                saved_by_name = excluded.saved_by_name, source = excluded.source, archived = excluded.archived;
            """,
            new SqliteParameter("@fileId", revision.FileId),
            new SqliteParameter("@revision", revision.Revision),
            new SqliteParameter("@size", revision.Size),
            new SqliteParameter("@sha256", revision.Sha256),
            new SqliteParameter("@savedAt", revision.SavedAt.ToUniversalTime().ToString("O")),
            new SqliteParameter("@savedBy", DbValue(revision.SavedBy)),
            new SqliteParameter("@savedByName", DbValue(revision.SavedByName)),
            new SqliteParameter("@source", DbValue(revision.Source)),
            new SqliteParameter("@archived", revision.Archived ? 1 : 0));
    }

    /// <summary>Reads the stored metadata of one revision, or null when none was recorded (e.g. saved before 0.18).</summary>
    /// <param name="fileId">The vault's ID.</param>
    /// <param name="revision">The revision number.</param>
    public VaultRevisionRecord? GetRevision(string fileId, long revision)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {RevisionColumns} FROM vault_revisions WHERE file_id = @fileId AND revision = @revision;";
        command.Parameters.AddWithValue("@fileId", fileId);
        command.Parameters.AddWithValue("@revision", revision);
        return ReadRevisions(command).FirstOrDefault();
    }

    /// <summary>Lists the earlier versions of a vault that are kept as files, newest first.</summary>
    /// <param name="fileId">The vault's ID.</param>
    public IReadOnlyList<VaultRevisionRecord> ListArchivedRevisions(string fileId)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {RevisionColumns} FROM vault_revisions WHERE file_id = @fileId AND archived = 1 ORDER BY revision DESC;";
        command.Parameters.AddWithValue("@fileId", fileId);
        return ReadRevisions(command);
    }

    /// <summary>Lists the IDs of all vaults that have kept versions, for the daily clean-up.</summary>
    public IReadOnlyList<string> ListFilesWithArchivedRevisions()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT DISTINCT file_id FROM vault_revisions WHERE archived = 1;";
        using var reader = command.ExecuteReader();
        var ids = new List<string>();
        while (reader.Read())
        {
            ids.Add(reader.GetString(0));
        }
        return ids;
    }

    /// <summary>Removes the record of a kept version after its file was deleted.</summary>
    /// <param name="fileId">The vault's ID.</param>
    /// <param name="revision">The revision number.</param>
    public void DeleteRevision(string fileId, long revision)
    {
        using var connection = Open();
        connection.Open();
        Execute(connection, "DELETE FROM vault_revisions WHERE file_id = @fileId AND revision = @revision;",
            new SqliteParameter("@fileId", fileId),
            new SqliteParameter("@revision", revision));
    }

    /// <summary>Sums the size of all kept versions in bytes.</summary>
    public long GetArchivedRevisionBytes()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COALESCE(SUM(size), 0) FROM vault_revisions WHERE archived = 1;";
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>Reads how many versions are kept per vault and for how many days; 0 means off or no age limit.</summary>
    public (int MaxCount, int MaxDays) GetVersionSettings()
    {
        using var connection = Open();
        connection.Open();
        return (ReadIntState(connection, "version_max_count", DefaultVersionMaxCount), ReadIntState(connection, "version_max_days", DefaultVersionMaxDays));
    }

    /// <summary>Stores how many versions are kept per vault and for how many days.</summary>
    /// <param name="maxCount">Versions kept per vault; 0 turns versions off.</param>
    /// <param name="maxDays">Days a version is kept; 0 keeps them regardless of age.</param>
    public void SetVersionSettings(int maxCount, int maxDays)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        foreach (var (key, value) in new[] { ("version_max_count", maxCount), ("version_max_days", maxDays) })
        {
            Execute(connection, transaction, """
                INSERT INTO app_state (key, value) VALUES (@key, @value)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value;
                """,
                new SqliteParameter("@key", key),
                new SqliteParameter("@value", value.ToString(CultureInfo.InvariantCulture)));
        }
        transaction.Commit();
    }

    private const string RevisionColumns = "file_id, revision, size, sha256, saved_at, saved_by, saved_by_name, source, archived";

    /// <summary>Reads a whole number from app_state, or a default when it is missing or invalid.</summary>
    /// <param name="connection">An open connection.</param>
    /// <param name="key">The app_state key.</param>
    /// <param name="fallback">The default value.</param>
    private static int ReadIntState(SqliteConnection connection, string key, int fallback)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = @key;";
        command.Parameters.AddWithValue("@key", key);
        return command.ExecuteScalar() is string text && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
    }

    /// <summary>Reads all revision records returned by a command over <see cref="RevisionColumns"/>.</summary>
    /// <param name="command">The prepared SELECT command.</param>
    private static List<VaultRevisionRecord> ReadRevisions(SqliteCommand command)
    {
        using var reader = command.ExecuteReader();
        var revisions = new List<VaultRevisionRecord>();
        while (reader.Read())
        {
            revisions.Add(new VaultRevisionRecord(
                reader.GetString(0),
                reader.GetInt64(1),
                reader.GetInt64(2),
                reader.GetString(3),
                ParseDate(reader.GetString(4)),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetInt32(8) != 0));
        }
        return revisions;
    }
}
