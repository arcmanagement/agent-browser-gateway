using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class AuditLogTests
{
    [Fact]
    public async Task AppendsAndTailsEntries()
    {
        var path = Path.Combine(Path.GetTempPath(), "abg-tests", Guid.NewGuid().ToString("N"), "audit.jsonl");
        var log = new AuditLog(path);

        await log.LogAsync("permit", extensionId: "ext", tabId: 10, url: "https://example.com");
        var entries = await log.TailAsync(5);

        Assert.Single(entries);
        Assert.Equal("permit", entries[0].Action);
        Assert.Equal(10, entries[0].TabId);
    }
}
