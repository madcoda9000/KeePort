namespace KeePort.Api.Services;

/// <summary>
/// Applies the version retention once after start and then daily, so versions of vaults that are no longer saved also
/// expire after the configured number of days.
/// </summary>
/// <param name="vault">The service that removes versions beyond the limits.</param>
/// <param name="logger">The container log for failures.</param>
public sealed class VersionCleanupService(VaultService vault, ILogger<VersionCleanupService> logger) : BackgroundService
{
    /// <summary>Runs the clean-up after a short delay and then every 24 hours until the app stops.</summary>
    /// <param name="stoppingToken">Signals that the app is stopping.</param>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
            do
            {
                try
                {
                    vault.PruneAllVersions();
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
                {
                    logger.LogWarning(ex, "Could not clean up old vault versions.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // The app is stopping.
        }
    }
}
