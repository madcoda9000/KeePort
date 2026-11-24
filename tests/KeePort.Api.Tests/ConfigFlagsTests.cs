using KeePort.Api.Security;
using Microsoft.Extensions.Configuration;

namespace KeePort.Api.Tests;

public class ConfigFlagsTests
{
    /// <summary>Builds a configuration containing only the cookie setting.</summary>
    /// <param name="value">The raw value of KeePort:CookieSecure, or null to leave it unset.</param>
    private static IConfiguration Config(string? value)
        => new ConfigurationBuilder()
            .AddInMemoryCollection(value is null ? [] : [new KeyValuePair<string, string?>("KeePort:CookieSecure", value)])
            .Build();

    /// <summary>Verifies the accepted on/off spellings, including values typed into .env files on a NAS.</summary>
    [Theory]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("yes", true)]
    [InlineData(" on ", true)]
    [InlineData("1", true)]
    [InlineData("false", false)]
    [InlineData("No", false)]
    [InlineData("off", false)]
    [InlineData("0", false)]
    public void Accepts_Common_On_Off_Values(string value, bool expected)
        => Assert.Equal(expected, ConfigFlags.CookieSecure(Config(value)));

    /// <summary>Verifies that a missing or empty value keeps secure cookies on.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Missing_Value_Defaults_To_Secure(string? value)
        => Assert.True(ConfigFlags.CookieSecure(Config(value)));

    /// <summary>Verifies that an unknown value names the .env variable instead of failing with a stack trace only.</summary>
    [Fact]
    public void Rejects_Unknown_Value_With_Clear_Message()
    {
        var error = Assert.Throws<InvalidOperationException>(/* Reads an unsupported value. */ () => ConfigFlags.CookieSecure(Config("maybe")));
        Assert.Contains("KEEPORT_COOKIE_SECURE", error.Message);
        Assert.Contains("'maybe'", error.Message);
    }
}
