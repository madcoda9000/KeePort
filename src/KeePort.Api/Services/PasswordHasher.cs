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

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        var hash = Compute(password, salt);
        return $"argon2id$v={Version}$m={MemoryKiB},t={Iterations},p={Parallelism}${Base64Url(salt)}${Base64Url(hash)}";
    }

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

    private static int? ParseParameter(string parameter, char key)
    {
        var separator = parameter.IndexOf('=');
        if (separator <= 0 || parameter[0] != key || !int.TryParse(parameter[(separator + 1)..], out var value))
        {
            return null;
        }
        return value;
    }

    private static byte[] FromBase64Url(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '='));
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
