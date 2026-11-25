using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace KeePort.Api.Services;

/// <summary>The image a website uses as its icon.</summary>
/// <param name="Data">The image bytes, at most <see cref="FaviconFetcher.MaxIconBytes"/>.</param>
/// <param name="ContentType">The media type the site reported, e.g. image/png or image/x-icon.</param>
public sealed record FaviconResult(byte[] Data, string ContentType);

/// <summary>Downloads website icons for the web vault.</summary>
public interface IFaviconFetcher
{
    /// <summary>Downloads the icon of a public website, or returns null when the site has none or cannot be reached.</summary>
    /// <param name="host">A validated host name such as github.com.</param>
    /// <param name="cancellationToken">A token that cancels the download.</param>
    Task<FaviconResult?> FetchAsync(string host, CancellationToken cancellationToken);
}

/// <summary>
/// Fetches website icons on behalf of a signed-in user who asked to store one in a vault. Because KeePort usually runs
/// inside a home network, every connection is checked against a block list of private, loopback and reserved addresses
/// (also after redirects and against DNS rebinding), only HTTPS on port 443 is used, proxies are ignored, and sizes and
/// time are limited. No vault content is involved: the browser only sends the host name.
/// </summary>
public sealed partial class FaviconFetcher : IFaviconFetcher
{
    /// <summary>The largest icon KeePort downloads.</summary>
    public const int MaxIconBytes = 256 * 1024;

    /// <summary>The largest start page KeePort reads to find icon links.</summary>
    public const int MaxHtmlBytes = 512 * 1024;

    private readonly HttpClient _client;

    /// <summary>Creates the fetcher with a connection handler that only reaches public addresses.</summary>
    public FaviconFetcher()
        : this(CreateHandler())
    {
    }

