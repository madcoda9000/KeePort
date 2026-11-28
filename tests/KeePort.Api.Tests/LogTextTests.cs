using KeePort.Api.Security;

namespace KeePort.Api.Tests;

public class LogTextTests
{
    /// <summary>Verifies that a decoded line break in a request path cannot start a forged log line.</summary>
    [Fact]
    public void Escapes_Line_Breaks()
    {
        Assert.Equal("/dav/a.kdbx\\r\\nINFO fake entry", LogText.Clean("/dav/a.kdbx\r\nINFO fake entry"));
    }

    /// <summary>Verifies that other control characters, such as a terminal escape sequence, are written as escapes.</summary>
    [Fact]
    public void Escapes_Other_Control_Characters()
    {
        Assert.Equal("\\u001b[31mred\\u0000", LogText.Clean("\u001b[31mred\0"));
    }

    /// <summary>Verifies that normal values, including non-ASCII letters, and null stay unchanged.</summary>
    [Fact]
    public void Keeps_Normal_Values()
    {
        Assert.Equal("/dav/Familie – Größe.kdbx", LogText.Clean("/dav/Familie – Größe.kdbx"));
        Assert.Null(LogText.Clean(null));
    }
}
