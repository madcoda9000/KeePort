using System.Globalization;
using System.Text;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>Writes audit log entries as CSV that spreadsheet programs open safely.</summary>
public static class AuditCsv
{
    /// <summary>Formats entries as CSV with a header row; times are UTC in ISO 8601.</summary>
    /// <param name="entries">The entries to write, in the order given.</param>
    public static string Write(IEnumerable<AuditEntryDto> entries)
    {
        var csv = new StringBuilder();
        csv.Append("Time (UTC),Action,Category,Result,User,Target type,Target,Details,IP address,User agent\r\n");
        foreach (var e in entries)
        {
            csv.AppendJoin(',',
                Cell(e.OccurredAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)),
                Cell(e.Action),
                Cell(e.Category),
                Cell(e.Success ? "OK" : "Failed"),
                Cell(e.ActorName),
                Cell(e.TargetType),
                Cell(e.TargetName),
                Cell(e.Details),
                Cell(e.RemoteIp),
                Cell(e.UserAgent));
            csv.Append("\r\n");
        }
        return csv.ToString();
    }

    /// <summary>
    /// Quotes one cell. Text starting with =, +, -, @, tab or carriage return gets a leading apostrophe so spreadsheet
    /// programs do not run it as a formula (CSV injection), e.g. a username typed as "=HYPERLINK(...)".
    /// </summary>
    /// <param name="value">The cell text, or null for an empty cell.</param>
    public static string Cell(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }
        if (value[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
        {
            value = "'" + value;
        }
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
