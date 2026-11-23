using KeePort.Api.Services;

namespace KeePort.Api.Tests;

public class PasswordHasherTests
{
    /// <summary>Verifies that a password hash accepts the original password and rejects a different one.</summary>
    [Fact]
    public void Hash_And_Verify_Roundtrip()
    {
        var hasher = new PasswordHasher();
        var encoded = hasher.Hash("Correct horse battery staple");
        Assert.StartsWith("argon2id$v=19$", encoded);
        Assert.True(hasher.Verify("Correct horse battery staple", encoded));
        Assert.False(hasher.Verify("wrong", encoded));
    }
}
