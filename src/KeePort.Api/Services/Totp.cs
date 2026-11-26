using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace KeePort.Api.Services;

/// <summary>
/// Time-based one-time passwords as authenticator apps use them (RFC 6238): HMAC-SHA1, 30-second steps, 6 digits.
/// </summary>
public static class Totp
{
    /// <summary>The length of one time step.</summary>
    public const int StepSeconds = 30;

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>Creates a new random secret of 160 bits, as Base32 text for the app.</summary>
    public static string GenerateSecret() => ToBase32(RandomNumberGenerator.GetBytes(20));

    /// <summary>Returns the time step a moment falls into.</summary>
    /// <param name="time">The moment.</param>
    public static long StepAt(DateTimeOffset time) => time.ToUnixTimeSeconds() / StepSeconds;

    /// <summary>Computes the 6-digit code of a secret for one time step (RFC 4226 dynamic truncation).</summary>
    /// <param name="secret">The raw secret bytes.</param>
    /// <param name="step">The time step.</param>
    /// <param name="digits">The number of digits; 6 for authenticator apps, 8 for the RFC test vectors.</param>
    public static string Compute(byte[] secret, long step, int digits = 6)
    {
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);
        Span<byte> hash = stackalloc byte[20];
        HMACSHA1.HashData(secret, counter, hash);
        var offset = hash[^1] & 0x0f;
        var value = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        var modulo = (int)Math.Pow(10, digits);
        return (value % modulo).ToString("D" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Checks a code against the current time step and one step before and after, to allow for clocks that are a little
    /// off. Returns the matching step, or null. The comparison takes the same time whether or not a code matches.
    /// </summary>
    /// <param name="base32Secret">The secret as Base32 text.</param>
    /// <param name="code">The entered code; spaces are ignored.</param>
    /// <param name="now">The current time.</param>
    public static long? Verify(string base32Secret, string? code, DateTimeOffset now)
    {
        var digits = (code ?? string.Empty).Replace(" ", string.Empty, StringComparison.Ordinal).Trim();
        if (digits.Length != 6 || !digits.All(char.IsAsciiDigit))
        {
            return null;
        }
        var secret = FromBase32(base32Secret);
        var entered = Encoding.ASCII.GetBytes(digits);
        long? match = null;
        var current = StepAt(now);
        for (var step = current - 1; step <= current + 1; step++)
        {
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Compute(secret, step)), entered))
            {
                match ??= step;
            }
        }
        return match;
    }

    /// <summary>Builds the otpauth:// link that authenticator apps read from the QR code.</summary>
    /// <param name="issuer">The service name shown in the app.</param>
    /// <param name="account">The account name shown in the app.</param>
    /// <param name="base32Secret">The secret as Base32 text.</param>
    public static string BuildUri(string issuer, string account, string base32Secret)
    {
        var label = Uri.EscapeDataString(issuer) + ":" + Uri.EscapeDataString(account);
        return $"otpauth://totp/{label}?secret={base32Secret}&issuer={Uri.EscapeDataString(issuer)}&algorithm=SHA1&digits=6&period={StepSeconds}";
    }

    /// <summary>Encodes bytes as Base32 (RFC 4648) without padding.</summary>
    /// <param name="bytes">The bytes.</param>
    public static string ToBase32(ReadOnlySpan<byte> bytes)
    {
        var output = new StringBuilder((bytes.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var b in bytes)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                output.Append(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }
        if (bits > 0)
        {
            output.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        }
        return output.ToString();
    }

    /// <summary>Decodes Base32 text (RFC 4648); spaces, padding and letter case are ignored.</summary>
    /// <param name="text">The Base32 text.</param>
    /// <exception cref="FormatException">The text contains a character that is not Base32.</exception>
    public static byte[] FromBase32(string text)
    {
        var output = new List<byte>(text.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var c in text.ToUpperInvariant())
        {
            if (c is ' ' or '=' or '-')
            {
                continue;
            }
            var value = Base32Alphabet.IndexOf(c, StringComparison.Ordinal);
            if (value < 0)
            {
                throw new FormatException("The text is not Base32.");
            }
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)((buffer >> (bits - 8)) & 0xff));
                bits -= 8;
            }
        }
        return [.. output];
    }
}
