using System.Diagnostics;
using System.Text.Json;
using AgentBrowserGateway.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;

namespace AgentBrowserGateway.Windows;

public sealed record AuditRow(string Summary, string Detail);

public sealed partial class GatewayDashboard : UserControl
{
    private readonly CliPipeClient _client = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(2) };
    private List<AuditRow> _auditRows = [];
    private bool _active, _refreshing, _changingPreferences, _running;
    private string _tabsState = "";
    private bool? _translatedJapanese;
    private string _auditPath = AbgPaths.AuditLogPath;
    private string _gatewayPath = WindowsStartup.GatewayExecutablePath(AppContext.BaseDirectory);
    public bool AutoStartGateway { get; set; }

    public GatewayDashboard()
    {
        InitializeComponent();
        _timer.Tick += async (_, _) => await RefreshAsync();
        Loaded += Dashboard_Loaded;
        Unloaded += (_, _) => { _active = false; _timer.Stop(); UiText.Changed -= PreferencesChanged; };
    }

    private void Viewport_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        // A ScrollViewer can measure its child wider than the visible viewport.
        PageContent.Width = Math.Max(0, Math.Min(880, e.NewSize.Width - 16));
    }

    private async void Dashboard_Loaded(object sender, RoutedEventArgs e)
    {
        _active = true;
        UiText.Changed += PreferencesChanged;
        PreferencesChanged();
        Navigation.SelectedItem = OverviewItem;
        await RefreshAsync();
        if (AutoStartGateway && !_running) await StartGatewayAsync();
        _timer.Start();
    }

    private void PreferencesChanged()
    {
        _changingPreferences = true;
        try
        {
            UiText.Apply(Root);
            foreach (var item in new[] { OverviewItem, TabsItem, AuditItem, PluginsItem, SettingsItem }) item.Content = UiText.T((string)item.Tag);
            if (_translatedJapanese != UiText.Japanese)
            {
                _translatedJapanese = UiText.Japanese;
                AppearancePicker.ItemsSource = new[] { UiText.T("System"), UiText.T("Light"), UiText.T("Dark") };
                LanguagePicker.ItemsSource = new[] { UiText.T("Automatic"), "English", "日本語" };
            }
            AppearancePicker.SelectedIndex = Array.IndexOf(new[] { "system", "light", "dark" }, UiText.Preferences.Appearance);
            LanguagePicker.SelectedIndex = Array.IndexOf(new[] { "auto", "en", "ja" }, UiText.Preferences.Language);
            StartupToggle.Header = UiText.T("Launch at sign in");
            AuditSearch.PlaceholderText = UiText.T("Filter activity");
            _tabsState = "";
            ShowPage();
        }
        finally { _changingPreferences = false; }
        _ = RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        if (!_active || _refreshing) return;
        _refreshing = true;
        try
        {
            var response = await _client.CallAsync("inspect", timeoutMs: 700);
            if (!_active) return;
            _running = response.Error is null && response.Result is JsonElement { ValueKind: JsonValueKind.Object };
            var result = response.Result is JsonElement element ? element : default;
            var tabs = _running ? ReadTabs(result) : [];
            var browsers = _running && result.TryGetProperty("extensions", out var extensions) && extensions.ValueKind == JsonValueKind.Array ? extensions.GetArrayLength() : 0;
            var sandbox = tabs.Any(tab => tab.AllTabs);
            Headline.Text = !_running ? UiText.T("Gateway is stopped") : tabs.Count > 0
                ? UiText.Japanese ? $"エージェントに {tabs.Count} 個のタブを共有中" : $"Agents can see {tabs.Count} {(tabs.Count == 1 ? "tab" : "tabs")}" : browsers > 0
                ? UiText.T("Agents can't see any tab") : UiText.T("Waiting for a browser");
            SidebarState.Text = Headline.Text;
            StateDetail.Text = UiText.T(sandbox ? "All-tabs mode is enabled in a sandbox profile. Turn it off in that profile's extension popup." : tabs.Count > 0
                ? "Every tab stays shared until you revoke it or it leaves its site." : "Open Chrome with the ABG extension. Share a tab from its popup to let agents access it.");
            HeroMark.Update(tabs.Count > 0, sandbox);
            SidebarMark.Update(tabs.Count > 0, sandbox);
            BrowserCount.Text = browsers.ToString();
            BrowserDetail.Text = UiText.T(browsers > 0 ? "Connected" : "Waiting for a browser");
            Endpoint.Text = $"{AbgPaths.WsHost}:{AbgPaths.WsPort}";
            Version.Text = $"v{(_running ? result.GetString("version") : null) ?? AbgPaths.Version}";
            SidebarEndpoint.Text = $"{Endpoint.Text}\n{AbgPaths.RuntimeProfile} · {Version.Text}";
            StartButton.Visibility = _running ? Visibility.Collapsed : Visibility.Visible;
            PageSubtitle.Text = UiText.T("Share only what you choose.");
            var state = JsonSerializer.Serialize(tabs) + UiText.Japanese;
            if (state != _tabsState) { _tabsState = state; TabsList.ItemsSource = tabs; }
            TabsEmpty.Visibility = tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            TabsItem.InfoBadge = tabs.Count == 0 ? null : new InfoBadge { Value = tabs.Count };
            if (_running)
            {
                _auditPath = result.GetString("auditLogPath") ?? AbgPaths.AuditLogPath;
                var path = result.GetString("processPath");
                if (path is not null && File.Exists(path) && Path.GetFileName(path).Equals("agent-browser-gateway.exe", StringComparison.OrdinalIgnoreCase)) _gatewayPath = path;
            }
            _changingPreferences = true;
            try { StartupToggle.IsOn = WindowsStartup.IsEnabledFor(_gatewayPath); }
            finally { _changingPreferences = false; }
            LocalPath.Text = AbgPaths.AppDataDir;
            if (ReferenceEquals(Navigation.SelectedItem, AuditItem)) await RefreshAuditAsync();
        }
        catch (Exception ex) { ShowError(ex.Message); }
        finally { _refreshing = false; }
    }

    private static List<SharedTabRow> ReadTabs(JsonElement result)
    {
        if (!result.TryGetProperty("tabs", out var source) || source.ValueKind != JsonValueKind.Array) return [];
        return source.EnumerateArray().Select(tab =>
        {
            DateTimeOffset? expiry = DateTimeOffset.TryParse(tab.GetString("expiresAt"), out var parsed) ? parsed : null;
            var url = tab.GetString("url") ?? "";
            var title = tab.GetString("title");
            var id = tab.GetString("extensionId") ?? "";
            var label = string.Join(" · ", new[] { tab.GetString("profile"), tab.GetString("browser"), id.Length > 8 ? id[..8] : id }.Where(value => !string.IsNullOrWhiteSpace(value)));
            return new SharedTabRow(tab.GetString("ref") ?? "", tab.GetInt("tabId") ?? 0, id, string.IsNullOrWhiteSpace(title) ? url : title, url, label, tab.GetString("accessMode") ?? "explicit", tab.GetString("favicon"), expiry);
        }).ToList();
    }

    private void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args) => ShowPage();
    private void ShowPage()
    {
        if (PageTitle is null) return;
        var selected = Navigation.SelectedItem as NavigationViewItem ?? OverviewItem;
        PageTitle.Text = UiText.T((string)selected.Tag);
        foreach (var (page, item) in new[] { (OverviewPage, OverviewItem), (TabsPage, TabsItem), (AuditPage, AuditItem), (PluginsPage, PluginsItem), (SettingsPage, SettingsItem) })
            page.Visibility = selected == item ? Visibility.Visible : Visibility.Collapsed;
        if (_active && selected == AuditItem) _ = RefreshAsync();
    }

    private async Task RefreshAuditAsync()
    {
        var entries = await new AuditLog(_auditPath).TailAsync(500);
        _auditRows = entries.Reverse().Select(entry => new AuditRow($"{entry.Ts.ToLocalTime():MM/dd HH:mm:ss}  {entry.Action}", string.Join(" · ", new[] { entry.Agent, entry.TabId is null ? null : $"tab {entry.TabId}", entry.Url }.Where(value => !string.IsNullOrWhiteSpace(value))))).ToList();
        FilterAudit();
    }

    private void FilterAudit()
    {
        var query = AuditSearch.Text.Trim();
        var rows = _auditRows.Where(row => query.Length == 0 || (row.Summary + row.Detail).Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
        AuditList.ItemsSource = rows;
        AuditEmpty.Visibility = rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        AuditEmpty.Text = UiText.T(query.Length == 0 ? "No activity yet" : "No matching activity");
    }
    private void AuditSearch_TextChanged(object sender, TextChangedEventArgs args) { if (AuditList is not null) FilterAudit(); }
    private void ManageTabs_Click(object sender, RoutedEventArgs args) => Navigation.SelectedItem = TabsItem;
    private async void Refresh_Click(object sender, RoutedEventArgs args) => await RefreshAsync();
    private async void Start_Click(object sender, RoutedEventArgs args) => await StartGatewayAsync();
    private async Task StartGatewayAsync()
    {
        StartButton.IsEnabled = false;
        try
        {
            if (!File.Exists(_gatewayPath)) throw new FileNotFoundException(UiText.T("Gateway executable was not found."), _gatewayPath);
            Process.Start(new ProcessStartInfo(_gatewayPath) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(_gatewayPath) });
            await Task.Delay(900);
            await RefreshAsync();
        }
        catch (Exception ex) { ShowError(ex.Message); }
        finally { StartButton.IsEnabled = true; }
    }

    private async void Tab_RevokeRequested(object? sender, SharedTabRow tab)
    {
        if (sender is SharedTabCard card) card.IsEnabled = false;
        try
        {
            var response = await _client.CallAsync("revoke_tab", new { tabId = tab.TabId, extensionId = tab.ExtensionId }, timeoutMs: 2500);
            if (response.Error is not null) ShowError(response.Error.Message);
            await RefreshAsync();
        }
        catch (Exception ex) { ShowError(ex.Message); }
        finally { if (sender is SharedTabCard finished) finished.IsEnabled = true; }
    }
    private void Tab_CopyRequested(object? sender, string value) => Copy(value);
    private void CopyStatus_Click(object sender, RoutedEventArgs args) => Copy(AbgPaths.RuntimeProfile == "prod" ? "abg status" : $"$env:ABG_PROFILE='{AbgPaths.RuntimeProfile}'; $env:ABG_PORT={AbgPaths.WsPort}; abg status");
    private void Copy(string value)
    {
        try
        {
            var package = new DataPackage(); package.SetText(value); Clipboard.SetContent(package);
            Feedback.Title = UiText.T("Copied"); Feedback.Message = value; Feedback.Severity = InfoBarSeverity.Success; Feedback.IsOpen = true;
        }
        catch (Exception ex) { ShowError(ex.Message); }
    }

    private void Preferences_SelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_changingPreferences || AppearancePicker.SelectedIndex < 0 || LanguagePicker.SelectedIndex < 0) return;
        try { UiText.Save(new UiPreferences(new[] { "system", "light", "dark" }[AppearancePicker.SelectedIndex], new[] { "auto", "en", "ja" }[LanguagePicker.SelectedIndex])); }
        catch (Exception ex) { ShowError(ex.Message); PreferencesChanged(); }
    }
    private void Startup_Toggled(object sender, RoutedEventArgs args)
    {
        if (_changingPreferences) return;
        try { if (StartupToggle.IsOn) WindowsStartup.SetEnabled(_gatewayPath); else WindowsStartup.Disable(); }
        catch (Exception ex) { ShowError(ex.Message); _ = RefreshAsync(); }
    }
    private void OpenAudit_Click(object sender, RoutedEventArgs args) => OpenPath(_auditPath, false);
    private void OpenLogs_Click(object sender, RoutedEventArgs args) => OpenPath(AbgPaths.LogsDir, true);
    private void OpenPlugins_Click(object sender, RoutedEventArgs args) => OpenPath(AbgPaths.UserPluginsDir, true);
    private void OpenPath(string path, bool directory)
    {
        try
        {
            if (directory) Directory.CreateDirectory(path);
            else { Directory.CreateDirectory(Path.GetDirectoryName(path)!); if (!File.Exists(path)) File.WriteAllText(path, ""); }
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex) { ShowError(ex.Message); }
    }
    private void ShowError(string message) { Feedback.Title = UiText.T("Action failed"); Feedback.Message = message; Feedback.Severity = InfoBarSeverity.Error; Feedback.IsOpen = true; }
}
