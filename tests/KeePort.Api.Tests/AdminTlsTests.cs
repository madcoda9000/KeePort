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

    /// <summary>A certificate file as KeePort 0.26.1 on .NET 8 wrote it (self-signed, created for this test only; valid 2026-11-19 to 2031-11-19).</summary>
    private const string Net8CertificatePfx =
        "MIID8wIBAzCCA68GCSqGSIb3DQEHAaCCA6AEggOcMIIDmDCB+gYJKoZIhvcNAQcBoIHsBIHpMIHmMIHjBgsqhkiG9w0BDAoBAqCB"
        + "vDCBuTAkBgoqhkiG9w0BDAEDMBYEEPa4b7iGHxFyCORRGJ3L5TsCAgfQBIGQgenNnpmEp7FASKPTw583bfg8I8vbgANVLSPDjLOs"
        + "cSXpeF1l1z5EWLts1nWW4FO+fDLdY8MxOR94P7YoIUxK6jaHtzFeNhGDDd696kgHUH942LFmU+rcIObSKPFB1pQfen5gBaQeXiqZ"
        + "VAXzXT3L7GJ20nKiRMgHAuY8TYxyzp5G46t/iRiRUz6/qX4W0R9RMRUwEwYJKoZIhvcNAQkVMQYEBAAAAAAwggKXBgkqhkiG9w0B"
        + "BwagggKIMIIChAIBADCCAn0GCSqGSIb3DQEHATAkBgoqhkiG9w0BDAEDMBYEEKjar2Y0s2exiMpsZScPKSUCAgfQgIICSHw0fhqd"
        + "nkvBJmSAZ/rqSy4ur+NLpESPaB8R146meDDxZ/J5dtGR385Wx+8iLBSC4kkF1gb0I3x5Io2yaYZ4pH6rK/osgnOzJezdqFl5o8zm"
        + "5nTVfUSztpE/KKkulVaTqYw+mVF+oEkgX7fEqF4HAYyaMSiKbWyg1Sjo29uzkvl8zVnpE+x4tP1dbWnFMkQK4uBmNnwz3cp7txrd"
        + "/ES5oxgs2VEnW9xEczvoFE5S0xwGKx6CTeS/ppRRTKNNWfpub4I2jlTbFc2ePYOgv6+O8YkNW+NXpCqoBHyX/tj/VyMXcXkYw5e/"
        + "8E4CULHEVq59hc2rrLcHuCmeoD87KNSF4AFP18NyFZ4Fyfr6iAlcAu2tyH2f/uF+YApFclBwqzZfrTcBNyYdT8ECNvvVWByYB+9g"
        + "hSbJXst3C1RTTeXrJnxWczuOOd0b7zsu8YuWEXuUnfyF+p30kINQVT1ASS7gys4YCO0Q39mXO5urVNt5ijMePJ2ilGmtF75BitUp"
        + "fHLSsk16kLOLFLzglQNdn9n6m+3x5p5sa2rEC2wHcX0UN+xy1Nz5nxJNxNsmcsDRdqqeGPBUIZPbyvZp+YsOMNmFyTMbOXexlucq"
        + "SstuBKRK6AQlxVj+PrHxz4FEAf7DnZRAq6hu5nPO+PQfKMOnGrqisA3r5vfauAUf9Et/qgHMwq8hZQ1cDnyRbtUeUlPiGHTLv8+n"
        + "pdbyhGGBRFLWOdkMVa02Os+lyMqS0n+5RsjY/vJYVRIa0P2f/Z66qBXqUK/yzsX8vcmZLgQiMDswHzAHBgUrDgMCGgQUlJox5mLB"
        + "oPC0hLLCzeO7T+AhbM8EFM+QCD+sePcY128RXeLiAk7molYzAgIH0A==";

    /// <summary>The SHA-256 fingerprint of <see cref="Net8CertificatePfx"/> as the admin console shows it.</summary>
    private const string Net8CertificateFingerprint = "1A:CA:88:4E:5D:5A:03:00:98:9A:B3:A1:AE:6F:A1:F4:8D:8A:CD:95:B3:5D:18:89:C6:87:41:11:13:2D:3A:7E";

    /// <summary>Verifies that a certificate written by the .NET 8 builds is still loaded and kept, so its fingerprint does not change on update.</summary>
    [Fact]
    public void Keeps_A_Certificate_Written_By_Net8_Builds()
    {
        var path = Path.Combine(_dataDir, AdminTls.RelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, Convert.FromBase64String(Net8CertificatePfx));

        var (certificate, created) = AdminTls.LoadOrCreate(_dataDir, [], new DateTimeOffset(2026, 11, 28, 12, 0, 0, TimeSpan.Zero));
        Assert.False(created);
        Assert.True(certificate.HasPrivateKey);
        Assert.Equal(Net8CertificateFingerprint, AdminTls.Fingerprint(certificate));
    }
}
