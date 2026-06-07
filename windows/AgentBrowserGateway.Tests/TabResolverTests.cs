using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class TabResolverTests
{
    [Fact]
    public void ResolvesShortRef()
    {
        var tabs = JsonUtil.ToElement(new[]
        {
            new Dictionary<string, object?> { ["ref"] = "t1", ["tabId"] = 123, ["title"] = "One", ["url"] = "https://example.com" }
        });

        Assert.Equal(123, TabResolver.Resolve(tabs, "t1"));
    }

    [Fact]
    public void ResolvesUrlGlob()
    {
        var tabs = JsonUtil.ToElement(new[]
        {
            new Dictionary<string, object?> { ["ref"] = "t1", ["tabId"] = 123, ["title"] = "One", ["url"] = "https://example.com" },
            new Dictionary<string, object?> { ["ref"] = "t2", ["tabId"] = 456, ["title"] = "Kintone", ["url"] = "https://ccdev.cybozu.com/k" }
        });

        Assert.Equal(456, TabResolver.Resolve(tabs, null, matchUrl: "*cybozu*", first: true));
    }
}
