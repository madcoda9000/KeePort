using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using ProxyNetwork = Microsoft.AspNetCore.HttpOverrides.IPNetwork;

namespace KeePort.Api.Security;

/// <summary>Signals an invalid entry in the trusted proxy configuration (KEEPORT_TRUSTED_PROXIES).</summary>
/// <param name="message">The human-readable description of the invalid entry.</param>
public sealed class TrustedProxyConfigurationException(string message) : Exception(message);

/// <summary>
/// The reverse proxies whose X-Forwarded-For and X-Forwarded-Proto headers KeePort accepts, in addition to loopback.
/// </summary>
/// <param name="Proxies">Single trusted proxy addresses.</param>
/// <param name="Networks">Trusted proxy networks in CIDR notation.</param>
public sealed record TrustedProxyList(IReadOnlyList<IPAddress> Proxies, IReadOnlyList<ProxyNetwork> Networks)
{
    private static readonly char[] Separators = [',', ';', ' ', '\t', '\r', '\n'];

    /// <summary>
    /// Parses a list of IP addresses and CIDR networks separated by commas, semicolons or whitespace.
    /// An empty value trusts only loopback. Catch-all networks and unspecified addresses are rejected because
    /// they would let any client spoof its address and bypass per-IP rate limits.
    /// </summary>
    /// <param name="value">The configured value, for example "172.18.0.1, 10.10.0.0/16".</param>
    /// <exception cref="TrustedProxyConfigurationException">An entry is not a valid, specific address or network.</exception>
    public static TrustedProxyList Parse(string? value)
    {
        var proxies = new List<IPAddress>();
        var networks = new List<ProxyNetwork>();
        foreach (var entry in (value ?? string.Empty).Split(Separators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var slash = entry.IndexOf('/');
            if (slash < 0)
            {
                proxies.Add(ParseAddress(entry, entry));
                continue;
            }

            var address = ParseAddress(entry[..slash], entry);
            var maxPrefix = address.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
            if (!int.TryParse(entry[(slash + 1)..], out var prefix) || prefix < 0 || prefix > maxPrefix)
            {
                throw new TrustedProxyConfigurationException($"'{entry}' has an invalid prefix length; use 1–{maxPrefix}.");
            }
            if (prefix == 0)
            {
                throw new TrustedProxyConfigurationException($"'{entry}' would trust every address. List the proxy's own address or network instead.");
            }
            networks.Add(new ProxyNetwork(MaskAddress(address, prefix), prefix));
        }
        return new TrustedProxyList(proxies, networks);
    }

    /// <summary>Adds the trusted proxies to the forwarded-header options, keeping the default loopback entries.</summary>
    /// <param name="options">The forwarded-header options used by the middleware.</param>
    public void ApplyTo(ForwardedHeadersOptions options)
    {
        foreach (var proxy in Proxies)
        {
            options.KnownProxies.Add(proxy);
        }
        foreach (var network in Networks)
        {
            options.KnownNetworks.Add(network);
        }
    }

    /// <summary>Describes the trusted sources for the startup log.</summary>
    public string Describe()
    {
        var entries = Proxies.Select(/* Formats a single trusted proxy address.
         * <param name="p">The trusted proxy address.</param>
         */ p => p.ToString())
            .Concat(Networks.Select(/* Formats a trusted network in CIDR notation.
             * <param name="n">The trusted proxy network.</param>
             */ n => $"{n.Prefix}/{n.PrefixLength}"))
            .ToArray();
        return entries.Length == 0 ? "loopback only" : $"loopback, {string.Join(", ", entries)}";
    }

    /// <summary>Parses one address, mapping IPv4-in-IPv6 notation to IPv4 and rejecting unspecified addresses.</summary>
    /// <param name="text">The address text to parse.</param>
    /// <param name="entry">The complete configuration entry, quoted in error messages.</param>
    private static IPAddress ParseAddress(string text, string entry)
    {
        if (!IPAddress.TryParse(text, out var address))
        {
            throw new TrustedProxyConfigurationException($"'{entry}' is not a valid IP address or CIDR network.");
        }
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }
        if (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
        {
            throw new TrustedProxyConfigurationException($"'{entry}' is not a proxy address. List the proxy's own address or network instead.");
        }
        return address;
    }

    /// <summary>Clears the host bits so "172.18.0.1/16" is stored as the network "172.18.0.0/16".</summary>
    /// <param name="address">An address inside the network.</param>
    /// <param name="prefix">The network prefix length in bits.</param>
    private static IPAddress MaskAddress(IPAddress address, int prefix)
    {
        var bytes = address.GetAddressBytes();
        for (var i = 0; i < bytes.Length; i++)
        {
            var bits = Math.Clamp(prefix - (i * 8), 0, 8);
            bytes[i] &= (byte)(0xFF << (8 - bits));
        }
        return new IPAddress(bytes);
    }
}

/// <summary>Formats client addresses consistently for rate limits, logs and sessions.</summary>
public static class ClientIp
{
    /// <summary>Formats an address, showing IPv4 clients of a dual-stack socket as plain IPv4 instead of ::ffff:a.b.c.d.</summary>
    /// <param name="address">The client address, if known.</param>
    public static string? Format(IPAddress? address)
        => address is null ? null : (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();
}

/// <summary>Logs a hint when a request carries X-Forwarded-For from a sender that is not a trusted proxy.</summary>
public static class ForwardedHeaderDiagnostics
{
    private const int MaxTrackedSenders = 1024;
    private static readonly TimeSpan WarningInterval = TimeSpan.FromHours(1);

    /// <summary>
    /// Adds middleware after <c>UseForwardedHeaders</c> that detects ignored forwarding headers and logs at most one
    /// warning per sender and hour, so admins learn which address to add to KEEPORT_TRUSTED_PROXIES.
    /// </summary>
    /// <param name="app">The application pipeline to which the middleware is added.</param>
    public static IApplicationBuilder UseForwardedHeaderDiagnostics(this IApplicationBuilder app)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger("KeePort.ForwardedHeaders");
        var lastWarnings = new ConcurrentDictionary<string, DateTimeOffset>(StringComparer.Ordinal);

        // Warns when the forwarded-header middleware left X-Forwarded-For unapplied because the sender is untrusted.
        // <param name="context">The current HTTP request and response context.</param>
        // <param name="next">The next middleware in the request pipeline.</param>
        return app.Use(async (context, next) =>
        {
            var headers = context.Request.Headers;
            if (headers.ContainsKey("X-Forwarded-For") && !headers.ContainsKey("X-Original-For"))
            {
                var sender = ClientIp.Format(context.Connection.RemoteIpAddress) ?? "unknown";
                var now = DateTimeOffset.UtcNow;
                if (!lastWarnings.TryGetValue(sender, out var last) || now - last >= WarningInterval)
                {
                    if (lastWarnings.Count >= MaxTrackedSenders)
                    {
                        lastWarnings.Clear();
                    }
                    lastWarnings[sender] = now;
                    logger.LogWarning(
                        "Ignored X-Forwarded-For from {Sender}: it is not a trusted proxy, so KeePort sees {Sender} as the client address. If {Sender} is your reverse proxy, add it to KEEPORT_TRUSTED_PROXIES.",
                        sender, sender, sender);
                }
            }
            await next();
        });
    }
}
