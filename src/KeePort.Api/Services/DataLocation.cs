using System.Text.RegularExpressions;

namespace KeePort.Api.Services;

/// <summary>Where the data directory comes from, as seen from inside the container.</summary>
public enum DataStorageKind
{
    /// <summary>A folder of the host is mounted (KEEPORT_DATA set to a path) — included in NAS backups.</summary>
    HostFolder,
    /// <summary>A Docker named volume — NAS backup tools such as Hyper Backup do not include it.</summary>
    DockerVolume,
    /// <summary>Not mounted at all — the data lives in the container and is lost when it is recreated.</summary>
    NotMounted,
    /// <summary>Not running in Docker, or the mount table is unavailable.</summary>
    Unknown
}

/// <summary>Describes the data directory's storage for the startup log and the admin console.</summary>
/// <param name="Kind">The kind of storage behind the data directory.</param>
/// <param name="DataDir">The data directory inside the container, e.g. /data.</param>
/// <param name="Source">The source path on the host's file system, if known. On NAS systems it is the storage system's view, e.g. /@syno/docker/keeport-data on Synology.</param>
/// <param name="VolumeName">The Docker volume name for <see cref="DataStorageKind.DockerVolume"/>, otherwise null.</param>
public sealed record DataStorageInfo(DataStorageKind Kind, string DataDir, string? Source, string? VolumeName)
{
    /// <summary>Whether NAS backup tools are likely to miss the data, so admins should be warned.</summary>
    public bool NeedsAttention => Kind is DataStorageKind.DockerVolume or DataStorageKind.NotMounted;
}

/// <summary>Detects whether the data directory is a host folder, a Docker volume or not mounted.</summary>
public static partial class DataLocation
{
    /// <summary>Detects the storage of the data directory from /proc/self/mountinfo inside the running container.</summary>
    /// <param name="dataDir">The configured data directory.</param>
    public static DataStorageInfo DetectCurrent(string dataDir)
    {
        string? mountInfo = null;
        try
        {
            mountInfo = File.Exists("/proc/self/mountinfo") ? File.ReadAllText("/proc/self/mountinfo") : null;
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
        return Detect(mountInfo, dataDir, inDocker: File.Exists("/.dockerenv"));
    }

    /// <summary>
    /// Finds the mount entry for the data directory. Field 5 of a mountinfo line is the mount point and field 4 the
    /// source path on its file system; a Docker named volume shows up as ".../volumes/&lt;name&gt;/_data".
    /// </summary>
    /// <param name="mountInfo">The contents of /proc/self/mountinfo, or null if unavailable.</param>
    /// <param name="dataDir">The configured data directory.</param>
    /// <param name="inDocker">Whether KeePort runs in a Docker container; outside Docker the result is Unknown.</param>
    public static DataStorageInfo Detect(string? mountInfo, string dataDir, bool inDocker)
    {
        var target = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataDir));
        if (!inDocker || string.IsNullOrEmpty(mountInfo))
        {
            return new DataStorageInfo(DataStorageKind.Unknown, target, null, null);
        }

        string? source = null;
        foreach (var line in mountInfo.Split('\n'))
        {
            var fields = line.Split(' ');
            // Later entries for the same mount point stack on top of earlier ones, so the last match wins.
            if (fields.Length > 4 && Unescape(fields[4]) == target)
            {
                source = Unescape(fields[3]);
            }
        }

        if (source is null)
        {
            return new DataStorageInfo(DataStorageKind.NotMounted, target, null, null);
        }
        var volume = VolumePattern().Match(source);
        return volume.Success
            ? new DataStorageInfo(DataStorageKind.DockerVolume, target, source, volume.Groups["name"].Value)
            : new DataStorageInfo(DataStorageKind.HostFolder, target, source, null);
    }

    /// <summary>Decodes the octal escapes mountinfo uses for spaces, tabs, newlines and backslashes (e.g. "\040").</summary>
    /// <param name="value">One mountinfo field.</param>
    private static string Unescape(string value)
        => OctalEscape().Replace(value, /* Converts one three-digit octal escape to its character.
         * <param name="m">The matched escape sequence.</param>
         */ m => ((char)Convert.ToInt32(m.Groups[1].Value, 8)).ToString());

    /// <summary>Matches the path of a Docker named volume, e.g. /var/lib/docker/volumes/keeport_keeport-data/_data.</summary>
    [GeneratedRegex(@"/volumes/(?<name>[^/]+)/_data$")]
    private static partial Regex VolumePattern();

    /// <summary>Matches a three-digit octal escape sequence.</summary>
    [GeneratedRegex(@"\\([0-7]{3})")]
    private static partial Regex OctalEscape();
}