    /// <summary>Creates the fetcher with a custom handler, for tests.</summary>
    /// <param name="handler">The HTTP handler to send requests with.</param>
    public FaviconFetcher(HttpMessageHandler handler)
    {
        _client = new HttpClient(handler, disposeHandler: true) { Timeout = TimeSpan.FromSeconds(8) };
        _client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("KeePort-IconFetcher", "1.0"));
        _client.DefaultRequestHeaders.Accept.ParseAdd("image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5");
    }

    /// <summary>Creates the socket handler that checks every address it connects to.</summary>
    private static SocketsHttpHandler CreateHandler() => new()
    {
        UseProxy = false,
        UseCookies = false,
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 3,
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(5),
        PooledConnectionLifetime = TimeSpan.FromMinutes(1),
        ConnectCallback = ConnectToPublicAddressAsync
    };

    /// <summary>
    /// Resolves the host and connects only if all of its addresses are public and the port is 443, so redirects and DNS
    /// rebinding cannot reach the local network.
    /// </summary>
    /// <param name="context">The host and port the handler wants to connect to.</param>
    /// <param name="cancellationToken">A token that cancels the connection.</param>
    private static async ValueTask<Stream> ConnectToPublicAddressAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        if (context.DnsEndPoint.Port != 443)
        {
            throw new HttpRequestException("Only HTTPS on port 443 is allowed for website icons.");
        }
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
        if (addresses.Length == 0 || !addresses.All(IsPublicAddress))
        {
            throw new HttpRequestException("The website resolves to a private or reserved address.");
        }
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, 443, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Checks whether a host name is a public DNS name KeePort may contact: at least one dot, letters, digits and hyphens,
    /// a letter-only top-level domain, and no IP address or localhost.
    /// </summary>
    /// <param name="host">The host name from the request.</param>
    public static bool IsValidHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host) || host.Length > 253 || IPAddress.TryParse(host, out _))
        {
            return false;
        }
        var value = host.Trim().TrimEnd('.').ToLowerInvariant();
        return HostPattern().IsMatch(value) && !value.EndsWith(".localhost", StringComparison.Ordinal) && !value.EndsWith(".local", StringComparison.Ordinal);
    }

    /// <summary>Checks whether an address is on the public internet, i.e. not loopback, private, link-local or reserved.</summary>
    /// <param name="address">A resolved address.</param>
    public static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }
        if (IPAddress.IsLoopback(address))
        {
            return false;
        }
        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2))
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                || (b[0] == 203 && b[1] == 0 && b[2] == 113));
        }
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var unspecified = b.All(/* Checks for the all-zero address.
                * <param name="value">One byte of the address.</param>
                */ value => value == 0);
            return !(unspecified
                || (b[0] & 0xfe) == 0xfc            // unique local fc00::/7
                || (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) // link-local fe80::/10
                || b[0] == 0xff                      // multicast
                || (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) // documentation 2001:db8::/32
                || (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00) // Teredo 2001::/32
                || (b[0] == 0x20 && b[1] == 0x02)    // 6to4 2002::/16, may embed private IPv4
                || (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b)); // NAT64 64:ff9b::/96
        }
        return false;
    }

    /// <summary>
    /// Finds icon links in a start page: link elements whose rel contains "icon" (icon, shortcut icon, apple-touch-icon),
    /// resolved against the page address. Only HTTPS links are returned, in the order they appear.
    /// </summary>
    /// <param name="html">The start page.</param>
    /// <param name="baseUri">The address of the page, used to resolve relative links.</param>
    public static IReadOnlyList<Uri> FindIconLinks(string html, Uri baseUri)
    {
        var links = new List<Uri>();
        foreach (Match tag in LinkTagPattern().Matches(html))
        {
            var rel = AttributePattern("rel").Match(tag.Value);
            var href = AttributePattern("href").Match(tag.Value);
            if (!rel.Success || !href.Success || !rel.Groups["value"].Value.Contains("icon", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var value = WebUtility.HtmlDecode(href.Groups["value"].Value.Trim());
            if (Uri.TryCreate(baseUri, value, out var uri) && uri.Scheme == Uri.UriSchemeHttps && !links.Contains(uri))
            {
                links.Add(uri);
            }
        }
        return links;
    }

    /// <inheritdoc />
    public async Task<FaviconResult?> FetchAsync(string host, CancellationToken cancellationToken)
    {
        var start = new Uri($"https://{host}/");
        var icon = await TryIconAsync(new Uri(start, "/favicon.ico"), cancellationToken);
        if (icon is not null)
        {
            return icon;
        }
        var html = await TryReadAsync(start, MaxHtmlBytes, /* Accepts HTML pages.
            * <param name="type">The response media type.</param>
            */ type => type.Contains("html", StringComparison.OrdinalIgnoreCase), cancellationToken);
        if (html is null)
        {
            return null;
        }
        foreach (var link in FindIconLinks(Encoding.UTF8.GetString(html.Value.Data), start).Take(4))
        {
            icon = await TryIconAsync(link, cancellationToken);
            if (icon is not null)
            {
                return icon;
            }
        }
        return null;
    }

    /// <summary>Downloads one icon address and accepts it only if it is an image within the size limit.</summary>
    /// <param name="uri">The icon address.</param>
    /// <param name="cancellationToken">A token that cancels the download.</param>
    private async Task<FaviconResult?> TryIconAsync(Uri uri, CancellationToken cancellationToken)
    {
        var result = await TryReadAsync(uri, MaxIconBytes, /* Accepts images; .ico files are often served as octet-stream.
            * <param name="type">The response media type.</param>
            */ type => type.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                || (type.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)),
            cancellationToken);
        return result is { } value && value.Data.Length > 0 ? new FaviconResult(value.Data, value.ContentType) : null;
    }

    /// <summary>Reads a response body up to a size limit if the status and media type fit, otherwise returns null.</summary>
    /// <param name="uri">The address to read.</param>
    /// <param name="maxBytes">The largest body accepted.</param>
    /// <param name="acceptType">Decides whether the response media type is acceptable.</param>
    /// <param name="cancellationToken">A token that cancels the download.</param>
    private async Task<(byte[] Data, string ContentType)?> TryReadAsync(Uri uri, int maxBytes, Func<string, bool> acceptType, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            var type = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
            if (!response.IsSuccessStatusCode || !acceptType(type) || response.Content.Headers.ContentLength > maxBytes)
            {
                return null;
            }
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[16 * 1024];
            int read;
            while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > maxBytes)
                {
                    return null;
                }
                buffer.Write(chunk, 0, read);
            }
            return (buffer.ToArray(), type);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or SocketException)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            return null;
        }
    }

    /// <summary>Matches a DNS name with at least two labels and a letter-only top-level domain.</summary>
    [GeneratedRegex(@"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")]
    private static partial Regex HostPattern();

    /// <summary>Matches link start tags.</summary>
    [GeneratedRegex(@"<link\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex LinkTagPattern();

    /// <summary>Matches one attribute of a tag with a quoted or unquoted value.</summary>
    /// <param name="name">The attribute name.</param>
    private static Regex AttributePattern(string name)
        => new($@"\b{name}\s*=\s*(?:""(?<value>[^""]*)""|'(?<value>[^']*)'|(?<value>[^\s>]+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
}
