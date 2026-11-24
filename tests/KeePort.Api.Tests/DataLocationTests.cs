using KeePort.Api.Services;

namespace KeePort.Api.Tests;

public class DataLocationTests
{
    private const string Root = "1079 1000 0:52 / / rw,relatime master:1 - overlay overlay rw\n";

    /// <summary>Verifies the detection of Docker named volumes on Linux and on Synology.</summary>
    [Theory]
    [InlineData("1335 1079 252:1 /var/lib/docker/volumes/keeport_keeport-data/_data /data rw,relatime master:1 - ext4 /dev/mapper/vg-root rw", "/var/lib/docker/volumes/keeport_keeport-data/_data")]
    [InlineData("1335 1079 0:45 /@docker/volumes/keeport_keeport-data/_data /data rw,relatime - btrfs /dev/mapper/cachedev_0 rw", "/@docker/volumes/keeport_keeport-data/_data")]
    public void Detects_Docker_Volumes(string line, string source)
    {
        var info = DataLocation.Detect(Root + line + "\n", "/data", inDocker: true);
        Assert.Equal(DataStorageKind.DockerVolume, info.Kind);
        Assert.Equal("keeport_keeport-data", info.VolumeName);
        Assert.Equal(source, info.Source);
        Assert.True(info.NeedsAttention);
    }

    /// <summary>Verifies the detection of a bind-mounted host folder, including escaped spaces.</summary>
    [Fact]
    public void Detects_Host_Folders()
    {
        var info = DataLocation.Detect(Root + "1335 1079 0:45 /docker/keeport\\040data /data rw,relatime - btrfs /dev/mapper/cachedev_0 rw\n", "/data", inDocker: true);
        Assert.Equal(DataStorageKind.HostFolder, info.Kind);
        Assert.Equal("/docker/keeport data", info.Source);
        Assert.Null(info.VolumeName);
        Assert.False(info.NeedsAttention);
    }

    /// <summary>Verifies that a data directory without its own mount is reported inside Docker only.</summary>
    [Fact]
    public void Detects_Missing_Mount_Only_Inside_Docker()
    {
        var mountInfo = Root + "1336 1079 0:60 / /proc rw - proc proc rw\n";
        Assert.Equal(DataStorageKind.NotMounted, DataLocation.Detect(mountInfo, "/data", inDocker: true).Kind);
        Assert.Equal(DataStorageKind.Unknown, DataLocation.Detect(mountInfo, "/data", inDocker: false).Kind);
        Assert.Equal(DataStorageKind.Unknown, DataLocation.Detect(null, "/data", inDocker: true).Kind);
        Assert.False(DataLocation.Detect(null, "/data", inDocker: true).NeedsAttention);
    }

    /// <summary>Verifies that a trailing slash in the configured directory still matches the mount point.</summary>
    [Fact]
    public void Matches_Data_Directory_With_Trailing_Slash()
    {
        var info = DataLocation.Detect(Root + "1335 1079 0:45 /srv/keeport /data rw - ext4 /dev/sda1 rw\n", "/data/", inDocker: true);
        Assert.Equal(DataStorageKind.HostFolder, info.Kind);
        Assert.Equal("/data", info.DataDir);
    }
}
