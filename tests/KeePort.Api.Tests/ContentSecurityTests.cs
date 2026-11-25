using KeePort.Api.Security;

namespace KeePort.Api.Tests;

public class ContentSecurityTests
{
    /// <summary>Verifies that only web vault pages allow HTTPS images, for opt-in website icons.</summary>
    [Theory]
    [InlineData("/", ContentSecurity.Vault)]
    [InlineData("/index.html", ContentSecurity.Vault)]
    [InlineData("/assets/index-Ab12.js", ContentSecurity.Vault)]
    [InlineData("/admin", ContentSecurity.Admin)]
    [InlineData("/admin/", ContentSecurity.Admin)]
    [InlineData("/ADMIN/assets/index-Cd34.js", ContentSecurity.Admin)]
    [InlineData("/administrator", ContentSecurity.Vault)]
    [InlineData("/api/vault/files", ContentSecurity.Api)]
    [InlineData("/webdav/family.kdbx", ContentSecurity.Api)]
    [InlineData(null, ContentSecurity.Vault)]
    public void Chooses_Policy_By_Path(string? path, string expected)
        => Assert.Equal(expected, ContentSecurity.For(path));

    /// <summary>Verifies that the admin console never loads images from other hosts.</summary>
    [Fact]
    public void Admin_Policy_Does_Not_Allow_External_Images()
    {
        Assert.Contains("img-src 'self' data:;", ContentSecurity.Admin);
        Assert.Contains("img-src 'self' data: https:;", ContentSecurity.Vault);
    }
}
