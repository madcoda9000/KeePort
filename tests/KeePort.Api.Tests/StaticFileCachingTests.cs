using KeePort.Api.Security;

namespace KeePort.Api.Tests;

public class StaticFileCachingTests
{
    /// <summary>Verifies that entry points are revalidated and only content-hashed assets are cached long-term.</summary>
    [Theory]
    [InlineData("/", StaticFileCaching.Revalidate)]
    [InlineData("/index.html", StaticFileCaching.Revalidate)]
    [InlineData("/admin/index.html", StaticFileCaching.Revalidate)]
    [InlineData("/favicon.svg", StaticFileCaching.Revalidate)]
    [InlineData(null, StaticFileCaching.Revalidate)]
    [InlineData("/assets/index-Ab12Cd34.js", StaticFileCaching.Immutable)]
    [InlineData("/admin/assets/index-Ab12Cd34.css", StaticFileCaching.Immutable)]
    [InlineData("/ASSETS/argon2-Ef56.wasm", StaticFileCaching.Immutable)]
    public void Chooses_Cache_Control_By_Path(string? path, string expected)
        => Assert.Equal(expected, StaticFileCaching.For(path));
}
