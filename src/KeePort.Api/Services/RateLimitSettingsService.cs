using KeePort.Api.Data;

namespace KeePort.Api.Services;

/// <summary>Pairs the active limits with policy revisions used to invalidate old quota partitions.</summary>
/// <param name="Settings">The currently active authentication and WebDAV request limits.</param>
/// <param name="AuthVersion">The revision used to key authentication quota partitions.</param>
/// <param name="WebDavVersion">The revision used to key WebDAV quota partitions.</param>
public sealed record RateLimitSnapshot(RateLimitSettings Settings, long AuthVersion, long WebDavVersion);

/// <summary>Loads persisted rate limits and publishes new snapshots after saving changes.</summary>
/// <param name="db">The SQLite store for KeePort metadata.</param>
public sealed class RateLimitSettingsService(KeePortDb db)
{
    private readonly object _writeLock = new();
    private RateLimitSnapshot _current = new(db.GetRateLimitSettings(), 0, 0);

    /// <summary>Reads the current immutable rate-limit snapshot atomically.</summary>
    public RateLimitSnapshot Current => Volatile.Read(ref _current);

    /// <summary>Persists both limits before replacing the active quota for each changed policy.</summary>
    /// <param name="settings">The configured login/setup and WebDAV request limits.</param>
    public void Update(RateLimitSettings settings)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(settings.AuthPerMinute);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(settings.WebDavPerMinute);

        lock (_writeLock)
        {
            var previous = Current;
            if (settings == previous.Settings)
            {
                return;
            }

            db.UpdateRateLimitSettings(settings);
            Volatile.Write(ref _current, new RateLimitSnapshot(
                settings,
                previous.AuthVersion + (settings.AuthPerMinute != previous.Settings.AuthPerMinute ? 1 : 0),
                previous.WebDavVersion + (settings.WebDavPerMinute != previous.Settings.WebDavPerMinute ? 1 : 0)));
        }
    }
}
