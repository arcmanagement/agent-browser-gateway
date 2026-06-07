using System.Diagnostics;
using AgentBrowserGateway.Core;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace AgentBrowserGateway.Windows;

public sealed partial class MainWindow : Window
{
    private readonly GatewayHost _gateway = new();

    public MainWindow()
    {
        InitializeComponent();
        _gateway.StateChanged += Gateway_StateChanged;
        Closed += MainWindow_Closed;
        _ = StartGatewayAsync();
    }

    private async Task StartGatewayAsync()
    {
        try
        {
            await _gateway.StartAsync();
            RefreshSnapshot();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Failed to start: {ex.Message}";
        }
    }

    private void Gateway_StateChanged(object? sender, EventArgs e)
    {
        DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, RefreshSnapshot);
    }

    private void RefreshSnapshot()
    {
        var snapshot = _gateway.Snapshot();
        StatusText.Text = snapshot.Running
            ? $"Running on {AbgPaths.WsHost}:{AbgPaths.WsPort} ({AbgPaths.RuntimeProfile})"
            : "Stopped";
        ExtensionText.Text = $"Extensions: {snapshot.Extensions.Count}, shared tabs: {snapshot.Tabs.Count}";
        PathText.Text = $"Audit: {AbgPaths.AuditLogPath}";
        TabsList.ItemsSource = snapshot.Tabs.Select(tab => new TabRow(
            tab.GetValueOrDefault("ref")?.ToString() ?? "",
            Convert.ToInt32(tab.GetValueOrDefault("tabId") ?? 0),
            tab.GetValueOrDefault("title")?.ToString() ?? "",
            tab.GetValueOrDefault("url")?.ToString() ?? "")).ToList();
    }

    private void Refresh_Click(object sender, RoutedEventArgs e)
    {
        RefreshSnapshot();
    }

    private async void Revoke_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int tabId }) return;
        await _gateway.HandleCliRequestAsync(new CliRequest
        {
            Method = "revoke_tab",
            Params = JsonUtil.ToElement(new Dictionary<string, object?> { ["tabId"] = tabId })
        }, CancellationToken.None);
        RefreshSnapshot();
    }

    private void OpenAuditLog_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(AbgPaths.AuditLogPath)!);
        if (!File.Exists(AbgPaths.AuditLogPath)) File.WriteAllText(AbgPaths.AuditLogPath, "");
        Process.Start(new ProcessStartInfo
        {
            FileName = AbgPaths.AuditLogPath,
            UseShellExecute = true
        });
    }

    private void MainWindow_Closed(object sender, WindowEventArgs args)
    {
        _gateway.Stop();
    }
}

public sealed record TabRow(string Ref, int TabId, string Title, string Url);
