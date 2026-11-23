namespace KeePort.Api.Services;

public static class PasswordPolicy
{
    public const int MinLength = 10;
    public const int MaxLength = 256;

    /// <summary>Returns a password policy error or null when the candidate is accepted.</summary>
    /// <param name="password">The submitted password to check against the configured rules.</param>
    /// <param name="username">The optional account username that the password must not match.</param>
    public static string? Validate(string? password, string? username = null)
    {
        if (string.IsNullOrWhiteSpace(password))
        {
            return "Password is required.";
        }
        if (password.Length < MinLength)
        {
            return $"Password must be at least {MinLength} characters.";
        }
        if (password.Length > MaxLength)
        {
            return $"Password must be at most {MaxLength} characters.";
        }
        if (!string.IsNullOrWhiteSpace(username) && string.Equals(password, username, StringComparison.OrdinalIgnoreCase))
        {
            return "Password must not match the username.";
        }
        return null;
    }

    /// <summary>Returns a username validation error or null when the candidate is accepted.</summary>
    /// <param name="username">The proposed username to check against the account naming rules.</param>
    public static string? ValidateUsername(string? username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return "Username is required.";
        }
        var trimmed = username.Trim();
        if (trimmed.Length is < 3 or > 64)
        {
            return "Username must be between 3 and 64 characters.";
        }
        foreach (var ch in trimmed)
        {
            if (!(char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-' or '@'))
            {
                return "Username may only contain letters, digits, '.', '_', '-' and '@'.";
            }
        }
        return null;
    }
}
