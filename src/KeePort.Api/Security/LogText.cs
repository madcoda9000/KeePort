using System.Text;

namespace KeePort.Api.Security;

/// <summary>Prepares values that clients control for the console log, so they cannot forge extra log lines.</summary>
public static class LogText
{
    /// <summary>
    /// Escapes line breaks and other control characters (for example a decoded <c>%0A</c> in a request path or a terminal
    /// escape sequence) so the value stays on one log line and cannot change the terminal. Null stays null.
    /// </summary>
    /// <param name="value">The value from the request.</param>
    /// <returns>The value with <c>\r</c>, <c>\n</c> and every other control character written as an escape.</returns>
    public static string? Clean(string? value)
    {
        if (value is null)
        {
            return null;
        }
        var text = value.Replace("\r", "\\r", StringComparison.Ordinal).Replace("\n", "\\n", StringComparison.Ordinal);
        if (!text.Any(char.IsControl))
        {
            return text;
        }
        var builder = new StringBuilder(text.Length + 8);
        foreach (var c in text)
        {
            builder.Append(char.IsControl(c) ? $"\\u{(int)c:x4}" : c);
        }
        return builder.ToString();
    }
}
