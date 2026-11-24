namespace KeePort.Api.Security;

/// <summary>Reads on/off settings and accepts the spellings people commonly put into a .env file.</summary>
public static class ConfigFlags
{
    private static readonly string[] TrueValues = ["true", "yes", "on", "1"];
    private static readonly string[] FalseValues = ["false", "no", "off", "0"];

    /// <summary>Reads KeePort:CookieSecure (KEEPORT_COOKIE_SECURE); secure cookies are the default.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <exception cref="InvalidOperationException">The value is not a recognized on/off value.</exception>
    public static bool CookieSecure(IConfiguration configuration)
        => Read(configuration, "KeePort:CookieSecure", "KEEPORT_COOKIE_SECURE", defaultValue: true);

    /// <summary>Parses an on/off setting: true/yes/on/1 or false/no/off/0, case-insensitive; empty means the default.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <param name="key">The configuration key to read.</param>
    /// <param name="envName">The .env variable name quoted in the error message.</param>
    /// <param name="defaultValue">The value used when the setting is missing or empty.</param>
    /// <exception cref="InvalidOperationException">The value is not a recognized on/off value.</exception>
    public static bool Read(IConfiguration configuration, string key, string envName, bool defaultValue)
    {
        var raw = configuration[key]?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return defaultValue;
        }
        if (TrueValues.Contains(raw, StringComparer.OrdinalIgnoreCase))
        {
            return true;
        }
        if (FalseValues.Contains(raw, StringComparer.OrdinalIgnoreCase))
        {
            return false;
        }
        throw new InvalidOperationException($"{envName} ({key}) must be true or false (also accepted: yes/no, on/off, 1/0), but is '{raw}'.");
    }
}
