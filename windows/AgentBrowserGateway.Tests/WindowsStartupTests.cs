using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class WindowsStartupTests
{
    [Fact]
    public void CommandForQuotesExecutablePath()
    {
        var executable = Path.Combine(Path.GetTempPath(), "Agent Browser Gateway", "agent-browser-gateway.exe");
        var expected = $"\"{Path.GetFullPath(executable)}\"";

        Assert.Equal(expected, WindowsStartup.CommandFor(executable));
    }

    [Fact]
    public void CommandTargetsExecutableAcceptsQuotedRunCommand()
    {
        var executable = Path.Combine(Path.GetTempPath(), "Agent Browser Gateway", "agent-browser-gateway.exe");
        var command = $"\"{Path.GetFullPath(executable)}\"";

        Assert.True(WindowsStartup.CommandTargetsExecutable(command, executable));
    }

    [Fact]
    public void CommandTargetsExecutableRejectsDifferentInstall()
    {
        var oldExecutable = Path.Combine(Path.GetTempPath(), "Old Agent Browser Gateway", "agent-browser-gateway.exe");
        var newExecutable = Path.Combine(Path.GetTempPath(), "Agent Browser Gateway", "agent-browser-gateway.exe");
        var command = $"\"{Path.GetFullPath(oldExecutable)}\"";

        Assert.False(WindowsStartup.CommandTargetsExecutable(command, newExecutable));
    }
}
