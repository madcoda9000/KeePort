using System.Net;
using System.Security.Cryptography.X509Certificates;
using KeePort.Api.Security;

namespace KeePort.Api.Tests;

public class AdminTlsTests : IDisposable
{
    private readonly string _dataDir = Path.Combine(Path.GetTempPath(), $"keeport-tls-{Guid.NewGuid():N}");

    /// <summary>Removes the temporary data directory.</summary>
    public void Dispose()
    {
        try { Directory.Delete(_dataDir, recursive: true); } catch { /* best effort test cleanup */ }
    }

    /// <summary>Verifies that only listener URLs on admin ports switch to https.</summary>
    [Theory]
    [InlineData("http://+:8080;http://+:8081", "http://+:8080;https://+:8081")]
    [InlineData("http://*:8080; http://0.0.0.0:8081", "http://*:8080;https://0.0.0.0:8081")]
    [InlineData("http://[::]:8081", "https://[::]:8081")]
    [InlineData("https://+:8081", "https://+:8081")]
    [InlineData("http://+:8080", "http://+:8080")]
    public void Rewrites_Admin_Listener_Urls(string urls, string expected)
        => Assert.Equal(expected, AdminTls.RewriteUrls(urls, [8081]));

    /// <summary>Verifies that a certificate is created once, stored, and reused with the same fingerprint.</summary>
    [Fact]
    public void Creates_And_Reuses_The_Certificate()
    {
        var now = DateTimeOffset.UtcNow;
        var (first, created) = AdminTls.LoadOrCreate(_dataDir, ["192.168.1.20", "nas.local"], now);
        Assert.True(created);
        Assert.True(first.HasPrivateKey);
        Assert.True(File.Exists(Path.Combine(_dataDir, AdminTls.RelativePath)));
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(_dataDir, AdminTls.RelativePath)));
        }

        var names = first.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single();
        Assert.Contains("localhost", names.EnumerateDnsNames());
        Assert.Contains("nas.local", names.EnumerateDnsNames());
        Assert.Contains(IPAddress.Parse("192.168.1.20"), names.EnumerateIPAddresses());
        Assert.Contains(IPAddress.Loopback, names.EnumerateIPAddresses());

        var (second, createdAgain) = AdminTls.LoadOrCreate(_dataDir, ["nas.local", "192.168.1.20"], now.AddDays(1));
        Assert.False(createdAgain);
        Assert.Equal(AdminTls.Fingerprint(first), AdminTls.Fingerprint(second));
        Assert.Matches("^([0-9A-F]{2}:){31}[0-9A-F]{2}$", AdminTls.Fingerprint(second));
    }

    /// <summary>Verifies renewal when the certificate expires soon or a new host name is configured.</summary>
    [Fact]
    public void Renews_Expiring_Or_Incomplete_Certificates()
    {
        var now = DateTimeOffset.UtcNow;
        var (original, _) = AdminTls.LoadOrCreate(_dataDir, [], now);

        var (withHost, renewedForHost) = AdminTls.LoadOrCreate(_dataDir, ["192.168.1.30"], now);
        Assert.True(renewedForHost);
        Assert.NotEqual(AdminTls.Fingerprint(original), AdminTls.Fingerprint(withHost));

        var nearExpiry = withHost.NotAfter.ToUniversalTime() - AdminTls.RenewBefore + TimeSpan.FromDays(1);
        var (renewed, renewedForExpiry) = AdminTls.LoadOrCreate(_dataDir, ["192.168.1.30"], new DateTimeOffset(nearExpiry, TimeSpan.Zero));
        Assert.True(renewedForExpiry);
        Assert.True(renewed.NotAfter > withHost.NotAfter);
    }

    /// <summary>Verifies that an unreadable certificate file is replaced instead of stopping the startup.</summary>
    [Fact]
    public void Replaces_An_Unreadable_Certificate()
    {
        var path = Path.Combine(_dataDir, AdminTls.RelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "not a certificate");

        var (certificate, created) = AdminTls.LoadOrCreate(_dataDir, [], DateTimeOffset.UtcNow);
        Assert.True(created);
        Assert.True(certificate.HasPrivateKey);
    }
}
