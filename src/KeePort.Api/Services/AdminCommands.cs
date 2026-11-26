using KeePort.Api.Data;
using Microsoft.Extensions.Logging.Abstractions;

namespace KeePort.Api.Services;

/// <summary>
/// Emergency commands run inside the container instead of starting the server, e.g.
/// <c>docker compose exec keeport keeport-admin reset-mfa &lt;username&gt;</c>. Whoever can run them already controls the
/// container and its data, so they need no password.
/// </summary>
public static class AdminCommands
{
    /// <summary>Whether the command line asks for an admin command instead of the server.</summary>
    /// <param name="args">The command-line arguments.</param>
    public static bool IsCommand(string[] args) => args.Length > 0 && args[0] is "reset-mfa" or "help";

    /// <summary>Runs an admin command and returns the process exit code.</summary>
    /// <param name="args">The command-line arguments, starting with the command.</param>
    /// <param name="configuration">The configuration with the data directory.</param>
    /// <param name="output">Where messages go.</param>
    public static int Run(string[] args, IConfiguration configuration, TextWriter output)
    {
        if (args is not ["reset-mfa", var username])
        {
            output.WriteLine("Usage: keeport-admin reset-mfa <username>");
            output.WriteLine("  Turns off two-factor sign-in for the account and signs it out everywhere.");
            return args is ["help"] ? 0 : 2;
        }

        var db = new KeePortDb(configuration);
        db.Initialize();
        var user = db.GetUserByUsername(username);
        if (user is null)
        {
            output.WriteLine($"No account named '{username}' exists.");
            return 1;
        }
        db.ResetMfa(user.Id);
        db.DeleteSessionsForUser(user.Id);
        new AuditLog(db, NullLogger<AuditLog>.Instance).Record(null, AuditActions.MfaReset, actorName: "Container command",
            targetType: "user", targetId: user.Id, targetName: user.Username, details: "Reset with keeport-admin, signed out everywhere");
        output.WriteLine($"Two-factor sign-in for '{user.Username}' is off. Sign in with the password and set it up again in the profile.");
        return 0;
    }
}
