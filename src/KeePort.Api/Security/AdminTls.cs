using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;

namespace KeePort.Api.Security;

/// <summary>
/// Serves the admin console over HTTPS with a self-signed certificate, so browsers provide the Web Crypto API that
/// creating vaults needs, without a reverse proxy or SSH tunnel.
/// </summary>
public static partial class AdminTls
{
    /// <summary>Certificates are renewed when they expire within this period.</summary>
    public static readonly TimeSpan RenewBefore = TimeSpan.FromDays(30);

    /// <summary>Validity of newly created certificates.</summary>
    public static readonly TimeSpan Validity = TimeSpan.FromDays(5 * 365);

    /// <summary>The certificate file below the data directory.</summary>
    public const string RelativePath = "tls/admin.pfx";

    /// <summary>
    /// Rewrites http listener URLs for admin ports to https, e.g. "http://+:8080;http://+:8081" with admin port 8081
    /// becomes "http://+:8080;https://+:8081". Other URLs stay unchanged.
    /// </summary>
    /// <param name="urls">The semicolon-separated listener URLs from ASPNETCORE_URLS.</param>
    /// <param name="adminPorts">The ports that serve the admin console.</param>
    public static string RewriteUrls(string urls, IReadOnlyCollection<int> adminPorts)
    {
        var parts = urls.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(';', parts.Select(/* Switches one listener URL to https when it serves an admin port.
         * <param name="url">One listener URL.</param>
         */ url =>
        {
            var match = HttpUrlPattern().Match(url);
            return match.Success && int.TryParse(match.Groups["port"].Value, out var port) && adminPorts.Contains(port)
                ? $"https://{match.Groups["host"].Value}:{port}{match.Groups["rest"].Value}"
                : url;
        }));
    }

    /// <summary>
    /// Loads the admin certificate from the data directory, or creates a new one when it is missing, unreadable,
    /// expires soon, or does not cover all configured host names and addresses.
    /// </summary>
    /// <param name="dataDir">The KeePort data directory.</param>
    /// <param name="extraHosts">Additional host names or IP addresses for the certificate (KEEPORT_ADMIN_TLS_HOSTS).</param>
    /// <param name="now">The current time, injectable for tests.</param>
    /// <returns>The certificate with its private key, and whether it was newly created.</returns>
    public static (X509Certificate2 Certificate, bool Created) LoadOrCreate(string dataDir, IEnumerable<string> extraHosts, DateTimeOffset now)
    {
        var path = Path.Combine(dataDir, RelativePath);
        var hosts = DefaultHosts.Concat(extraHosts.Select(/* Trims a configured host entry.
         * <param name="h">One configured host name or address.</param>
         */ h => h.Trim()).Where(/* Skips empty host entries.
         * <param name="h">One trimmed host entry.</param>
         */ h => h.Length > 0)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

        if (File.Exists(path))
        {
            try
            {
                var existing = Load(File.ReadAllBytes(path));
                if (existing.NotAfter.ToUniversalTime() - now.UtcDateTime > RenewBefore && Covers(existing, hosts))
                {
                    return (existing, false);
                }
                existing.Dispose();
            }
            catch (CryptographicException)
            {
                // Unreadable certificate: replace it below.
            }
        }

        var created = Create(hosts, now);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tempPath = $"{path}.tmp-{Guid.NewGuid():N}";
        File.WriteAllBytes(tempPath, created.Export(X509ContentType.Pfx));
        if (!OperatingSystem.IsWindows())
        {
            // The file contains the private key: readable only by the KeePort user, also on bind-mounted NAS folders.
            File.SetUnixFileMode(tempPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        File.Move(tempPath, path, overwrite: true);
        return (created, true);
    }

    /// <summary>Formats the SHA-256 fingerprint the way browsers show it, e.g. "AB:CD:…".</summary>
    /// <param name="certificate">The certificate to describe.</param>
    public static string Fingerprint(X509Certificate2 certificate)
        => string.Join(':', Convert.ToHexString(certificate.GetCertHash(HashAlgorithmName.SHA256)).Chunk(2).Select(/* Joins one byte's hex digits.
         * <param name="pair">The two hex digits of one byte.</param>
         */ pair => new string(pair)));

    /// <summary>Host names and addresses every admin certificate covers.</summary>
    private static readonly string[] DefaultHosts = ["localhost", "127.0.0.1", "::1"];

    /// <summary>Creates a self-signed ECDSA P-256 server certificate for the given hosts.</summary>
    /// <param name="hosts">Host names and IP addresses for the subject alternative names.</param>
    /// <param name="now">The current time used for the validity period.</param>
    private static X509Certificate2 Create(IReadOnlyCollection<string> hosts, DateTimeOffset now)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=KeePort admin console, O=KeePort (self-signed)", key, HashAlgorithmName.SHA256);
        var names = new SubjectAlternativeNameBuilder();
        foreach (var host in hosts)
        {
            if (IPAddress.TryParse(host, out var address))
            {
                names.AddIpAddress(address);
            }
            else
            {
                names.AddDnsName(host);
            }
        }
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.1")], false));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));

        using var selfSigned = request.CreateSelfSigned(now.AddDays(-1), now.Add(Validity));
        // Round-trip through PFX so the private key is usable by Kestrel on every platform.
        return Load(selfSigned.Export(X509ContentType.Pfx));
    }

    /// <summary>Loads a PFX with its private key.</summary>
    /// <param name="pfx">The PFX bytes without password.</param>
    private static X509Certificate2 Load(byte[] pfx)
        => new(pfx, (string?)null, X509KeyStorageFlags.Exportable);

    /// <summary>Checks that the certificate names every host in its subject alternative names.</summary>
    /// <param name="certificate">The existing certificate.</param>
    /// <param name="hosts">The required host names and addresses.</param>
    private static bool Covers(X509Certificate2 certificate, IEnumerable<string> hosts)
    {
        var extension = certificate.Extensions.OfType<X509SubjectAlternativeNameExtension>().FirstOrDefault();
        if (extension is null)
        {
            return false;
        }
        var dnsNames = extension.EnumerateDnsNames().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var addresses = extension.EnumerateIPAddresses().ToHashSet();
        return hosts.All(/* Checks one required host against the certificate's names.
         * <param name="host">A required host name or address.</param>
         */ host => IPAddress.TryParse(host, out var address) ? addresses.Contains(address) : dnsNames.Contains(host));
    }

    /// <summary>Matches "http://host:port" listener URLs, including "+", "*" and bracketed IPv6 hosts.</summary>
    [GeneratedRegex(@"^http://(?<host>\[[^\]]+\]|[^:/]+):(?<port>\d+)(?<rest>/.*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HttpUrlPattern();
}
