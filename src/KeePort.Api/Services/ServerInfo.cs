using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>
/// Facts about the running KeePort process that the admin dashboard shows: collected once at startup, except the
/// uptime and the IP addresses, which are read on every request.
/// </summary>
public sealed class ServerInfo
{
    /// <summary>The KeePort version from the build metadata, e.g. 0.10.0.</summary>
    public string Version { get; }

    /// <summary>The build commit if the SDK recorded one in the informational version, otherwise null.</summary>
    public string? Commit { get; }

    /// <summary>When the process started.</summary>
    public DateTimeOffset StartedAt { get; }

    /// <summary>Whether KeePort runs in a Docker container.</summary>
    public bool InDocker { get; }

    /// <summary>The ports of the web vault and WebDAV.</summary>
    public IReadOnlyList<int> VaultPorts { get; }

    /// <summary>The ports of the admin console.</summary>
    public IReadOnlyList<int> AdminPorts { get; }

    /// <summary>Whether the admin console uses HTTPS.</summary>
    public bool AdminHttps { get; }

    /// <summary>The SHA-256 fingerprint of the admin certificate, if one is used.</summary>
    public string? AdminCertificateFingerprint { get; }

    /// <summary>When the admin certificate expires, if one is used.</summary>
    public DateTimeOffset? AdminCertificateNotAfter { get; }

    /// <summary>The trusted reverse proxies as described in the startup log.</summary>
    public string TrustedProxies { get; }

    /// <summary>Creates the server information.</summary>
    /// <param name="startedAt">When the process started.</param>
    /// <param name="inDocker">Whether KeePort runs in a Docker container.</param>
    /// <param name="listenerUrls">The configured listener URLs (ASPNETCORE_URLS), used to find the ports.</param>
    /// <param name="adminPorts">The ports of the admin console.</param>
    /// <param name="adminHttps">Whether the admin console uses HTTPS.</param>
    /// <param name="adminCertificateFingerprint">The fingerprint of the admin certificate, if one is used.</param>
    /// <param name="adminCertificateNotAfter">When the admin certificate expires, if one is used.</param>
    /// <param name="trustedProxies">The trusted reverse proxies as described in the startup log.</param>
    public ServerInfo(
        DateTimeOffset startedAt,
        bool inDocker,
        string? listenerUrls,
        IReadOnlyList<int> adminPorts,
        bool adminHttps,
        string? adminCertificateFingerprint,
        DateTimeOffset? adminCertificateNotAfter,
        string trustedProxies)
    {
        var informational = typeof(ServerInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? typeof(ServerInfo).Assembly.GetName().Version?.ToString(3)
            ?? "unknown";
        var plus = informational.IndexOf('+');
        Version = plus < 0 ? informational : informational[..plus];
        Commit = plus < 0 ? null : informational[(plus + 1)..];
        StartedAt = startedAt;
        InDocker = inDocker;
        AdminPorts = adminPorts;
        VaultPorts = ParsePorts(listenerUrls).Where(/* Keeps ports that are not admin ports.
            * <param name="port">One listener port.</param>
            */ port => !adminPorts.Contains(port)).ToArray();
        AdminHttps = adminHttps;
        AdminCertificateFingerprint = adminCertificateFingerprint;
        AdminCertificateNotAfter = adminCertificateNotAfter;
        TrustedProxies = trustedProxies;
    }

    /// <summary>Reads the distinct ports from listener URLs such as "http://+:8080;http://+:8081".</summary>
    /// <param name="listenerUrls">The configured listener URLs, or null.</param>
    public static IReadOnlyList<int> ParsePorts(string? listenerUrls)
    {
        var ports = new List<int>();
        foreach (var url in (listenerUrls ?? string.Empty).Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var colon = url.LastIndexOf(':');
            var end = url.IndexOf('/', colon + 1);
            var text = colon < 0 ? string.Empty : end < 0 ? url[(colon + 1)..] : url[(colon + 1)..end];
            if (int.TryParse(text, out var port) && !ports.Contains(port))
            {
                ports.Add(port);
            }
        }
        return ports;
    }

    /// <summary>Lists the IPv4 and IPv6 addresses of the network interfaces that are up, without loopback and link-local addresses.</summary>
    public static IReadOnlyList<string> ReadAddresses()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(/* Keeps interfaces that are up and not loopback.
                    * <param name="nic">One network interface.</param>
                    */ nic => nic.OperationalStatus == OperationalStatus.Up && nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .SelectMany(/* Lists the unicast addresses of an interface.
                    * <param name="nic">One network interface.</param>
                    */ nic => nic.GetIPProperties().UnicastAddresses)
                .Select(/* Selects the address.
                    * <param name="unicast">One unicast address entry.</param>
                    */ unicast => unicast.Address)
                .Where(/* Keeps routable IPv4 and IPv6 addresses.
                    * <param name="address">One address.</param>
                    */ address => !IPAddress.IsLoopback(address) && !address.IsIPv6LinkLocal &&
                                 address.AddressFamily is AddressFamily.InterNetwork or AddressFamily.InterNetworkV6)
                .OrderBy(/* Lists IPv4 addresses first.
                    * <param name="address">One address.</param>
                    */ address => address.AddressFamily == AddressFamily.InterNetworkV6)
                .Select(/* Formats the address.
                    * <param name="address">One address.</param>
                    */ address => address.ToString())
                .Distinct()
                .ToArray();
        }
        catch (NetworkInformationException)
        {
            return [];
        }
    }

    /// <summary>Creates the dashboard view of the server information with the current uptime and addresses.</summary>
    /// <param name="now">The current time.</param>
    public ServerInfoDto ToDto(DateTimeOffset now) => new(
        Version,
        Commit,
        RuntimeInformation.FrameworkDescription,
        $"{RuntimeInformation.OSDescription} ({RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant()})",
        InDocker,
        StartedAt,
        (long)Math.Max(0, (now - StartedAt).TotalSeconds),
        ReadAddresses(),
        VaultPorts,
        AdminPorts,
        AdminHttps,
        AdminCertificateFingerprint,
        AdminCertificateNotAfter,
        TrustedProxies);
}
