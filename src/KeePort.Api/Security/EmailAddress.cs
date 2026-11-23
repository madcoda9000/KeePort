using System.Net.Mail;

namespace KeePort.Api.Security;

internal static class EmailAddress
{
    /// <summary>Trims a single mailbox address, or returns null if its format is invalid.</summary>
    public static string? Normalize(string? value)
    {
        var email = value?.Trim();
        if (email is null or { Length: 0 or > 254 } || email.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)))
        {
            return null;
        }

        return MailAddress.TryCreate(email, out var address)
            && string.Equals(address.Address, email, StringComparison.Ordinal)
            && Uri.CheckHostName(address.Host) == UriHostNameType.Dns
            ? email
            : null;
    }
}
