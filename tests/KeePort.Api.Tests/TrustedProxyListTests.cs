using System.Net;
using KeePort.Api.Security;
using Microsoft.AspNetCore.Builder;

namespace KeePort.Api.Tests;

public class TrustedProxyListTests
{
    /// <summary>Verifies that addresses and networks are parsed with flexible separators and normalized.</summary>
    [Fact]
    public void Parses_Addresses_And_Networks()
    {
        var list = TrustedProxyList.Parse(" 172.18.0.1, 10.20.5.9/16;fd00::1  ::ffff:192.168.1.10\n2001:db8::/32 ");

        Assert.Equal(new[] { "172.18.0.1", "fd00::1", "192.168.1.10" }, list.Proxies.Select(/* Formats a parsed proxy address.
         * <param name="p">The parsed proxy address.</param>
         */ p => p.ToString()));
        Assert.Equal(new[] { "10.20.0.0/16", "2001:db8::/32" }, list.Networks.Select(/* Formats a parsed network in CIDR notation.
         * <param name="n">The parsed proxy network.</param>
         */ n => n.ToString()));
        Assert.Equal("loopback, 172.18.0.1, fd00::1, 192.168.1.10, 10.20.0.0/16, 2001:db8::/32", list.Describe());
    }

    /// <summary>Verifies that an empty value keeps the default of trusting only loopback.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ,  ")]
    public void Empty_Value_Trusts_Only_Loopback(string? value)
    {
        var list = TrustedProxyList.Parse(value);
        Assert.Empty(list.Proxies);
        Assert.Empty(list.Networks);
        Assert.Equal("loopback only", list.Describe());
    }

    /// <summary>Verifies that invalid entries and catch-all networks stop the configuration instead of being ignored.</summary>
    [Theory]
    [InlineData("0.0.0.0/0")]
    [InlineData("::/0")]
    [InlineData("0.0.0.0")]
    [InlineData("::")]
    [InlineData("172.18.0.1/33")]
    [InlineData("fd00::/129")]
    [InlineData("10.0.0.0/abc")]
    [InlineData("proxy.local")]
    [InlineData("172.18.0.1, 300.1.1.1")]
    public void Rejects_Invalid_Or_Catch_All_Entries(string value)
    {
        var error = Assert.Throws<TrustedProxyConfigurationException>(/* Parses the invalid configuration. */ () => TrustedProxyList.Parse(value));
        Assert.Contains("'", error.Message);
    }

    /// <summary>Verifies that the parsed entries are added next to the default loopback entries.</summary>
    [Fact]
    public void Applies_To_Forwarded_Header_Options_Keeping_Loopback()
    {
        var options = new ForwardedHeadersOptions();
        var defaultProxies = options.KnownProxies.Count;
        var defaultNetworks = options.KnownIPNetworks.Count;

        TrustedProxyList.Parse("172.18.0.1, 10.20.0.0/16").ApplyTo(options);

        Assert.Equal(defaultProxies + 1, options.KnownProxies.Count);
        Assert.Equal(defaultNetworks + 1, options.KnownIPNetworks.Count);
        Assert.Contains(IPAddress.Parse("172.18.0.1"), options.KnownProxies);
        Assert.Contains(options.KnownIPNetworks, /* Finds the loopback network that ASP.NET Core trusts by default.
         * <param name="n">A known network.</param>
         */ n => n.Contains(IPAddress.Loopback));
    }

    /// <summary>Verifies that the keyword "gateway" trusts the resolved Docker gateway next to other entries.</summary>
    [Fact]
    public void Gateway_Keyword_Trusts_The_Resolved_Gateway()
    {
        var list = TrustedProxyList.Parse("Gateway, 192.168.2.245", /* Returns a fixed gateway. */ () => IPAddress.Parse("172.22.0.1"));

        Assert.Equal(new[] { "172.22.0.1", "192.168.2.245" }, list.Proxies.Select(/* Formats a parsed proxy address.
         * <param name="p">The parsed proxy address.</param>
         */ p => p.ToString()));
        Assert.Equal(IPAddress.Parse("172.22.0.1"), list.Gateway);
        Assert.Equal("loopback, 172.22.0.1 (gateway), 192.168.2.245", list.Describe());
    }

    /// <summary>Verifies that "gateway" stops the startup when no gateway can be found, e.g. outside Docker.</summary>
    [Fact]
    public void Gateway_Keyword_Without_Gateway_Is_Rejected()
    {
        var error = Assert.Throws<TrustedProxyConfigurationException>(/* Parses the keyword without a resolvable gateway. */
            () => TrustedProxyList.Parse("gateway", /* Finds no gateway. */ () => null));
        Assert.Contains("gateway", error.Message);
    }

    /// <summary>Verifies the parsing of /proc/net/route, including the host-order hexadecimal address format.</summary>
    [Fact]
    public void Reads_The_Default_Gateway_From_The_Route_Table()
    {
        const string routeTable =
            "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n" +
            "eth0\t000016AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n" +
            "eth0\t00000000\t010016AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\n";
        var expected = BitConverter.IsLittleEndian ? "172.22.0.1" : "1.0.22.172";

        Assert.Equal(expected, DefaultGateway.ParseRouteTable(routeTable)?.ToString());
        Assert.Null(DefaultGateway.ParseRouteTable("Iface\tDestination\tGateway\tFlags\neth0\t000016AC\t00000000\t0001\n"));
        Assert.Null(DefaultGateway.ParseRouteTable(string.Empty));
    }

    /// <summary>Verifies that IPv4 clients of dual-stack sockets are formatted as plain IPv4.</summary>
    [Fact]
    public void Formats_Client_Addresses_Consistently()
    {
        Assert.Equal("192.168.1.5", ClientIp.Format(IPAddress.Parse("::ffff:192.168.1.5")));
        Assert.Equal("192.168.1.5", ClientIp.Format(IPAddress.Parse("192.168.1.5")));
        Assert.Equal("fd00::5", ClientIp.Format(IPAddress.Parse("fd00::5")));
        Assert.Null(ClientIp.Format(null));
    }
}
