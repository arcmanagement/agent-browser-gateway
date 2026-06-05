using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class AbgPathsTests
{
    [Fact]
    public void ProductionDefaultsRemainStable()
    {
        Assert.Equal(8765, AbgPaths.ResolveWsPort(null));
        Assert.Null(AbgPaths.ResolveProfile(null, 8765));
    }

    [Fact]
    public void NonDefaultPortDefaultsToDevProfile()
    {
        var port = AbgPaths.ResolveWsPort("8766");

        Assert.Equal(8766, port);
        Assert.Equal("dev", AbgPaths.ResolveProfile(null, port));
    }

    [Fact]
    public void ExplicitProductionProfileKeepsProductionStateWithCustomPort()
    {
        var port = AbgPaths.ResolveWsPort("9000");

        Assert.Equal(9000, port);
        Assert.Null(AbgPaths.ResolveProfile("prod", port));
    }

    [Fact]
    public void EmptyProfileStillInfersDevFromCustomPort()
    {
        Assert.Equal("dev", AbgPaths.ResolveProfile("", 8766));
    }

    [Fact]
    public void ProfileNamesAreSanitizedForLocalPathsAndPipes()
    {
        Assert.Equal("dev-local", AbgPaths.ResolveProfile(" dev local ", 8765));
    }
}
