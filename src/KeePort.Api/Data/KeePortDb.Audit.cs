using System.Globalization;
using System.Text;
using Microsoft.Data.Sqlite;

namespace KeePort.Api.Data;

/// <summary>Storage of the audit log: who did what, to which object, with which result.</summary>
public sealed partial class KeePortDb
{
    /// <summary>The most audit log entries kept; older entries are removed on insert.</summary>
    public const int AuditLogLimit = 50_000;

    /// <summary>The default number of days audit log entries are kept.</summary>
    public const int DefaultAuditRetentionDays = 365;

    private const string AuditColumns =
        "id, occurred_at, category, action, success, actor_id, actor_name, target_type, target_id, target_name, details, remote_ip, user_agent";

    /// <summary>
    /// Appends an audit entry and removes entries older than the retention or beyond <see cref="AuditLogLimit"/>.
    /// </summary>
    /// <param name="entry">The entry to store; its ID is assigned by SQLite and ignored here.</param>
    /// <param name="retentionDays">How many days entries are kept.</param>
    public void AddAuditEntry(AuditEntryDto entry, int retentionDays)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, """
            INSERT INTO audit_log
                (occurred_at, category, action, success, actor_id, actor_name, target_type, target_id, target_name, details, remote_ip, user_agent)
            VALUES
                (@occurredAt, @category, @action, @success, @actorId, @actorName, @targetType, @targetId, @targetName, @details, @remoteIp, @userAgent);
            """,
            new SqliteParameter("@occurredAt", entry.OccurredAt.ToUniversalTime().ToString("O")),
            new SqliteParameter("@category", entry.Category),
            new SqliteParameter("@action", entry.Action),
            new SqliteParameter("@success", entry.Success ? 1 : 0),
            new SqliteParameter("@actorId", DbValue(entry.ActorId)),
            new SqliteParameter("@actorName", DbValue(entry.ActorName)),
            new SqliteParameter("@targetType", DbValue(entry.TargetType)),
            new SqliteParameter("@targetId", DbValue(entry.TargetId)),
            new SqliteParameter("@targetName", DbValue(entry.TargetName)),
            new SqliteParameter("@details", DbValue(entry.Details)),
            new SqliteParameter("@remoteIp", DbValue(entry.RemoteIp)),
            new SqliteParameter("@userAgent", DbValue(entry.UserAgent)));
        Execute(connection, transaction, "DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - @limit;",
            new SqliteParameter("@limit", AuditLogLimit));
        Execute(connection, transaction, "DELETE FROM audit_log WHERE occurred_at < @cutoff;",
            new SqliteParameter("@cutoff", DateTimeOffset.UtcNow.AddDays(-retentionDays).ToString("O")));
        transaction.Commit();
    }

    /// <summary>Lists one page of audit entries matching a filter, newest first, with the number of all matches.</summary>
    /// <param name="filter">The filter to apply.</param>
    /// <param name="page">The 1-based page number.</param>
    /// <param name="pageSize">The number of entries per page.</param>
    public (IReadOnlyList<AuditEntryDto> Items, long Total) QueryAudit(AuditFilter filter, int page, int pageSize)
    {
        using var connection = Open();
        connection.Open();
        var (where, parameters) = BuildAuditWhere(filter);

        long total;
        using (var count = connection.CreateCommand())
        {
            count.CommandText = $"SELECT COUNT(*) FROM audit_log{where};";
            count.Parameters.AddRange(CloneParameters(parameters));
            total = Convert.ToInt64(count.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {AuditColumns} FROM audit_log{where} ORDER BY id DESC LIMIT @limit OFFSET @offset;";
        command.Parameters.AddRange(CloneParameters(parameters));
        command.Parameters.AddWithValue("@limit", pageSize);
        command.Parameters.AddWithValue("@offset", (long)(page - 1) * pageSize);
        return (ReadAuditEntries(command), total);
    }

    /// <summary>Lists all audit entries matching a filter, newest first, for the CSV export.</summary>
    /// <param name="filter">The filter to apply.</param>
    public IReadOnlyList<AuditEntryDto> ListAudit(AuditFilter filter)
    {
        using var connection = Open();
        connection.Open();
        var (where, parameters) = BuildAuditWhere(filter);
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {AuditColumns} FROM audit_log{where} ORDER BY id DESC LIMIT @limit;";
        command.Parameters.AddRange(parameters);
        command.Parameters.AddWithValue("@limit", AuditLogLimit);
        return ReadAuditEntries(command);
    }

    /// <summary>Counts all retained entries, those of the last 24 hours and 7 days, and failed sign-ins of the last 24 hours.</summary>
    /// <param name="now">The current time.</param>
    public AuditStatsDto GetAuditStats(DateTimeOffset now)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                COUNT(*),
                COALESCE(SUM(occurred_at >= @day), 0),
                COALESCE(SUM(occurred_at >= @week), 0),
                COALESCE(SUM(occurred_at >= @day AND action = 'LoginFailed'), 0)
            FROM audit_log;
            """;
        command.Parameters.AddWithValue("@day", now.ToUniversalTime().AddDays(-1).ToString("O"));
        command.Parameters.AddWithValue("@week", now.ToUniversalTime().AddDays(-7).ToString("O"));
        using var reader = command.ExecuteReader();
        reader.Read();
        return new AuditStatsDto(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3));
    }

    /// <summary>Lists the latest sign-in attempts on one account, newest first.</summary>
    /// <param name="userId">The account's ID.</param>
    /// <param name="limit">The most attempts to return.</param>
    public IReadOnlyList<AuditEntryDto> ListSignIns(string userId, int limit)
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {AuditColumns} FROM audit_log
            WHERE actor_id = @userId AND action IN ('LoginSucceeded', 'LoginFailed')
            ORDER BY id DESC LIMIT @limit;
            """;
        command.Parameters.AddWithValue("@userId", userId);
        command.Parameters.AddWithValue("@limit", limit);
        return ReadAuditEntries(command);
    }

    /// <summary>Reads how many days audit entries are kept, or the default when it was never set.</summary>
    public int GetAuditRetentionDays()
    {
        using var connection = Open();
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM app_state WHERE key = 'audit_retention_days';";
        return command.ExecuteScalar() is string value && int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var days)
            ? days
            : DefaultAuditRetentionDays;
    }

    /// <summary>Stores how many days audit entries are kept and removes older entries right away.</summary>
    /// <param name="days">Days to keep entries.</param>
    public void SetAuditRetentionDays(int days)
    {
        using var connection = Open();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        Execute(connection, transaction, """
            INSERT INTO app_state (key, value) VALUES ('audit_retention_days', @days)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """, new SqliteParameter("@days", days.ToString(CultureInfo.InvariantCulture)));
        Execute(connection, transaction, "DELETE FROM audit_log WHERE occurred_at < @cutoff;",
            new SqliteParameter("@cutoff", DateTimeOffset.UtcNow.AddDays(-days).ToString("O")));
        transaction.Commit();
    }

    /// <summary>Builds the WHERE clause and its parameters for an audit filter.</summary>
    /// <param name="filter">The filter to translate.</param>
    private static (string Where, SqliteParameter[] Parameters) BuildAuditWhere(AuditFilter filter)
    {
        var conditions = new List<string>();
        var parameters = new List<SqliteParameter>();
        if (!string.IsNullOrWhiteSpace(filter.Actor))
        {
            conditions.Add("actor_name LIKE @actor ESCAPE '\\'");
            parameters.Add(new SqliteParameter("@actor", LikePattern(filter.Actor)));
        }
        if (!string.IsNullOrWhiteSpace(filter.Action))
        {
            conditions.Add("action = @action");
            parameters.Add(new SqliteParameter("@action", filter.Action.Trim()));
        }
        if (!string.IsNullOrWhiteSpace(filter.Category))
        {
            conditions.Add("category = @category");
            parameters.Add(new SqliteParameter("@category", filter.Category.Trim()));
        }
        if (filter.From is { } from)
        {
            conditions.Add("occurred_at >= @from");
            parameters.Add(new SqliteParameter("@from", from.ToUniversalTime().ToString("O")));
        }
        if (filter.To is { } to)
        {
            conditions.Add("occurred_at < @to");
            parameters.Add(new SqliteParameter("@to", to.ToUniversalTime().ToString("O")));
        }
        if (filter.FailedOnly)
        {
            conditions.Add("success = 0");
        }
        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            conditions.Add("""
                (action LIKE @search ESCAPE '\' OR actor_name LIKE @search ESCAPE '\' OR target_name LIKE @search ESCAPE '\'
                 OR details LIKE @search ESCAPE '\' OR remote_ip LIKE @search ESCAPE '\')
                """);
            parameters.Add(new SqliteParameter("@search", LikePattern(filter.Search)));
        }
        var where = conditions.Count == 0 ? string.Empty : " WHERE " + string.Join(" AND ", conditions);
        return (where, parameters.ToArray());
    }

    /// <summary>Turns user text into a case-insensitive "contains" pattern with LIKE wildcards escaped.</summary>
    /// <param name="text">The text to search for.</param>
    private static string LikePattern(string text)
    {
        var escaped = new StringBuilder();
        foreach (var c in text.Trim())
        {
            if (c is '%' or '_' or '\\')
            {
                escaped.Append('\\');
            }
            escaped.Append(c);
        }
        return $"%{escaped}%";
    }

    /// <summary>Copies parameters so the same filter can be bound to a second command.</summary>
    /// <param name="parameters">The parameters to copy.</param>
    private static SqliteParameter[] CloneParameters(SqliteParameter[] parameters)
        => parameters.Select(/* Copies one parameter. */ p => new SqliteParameter(p.ParameterName, p.Value)).ToArray();

    /// <summary>Reads all audit entries returned by a command.</summary>
    /// <param name="command">The prepared SELECT command over <see cref="AuditColumns"/>.</param>
    private static List<AuditEntryDto> ReadAuditEntries(SqliteCommand command)
    {
        using var reader = command.ExecuteReader();
        var entries = new List<AuditEntryDto>();
        while (reader.Read())
        {
            entries.Add(new AuditEntryDto(
                reader.GetInt64(0),
                ParseDate(reader.GetString(1)),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetInt32(4) != 0,
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetString(12)));
        }
        return entries;
    }
}
