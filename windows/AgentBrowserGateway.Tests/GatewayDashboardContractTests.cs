using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class GatewayDashboardContractTests
{
    [Fact]
    public async Task DashboardRevokeOnlyTargetsItsOwningBrowserAndProtectsAllTabsMode()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var host = new GatewayHost(new AuditLog(Path.Combine(directory, "audit.jsonl")));
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        using var browser = new TcpClient();
        await browser.ConnectAsync((IPEndPoint)listener.LocalEndpoint);
        using var gateway = await listener.AcceptTcpClientAsync();
        var owner = new ExtensionWebSocketServer.BrowserConnection(gateway, gateway.GetStream());
        var peer = new ExtensionWebSocketServer.BrowserConnection(browser, browser.GetStream());
        var other = new ExtensionWebSocketServer.BrowserConnection(gateway, gateway.GetStream()) { ExtensionId = "other" };
        try
        {
            await host.HandleExtensionTextAsync(owner, "{\"type\":\"hello\",\"extensionId\":\"owner\"}", default);
            await host.HandleExtensionTextAsync(owner, "{\"type\":\"tab_permitted\",\"tabId\":42,\"url\":\"https://example.com\"}", default);
            await host.HandleExtensionTextAsync(other, "{\"type\":\"tab_permitted\",\"tabId\":42,\"accessMode\":\"all_tabs\"}", default);
            var rejected = await host.HandleCliRequestAsync(new CliRequest { Method = "revoke_tab", Params = JsonUtil.ToElement(new { tabId = 42, extensionId = "other" }) }, default);
            Assert.Equal("all_tabs_mode", rejected.Error?.Code);
            Assert.Equal(2, host.Snapshot().Tabs.Count);
            var revoke = host.HandleCliRequestAsync(new CliRequest { Method = "revoke_tab", Params = JsonUtil.ToElement(new { tabId = 42, extensionId = "owner" }) }, default);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var text = await peer.ReadTextMessageAsync(timeout.Token);
            using var command = JsonDocument.Parse(text!);
            Assert.Equal("revoke", command.RootElement.GetString("method"));
            await host.HandleExtensionTextAsync(owner, JsonSerializer.Serialize(new { type = "response", id = command.RootElement.GetString("id"), result = new { ok = true } }), default);
            Assert.Null((await revoke).Error);
            Assert.Equal("other", Assert.Single(host.Snapshot().Tabs)["extensionId"]);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task BrowserFaviconMetadataIsLocalPngOnlyAndSurvivesTitleUpdates()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var host = new GatewayHost(new AuditLog(Path.Combine(directory, "audit.jsonl")));
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        using var browser = new TcpClient();
        await browser.ConnectAsync((IPEndPoint)listener.LocalEndpoint);
        using var gateway = await listener.AcceptTcpClientAsync();
        var connection = new ExtensionWebSocketServer.BrowserConnection(gateway, gateway.GetStream()) { ExtensionId = "owner" };
        const string png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=";
        try
        {
            await host.HandleExtensionTextAsync(connection, JsonSerializer.Serialize(new { type = "tab_permitted", tabId = 1, favicon = png }), default);
            await host.HandleExtensionTextAsync(connection, "{\"type\":\"tab_updated\",\"tabId\":1,\"title\":\"New title\"}", default);
            Assert.Equal(png, Assert.Single(host.Snapshot().Tabs)["favicon"]);
            foreach (var invalid in new[] { "https://example.com/icon.png", "data:image/png;base64,invalid", "data:image/svg+xml;base64,PHN2Zz4=", png + new string('A', 90000) })
            {
                await host.HandleExtensionTextAsync(connection, JsonSerializer.Serialize(new { type = "tab_updated", tabId = 1, favicon = invalid }), default);
                Assert.False(Assert.Single(host.Snapshot().Tabs).ContainsKey("favicon"));
            }
        }
        finally { Directory.Delete(directory, true); }
    }
}
