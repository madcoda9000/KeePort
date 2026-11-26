using System.Text;
using KeePort.Api.Services;

namespace KeePort.Api.Tests;

/// <summary>Checks the TOTP implementation against RFC 6238 and the Base32 coding authenticator apps use.</summary>
public class TotpTests
{
    /// <summary>Checks the SHA-1 test vectors from RFC 6238, appendix B.</summary>
    /// <param name="unixTime">The time in seconds.</param>
    /// <param name="expected">The 8-digit code from the RFC.</param>
    [Theory]
    [InlineData(59L, "94287082")]
    [InlineData(1111111109L, "07081804")]
    [InlineData(1111111111L, "14050471")]
    [InlineData(1234567890L, "89005924")]
    [InlineData(2000000000L, "69279037")]
    [InlineData(20000000000L, "65353130")]
    public void Matches_Rfc6238_Vectors(long unixTime, string expected)
    {
        var secret = Encoding.ASCII.GetBytes("12345678901234567890");
        Assert.Equal(expected, Totp.Compute(secret, Totp.StepAt(DateTimeOffset.FromUnixTimeSeconds(unixTime)), digits: 8));
    }

    /// <summary>Checks that a code is accepted one step early or late, but not two, and that junk is refused.</summary>
    [Fact]
    public void Verify_Allows_One_Step_Of_Clock_Drift()
    {
        var secret = Totp.GenerateSecret();
        var bytes = Totp.FromBase32(secret);
        var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var step = Totp.StepAt(now);
        Assert.Equal(step, Totp.Verify(secret, Totp.Compute(bytes, step), now));
        Assert.Equal(step - 1, Totp.Verify(secret, Totp.Compute(bytes, step - 1), now));
        Assert.Equal(step + 1, Totp.Verify(secret, Totp.Compute(bytes, step + 1), now));
        Assert.Null(Totp.Verify(secret, Totp.Compute(bytes, step + 2), now));
        Assert.Null(Totp.Verify(secret, "12345", now));
        Assert.Null(Totp.Verify(secret, "abcdef", now));
        Assert.Null(Totp.Verify(secret, null, now));
    }

    /// <summary>Checks Base32 against RFC 4648 and that secrets survive a round trip.</summary>
    [Fact]
    public void Base32_Round_Trips()
    {
        Assert.Equal("MZXW6YTBOI", Totp.ToBase32(Encoding.ASCII.GetBytes("foobar")));
        Assert.Equal("foobar", Encoding.ASCII.GetString(Totp.FromBase32("mzxw 6ytb oi======")));
        var secret = Totp.GenerateSecret();
        Assert.Equal(32, secret.Length);
        Assert.Equal(secret, Totp.ToBase32(Totp.FromBase32(secret)));
        Assert.Throws<FormatException>(() => Totp.FromBase32("not base32!"));
    }

    /// <summary>Checks the otpauth link that the QR code contains.</summary>
    [Fact]
    public void Builds_Otpauth_Uri()
    {
        Assert.Equal("otpauth://totp/KeePort:anna%20b?secret=ABC&issuer=KeePort&algorithm=SHA1&digits=6&period=30", Totp.BuildUri("KeePort", "anna b", "ABC"));
    }
}
