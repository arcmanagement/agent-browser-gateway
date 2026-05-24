using System.Text.Json;
using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class ProtocolTests
{
    [Fact]
    public void DecodesCliRequestWithParams()
    {
        var request = JsonSerializer.Deserialize<CliRequest>(
            "{\"id\":\"1\",\"method\":\"read_tab\",\"params\":{\"tabId\":42}}",
            JsonUtil.Options);

        Assert.NotNull(request);
        Assert.Equal("read_tab", request!.Method);
        Assert.Equal(42, request.Params.GetInt("tabId"));
    }
}
