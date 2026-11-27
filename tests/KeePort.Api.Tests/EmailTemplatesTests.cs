using KeePort.Api.Services;

namespace KeePort.Api.Tests;

public class EmailTemplatesTests
{
    private static readonly Dictionary<string, string> Values = new()
    {
        ["username"] = "anna", ["code"] = "123456", ["url"] = "https://vault.example.test/#token=abc", ["inviter"] = "admin",
        ["site"] = "https://vault.example.test", ["time"] = "2026-11-26 10:00 UTC", ["device"] = "Firefox 120 (Linux)", ["ip"] = "192.0.2.1",
        ["email"] = "anna@example.test", ["label"] = "Pixel 8", ["count"] = "12", ["minutes"] = "15", ["date"] = "2026-12-01", ["days"] = "5",
        ["free"] = "0.8 GB", ["total"] = "100.0 GB", ["sender"] = "anna", ["expires"] = "2026-12-01 10:00 UTC", ["views"] = "1"
    };

    /// <summary>Checks that every template renders in every language without missing texts or unfilled placeholders.</summary>
    [Fact]
    public void Every_Template_Renders_In_Every_Language()
    {
        var kinds = typeof(EmailTemplates.Kinds).GetFields().Select(/* Template name. */ f => (string)f.GetValue(null)!).ToList();
        Assert.Equal(20, kinds.Count);
        foreach (var language in new[] { "en", "de", "fr" })
        {
            foreach (var kind in kinds)
            {
                var email = EmailTemplates.Render(kind, language, "https://vault.example.test", Values);
                Assert.DoesNotContain(".subject", email.Subject);
                Assert.DoesNotContain("{", email.Subject + email.Text + email.Html);
                Assert.DoesNotContain(kind + ".", email.Text);
            }
        }
    }

    /// <summary>Checks that values are HTML-encoded and that links and codes appear in both bodies.</summary>
    [Fact]
    public void Values_Are_Encoded_And_Links_And_Codes_Appear()
    {
        var invite = EmailTemplates.Render(EmailTemplates.Kinds.Invite, "de", "https://vault.example.test",
            new Dictionary<string, string>(Values) { ["inviter"] = "<script>x</script>" });
        Assert.DoesNotContain("<script>", invite.Html);
        Assert.Contains("&lt;script&gt;", invite.Html);
        Assert.Contains("https://vault.example.test/#token=abc", invite.Text);
        Assert.Contains("href=\"https://vault.example.test/#token=abc\"", invite.Html);
        Assert.Equal("Du wurdest zu KeePort eingeladen", invite.Subject);
        var verify = EmailTemplates.Render(EmailTemplates.Kinds.Verify, "fr", "https://vault.example.test", Values);
        Assert.Contains("123456", verify.Text);
        Assert.Contains("123456", verify.Html);
    }
}
