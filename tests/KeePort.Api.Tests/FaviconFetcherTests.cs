using System.Net;
using System.Text;
using KeePort.Api.Services;

namespace KeePort.Api.Tests;

public class FaviconFetcherTests
{
    /// <summary>Verifies that only public DNS names are accepted, never IP addresses or local names.</summary>
    [Theory]
    [InlineData("github.com", true)]
    [InlineData("mail.example.org", true)]
    [InlineData("Bank.Example.DE.", true)]
    [InlineData("xn--mnchen-3ya.de", true)]
    [InlineData("localhost", false)]
    [InlineData("nas", false)]
    [InlineData("router.local", false)]
    [InlineData("app.localhost", false)]
    [InlineData("192.168.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("[::1]", false)]
    [InlineData("example.com:8443", false)]
    [InlineData("example.com/path", false)]
    [InlineData("exa mple.com", false)]
    [InlineData("-bad.example.com", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Accepts_Only_Public_Host_Names(string? host, bool expected)
        => Assert.Equal(expected, FaviconFetcher.IsValidHost(host));

    /// <summary>Verifies the block list for private, loopback, link-local and reserved addresses.</summary>
    [Theory]
    [InlineData("140.82.121.4", true)]
    [InlineData("1.1.1.1", true)]
    [InlineData("2a00:1450:4001:82b::200e", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("192.168.2.245", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("255.255.255.255", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fd12:3456::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("::ffff:192.168.0.1", false)]
    [InlineData("::ffff:8.8.8.8", true)]
    [InlineData("2002:c0a8:0001::1", false)]
    [InlineData("64:ff9b::c0a8:1", false)]
    public void Blocks_Private_And_Reserved_Addresses(string address, bool expected)
        => Assert.Equal(expected, FaviconFetcher.IsPublicAddress(IPAddress.Parse(address)));

    /// <summary>Verifies that icon links are found in start pages and only HTTPS links are kept.</summary>
    [Fact]
    public void Finds_Icon_Links_In_Start_Pages()
    {
        const string html = """
            <html><head>
            <link rel="stylesheet" href="/site.css">
            <link rel="shortcut icon" href="/static/favicon.png">
            <LINK HREF='https://cdn.example.net/icon.svg' REL='icon'>
            <link rel=apple-touch-icon href=apple.png>
            <link rel="icon" href="http://insecure.example.com/icon.png">
            <link rel="icon" href="/static/favicon.png">
            </head></html>
            """;
        var links = FaviconFetcher.FindIconLinks(html, new Uri("https://example.com/"));
        Assert.Equal(new[]
        {
            "https://example.com/static/favicon.png",
            "https://cdn.example.net/icon.svg",
            "https://example.com/apple.png"
        }, links.Select(/* Formats a link.
            * <param name="uri">One found link.</param>
            */ uri => uri.ToString()));
    }

    /// <summary>Verifies the fallback to icon links when /favicon.ico is missing, and the type and size checks.</summary>
    [Fact]
    public async Task Falls_Back_To_The_Start_Page_And_Checks_Type_And_Size()
    {
        var png = new byte[] { 0x89, 0x50, 0x4e, 0x47, 1, 2, 3 };
        var handler = new StubHandler(/* Answers like a site without /favicon.ico but with an icon link.
            * <param name="request">The request the fetcher sent.</param>
            */ request => request.RequestUri!.AbsolutePath switch
        {
            "/favicon.ico" => new HttpResponseMessage(HttpStatusCode.NotFound),
            "/" => Html("<link rel=\"icon\" href=\"/img/logo.png\">"),
            "/img/logo.png" => Image(png, "image/png"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        var icon = await new FaviconFetcher(handler).FetchAsync("example.com", CancellationToken.None);
        Assert.NotNull(icon);
        Assert.Equal(png, icon!.Data);
        Assert.Equal("image/png", icon.ContentType);
        Assert.Equal(new[] { "/favicon.ico", "/", "/img/logo.png" }, handler.Paths);

        var notImage = new StubHandler(/* Answers every request with HTML.
            * <param name="request">The request the fetcher sent.</param>
            */ _ => Html("<p>no icon</p>"));
        Assert.Null(await new FaviconFetcher(notImage).FetchAsync("example.com", CancellationToken.None));

        var tooLarge = new StubHandler(/* Answers with an image above the size limit.
            * <param name="request">The request the fetcher sent.</param>
            */ _ => Image(new byte[FaviconFetcher.MaxIconBytes + 1], "image/x-icon"));
        Assert.Null(await new FaviconFetcher(tooLarge).FetchAsync("example.com", CancellationToken.None));
    }

    /// <summary>Creates an HTML response.</summary>
    /// <param name="html">The page.</param>
    private static HttpResponseMessage Html(string html)
        => new(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") };

    /// <summary>Creates an image response.</summary>
    /// <param name="data">The image bytes.</param>
    /// <param name="type">The media type.</param>
    private static HttpResponseMessage Image(byte[] data, string type)
    {
        var content = new ByteArrayContent(data);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(type);
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
    }

    /// <summary>An HTTP handler that answers from a function and records the requested paths.</summary>
    /// <param name="respond">Creates the response for a request.</param>
    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        /// <summary>The paths requested so far.</summary>
        public List<string> Paths { get; } = [];

        /// <inheritdoc />
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(respond(request));
        }
    }
}
