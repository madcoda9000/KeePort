using System.Formats.Cbor;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace KeePort.Api.Tests;

/// <summary>
/// A software passkey for tests: an ES256 key pair that answers WebAuthn registration and sign-in like a browser with a
/// platform authenticator would (attestation "none", user present and verified).
/// </summary>
public sealed class SoftAuthenticator : IDisposable
{
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private uint _counter;

    /// <summary>The credential ID.</summary>
    public byte[] CredentialId { get; } = RandomNumberGenerator.GetBytes(16);

    /// <summary>The user handle stored at registration, returned at sign-in.</summary>
    public byte[]? UserHandle { get; private set; }

    /// <summary>Answers navigator.credentials.create() for the given options.</summary>
    /// <param name="options">The options from the server.</param>
    /// <param name="origin">The page's origin, e.g. https://vault.example.test.</param>
    public JsonObject Register(JsonElement options, string origin)
    {
        var rpId = options.GetProperty("rp").GetProperty("id").GetString()!;
        UserHandle = FromBase64Url(options.GetProperty("user").GetProperty("id").GetString()!);
        var clientData = ClientData("webauthn.create", options.GetProperty("challenge").GetString()!, origin);

        var parameters = _key.ExportParameters(false);
        var cose = new CborWriter();
        cose.WriteStartMap(5);
        cose.WriteInt32(1); cose.WriteInt32(2);
        cose.WriteInt32(3); cose.WriteInt32(-7);
        cose.WriteInt32(-1); cose.WriteInt32(1);
        cose.WriteInt32(-2); cose.WriteByteString(parameters.Q.X!);
        cose.WriteInt32(-3); cose.WriteByteString(parameters.Q.Y!);
        cose.WriteEndMap();

        var authData = new List<byte>();
        authData.AddRange(SHA256.HashData(Encoding.UTF8.GetBytes(rpId)));
        authData.Add(0x01 | 0x04 | 0x40);
        authData.AddRange(Counter(_counter));
        authData.AddRange(new byte[16]);
        authData.Add((byte)(CredentialId.Length >> 8));
        authData.Add((byte)CredentialId.Length);
        authData.AddRange(CredentialId);
        authData.AddRange(cose.Encode());

        var attestation = new CborWriter();
        attestation.WriteStartMap(3);
        attestation.WriteTextString("fmt"); attestation.WriteTextString("none");
        attestation.WriteTextString("attStmt"); attestation.WriteStartMap(0); attestation.WriteEndMap();
        attestation.WriteTextString("authData"); attestation.WriteByteString([.. authData]);
        attestation.WriteEndMap();

        return new JsonObject
        {
            ["id"] = ToBase64Url(CredentialId),
            ["rawId"] = ToBase64Url(CredentialId),
            ["type"] = "public-key",
            ["response"] = new JsonObject
            {
                ["attestationObject"] = ToBase64Url(attestation.Encode()),
                ["clientDataJSON"] = ToBase64Url(clientData),
                ["transports"] = new JsonArray("internal")
            },
            ["clientExtensionResults"] = new JsonObject()
        };
    }

    /// <summary>Answers navigator.credentials.get() for the given options.</summary>
    /// <param name="options">The options from the server.</param>
    /// <param name="origin">The page's origin.</param>
    /// <param name="counter">The signature counter to report; by default one more than last time.</param>
    public JsonObject SignIn(JsonElement options, string origin, uint? counter = null)
    {
        _counter = counter ?? _counter + 1;
        var rpId = options.GetProperty("rpId").GetString()!;
        var clientData = ClientData("webauthn.get", options.GetProperty("challenge").GetString()!, origin);
        var authData = new List<byte>();
        authData.AddRange(SHA256.HashData(Encoding.UTF8.GetBytes(rpId)));
        authData.Add(0x01 | 0x04);
        authData.AddRange(Counter(_counter));
        var signed = authData.Concat(SHA256.HashData(clientData)).ToArray();
        var signature = _key.SignData(signed, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
        return new JsonObject
        {
            ["id"] = ToBase64Url(CredentialId),
            ["rawId"] = ToBase64Url(CredentialId),
            ["type"] = "public-key",
            ["response"] = new JsonObject
            {
                ["authenticatorData"] = ToBase64Url([.. authData]),
                ["clientDataJSON"] = ToBase64Url(clientData),
                ["signature"] = ToBase64Url(signature),
                ["userHandle"] = UserHandle is null ? null : ToBase64Url(UserHandle)
            },
            ["clientExtensionResults"] = new JsonObject()
        };
    }

    /// <summary>Releases the key.</summary>
    public void Dispose() => _key.Dispose();

    /// <summary>Builds clientDataJSON.</summary>
    /// <param name="type">webauthn.create or webauthn.get.</param>
    /// <param name="challenge">The challenge, Base64url.</param>
    /// <param name="origin">The page's origin.</param>
    private static byte[] ClientData(string type, string challenge, string origin)
        => JsonSerializer.SerializeToUtf8Bytes(new { type, challenge, origin, crossOrigin = false });

    /// <summary>Encodes a signature counter big-endian.</summary>
    /// <param name="value">The counter.</param>
    private static byte[] Counter(uint value) => [(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value];

    /// <summary>Encodes bytes as unpadded Base64url.</summary>
    /// <param name="bytes">The bytes.</param>
    public static string ToBase64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decodes unpadded Base64url.</summary>
    /// <param name="text">The text.</param>
    private static byte[] FromBase64Url(string text)
    {
        var base64 = text.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(base64 + new string('=', (4 - base64.Length % 4) % 4));
    }
}
