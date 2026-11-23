using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace KeePort.Api.Services;

public sealed class PasswordHasher
{
    private const int MemoryKiB = 32 * 1024;
    private const int Iterations = 3;
    private const int Parallelism = 4;
    private const int SaltLength = 16;
    private const int HashLength = 32;
    private const int Version = 19;

    /// <summary>Hashes a password with Argon2id and a fresh random salt.</summary>
    /// <param name="password">The plaintext password to hash or verify.</param>
    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        var hash = Compute(password, salt);
        return $"argon2id$v={Version}$m={MemoryKiB},t={Iterations},p={Parallelism}${Base64Url(salt)}${Base64Url(hash)}";
    }

    /// <summary>Reads the stored Argon2id parameters and checks the resulting hash in constant time.</summary>
    /// <param name="password">The plaintext password to hash or verify.</param>
    /// <param name="encoded">The stored Argon2id hash and its encoded work parameters.</param>
    public bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 5 || parts[0] != "argon2id" || parts[1] != $"v={Version}")
        {
            return false;
        }

        var parameters = parts[2].Split(',');
        if (parameters.Length != 3)
        {
            return false;
        }

        var memory = ParseParameter(parameters[0], 'm');
        var iterations = ParseParameter(parameters[1], 't');
        var parallelism = ParseParameter(parameters[2], 'p');
        if (memory is null || iterations is null || parallelism is null)
        {
            return false;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = FromBase64Url(parts[3]);
            expected = FromBase64Url(parts[4]);
        }
        catch (FormatException)
        {
            return false;
        }

        if (salt.Length != SaltLength || expected.Length != HashLength)
        {
            return false;
        }

        var actual = Compute(password, salt, memory.Value, iterations.Value, parallelism.Value);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Derives an Argon2id hash using the supplied salt and work parameters.</summary>
    /// <param name="password">The plaintext password to hash or verify.</param>
    /// <param name="salt">The salt bytes used to derive the hash.</param>
    /// <param name="memoryKiB">The Argon2 memory cost in KiB.</param>
    /// <param name="iterations">The number of Argon2 passes.</param>
    /// <param name="parallelism">The number of Argon2 processing lanes.</param>
    private static byte[] Compute(string password, byte[] salt, int memoryKiB = MemoryKiB, int iterations = Iterations, int parallelism = Parallelism)
    {
        var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            DegreeOfParallelism = parallelism,
            Iterations = iterations,
            MemorySize = memoryKiB
        };
        return argon2.GetBytes(HashLength);
    }

    /// <summary>Parses a named numeric parameter from a stored password hash.</summary>
    /// <param name="parameter">The encoded parameter in key=value form.</param>
    /// <param name="key">The expected parameter key.</param>
    private static int? ParseParameter(string parameter, char key)
    {
        var separator = parameter.IndexOf('=');
        if (separator <= 0 || parameter[0] != key || !int.TryParse(parameter[(separator + 1)..], out var value))
        {
            return null;
        }
        return value;
    }

    /// <summary>Decodes a URL-safe Base64 field from a stored password hash.</summary>
    /// <param name="value">An encoded salt or hash field to decode from Base64URL.</param>
    private static byte[] FromBase64Url(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '='));
    }

    /// <summary>Encodes hash material as unpadded URL-safe Base64.</summary>
    /// <param name="bytes">The raw bytes to encode as Base64URL.</param>
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
