using System.Diagnostics;
using System.Text.Json;
using AgentBrowserGateway.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace AgentBrowserGateway.Windows;

public sealed partial class StatusWindow : Window
{
    private readonly CliPipeClient _client = new();
    private string? _auditLogPath;
    private string? _logsDir;
    private string? _processPath;

    public StatusWindow()
    {
        InitializeComponent();
        _auditLogPath = AbgPaths.AuditLogPath;
        _logsDir = AbgPaths.LogsDir;
        if (Content is FrameworkElement root)
        {
            root.Loaded += async (_, _) => await RefreshAsync().ConfigureAwait(true);
        }
    }

    private async Task RefreshAsync()
    {
        var response = await _client.CallAsync("inspect").ConfigureAwait(true);
        if (response.Error is not null || ResultElement(response) is not { } result)
        {
            ShowStopped(response.Error?.Message ?? "Gateway is not running.");
            return;
        }

        var version = result.GetString("version") ?? AbgPaths.Version;
        var profile = result.GetString("profile") ?? AbgPaths.RuntimeProfile;
        var host = result.GetString("wsHost") ?? AbgPaths.WsHost;
        var port = result.GetInt("wsPort") ?? AbgPaths.WsPort;
        var extensionCount = result.GetInt("extensionCount") ?? 0;
        var tabCount = result.GetInt("permittedTabCount") ?? 0;
        _processPath = result.GetString("processPath");
        _auditLogPath = result.GetString("auditLogPath") ?? AbgPaths.AuditLogPath;
        _logsDir = Path.GetDirectoryName(_auditLogPath) ?? AbgPaths.LogsDir;

        StateText.Text = $"Running on {host}:{port} ({profile})";
        VersionText.Text = version;
        GatewayText.Text = "Running";
        ExtensionText.Text = extensionCount.ToString();
        TabsCountText.Text = tabCount.ToString();
        ProcessText.Text = string.IsNullOrWhiteSpace(_processPath) ? "-" : _processPath;
        AuditText.Text = _auditLogPath;
        StartButton.IsEnabled = false;

        TabsList.ItemsSource = ReadTabs(result);
    }

    private void ShowStopped(string message)
    {
        StateText.Text = message;
        VersionText.Text = AbgPaths.Version;
        GatewayText.Text = "Stopped";
        ExtensionText.Text = "0";
        TabsCountText.Text = "0";
        ProcessText.Text = "-";
        AuditText.Text = _auditLogPath ?? AbgPaths.AuditLogPath;
        StartButton.IsEnabled = true;
        TabsList.ItemsSource = Array.Empty<TabRow>();
    }

    private static List<TabRow> ReadTabs(JsonElement result)
    {
        if (!result.TryGetProperty("tabs", out var tabs) || tabs.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var rows = new List<TabRow>();
        foreach (var tab in tabs.EnumerateArray())
        {
            rows.Add(new TabRow(
                tab.GetString("ref") ?? "",
                tab.GetInt("tabId") ?? 0,
                tab.GetString("title") ?? "",
                tab.GetString("url") ?? ""));
        }

        return rows;
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        await RefreshAsync().ConfigureAwait(true);
    }

    private async void Revoke_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int tabId }) return;
        await _client.CallAsync(
            "revoke_tab",
            new Dictionary<string, object?> { ["tabId"] = tabId },
            timeoutMs: 2500).ConfigureAwait(true);
        await RefreshAsync().ConfigureAwait(true);
    }

    private async void StartGateway_Click(object sender, RoutedEventArgs e)
    {
        var gateway = Path.Combine(AppContext.BaseDirectory, "agent-browser-gateway.exe");
        if (!File.Exists(gateway))
        {
            StateText.Text = $"Gateway executable was not found: {gateway}";
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = gateway,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = true
        });
        await Task.Delay(900).ConfigureAwait(true);
        await RefreshAsync().ConfigureAwait(true);
    }

    private void OpenAuditLog_Click(object sender, RoutedEventArgs e)
    {
        var auditLogPath = _auditLogPath ?? AbgPaths.AuditLogPath;
        Directory.CreateDirectory(Path.GetDirectoryName(auditLogPath)!);
        if (!File.Exists(auditLogPath)) File.WriteAllText(auditLogPath, string.Empty);
        OpenPath(auditLogPath);
    }

    private void OpenLogsFolder_Click(object sender, RoutedEventArgs e)
    {
        var logsDir = _logsDir ?? AbgPaths.LogsDir;
        Directory.CreateDirectory(logsDir);
        OpenPath(logsDir);
    }

    private static void OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true
        });
    }

    private static JsonElement? ResultElement(CliResponse response)
    {
        return response.Result is JsonElement element ? element : null;
    }
}
