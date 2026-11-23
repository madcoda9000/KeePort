using KeePort.Api.Data;

namespace KeePort.Api.Services;

public sealed record RateLimitSnapshot(RateLimitSettings Settings, long AuthVersion, long WebDavVersion);

public sealed class RateLimitSettingsService(KeePortDb db)
{
    private readonly object _writeLock = new();
    private RateLimitSnapshot _current = new(db.GetRateLimitSettings(), 0, 0);

    public RateLimitSnapshot Current => Volatile.Read(ref _current);

    /// <summary>Persists both limits before replacing the active quota for each changed policy.</summary>
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
