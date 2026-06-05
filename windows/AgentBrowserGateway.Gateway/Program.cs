using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using System.Windows.Forms;
using AgentBrowserGateway.Core;

namespace AgentBrowserGateway.Gateway;

internal static class Program
{
    private const string MutexName = @"Local\AgentBrowserGateway.Tray";

    [STAThread]
    public static int Main()
    {
        using var mutex = new Mutex(true, MutexName, out var isFirstInstance);
        if (!isFirstInstance)
        {
            return 0;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            using var context = new GatewayTrayApplication();
            Application.Run(context);
            return context.ExitCode;
        }
        catch (Exception ex) when (IsAddressAlreadyInUse(ex) && ExistingGatewayResponds())
        {
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Agent Browser Gateway failed to start.\n\n{ex.Message}",
                "Agent Browser Gateway",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool ExistingGatewayResponds()
    {
        try
        {
            var response = new CliPipeClient().CallAsync("status", timeoutMs: 700).GetAwaiter().GetResult();
            return response.Error is null;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsAddressAlreadyInUse(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is SocketException { SocketErrorCode: SocketError.AddressAlreadyInUse })
            {
                return true;
            }
        }

        return false;
    }
}

internal sealed class GatewayTrayApplication : ApplicationContext
{
    private readonly GatewayHost _host = new();
    private readonly SynchronizationContext _uiContext;
    private readonly NotifyIcon _notifyIcon;
    private readonly ContextMenuStrip _menu;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _restartItem;
    private bool _isRestarting;

    public GatewayTrayApplication()
    {
        _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _statusItem = new ToolStripMenuItem("Status", null, (_, _) => ShowStatus());
        _restartItem = new ToolStripMenuItem("Restart Gateway", null, async (_, _) => await RestartGatewayAsync().ConfigureAwait(true));

        _menu = new ContextMenuStrip();
        _menu.Items.Add(_statusItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Open audit log", null, (_, _) => OpenAuditLog());
        _menu.Items.Add("Open logs folder", null, (_, _) => OpenLogsFolder());
        _menu.Items.Add(_restartItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Quit", null, (_, _) => Quit());

        _host.StateChanged += Host_StateChanged;
        _host.StartAsync().GetAwaiter().GetResult();

        _notifyIcon = new NotifyIcon
        {
            ContextMenuStrip = _menu,
            Icon = SystemIcons.Application,
            Text = "Agent Browser Gateway",
            Visible = false
        };
        _notifyIcon.DoubleClick += (_, _) => ShowStatus();

        RefreshStatus();
        _notifyIcon.Visible = true;
    }

    public int ExitCode { get; private set; }

    private void Host_StateChanged(object? sender, EventArgs e)
    {
        _uiContext.Post(_ => RefreshStatus(), null);
    }

    private void RefreshStatus()
    {
        var snapshot = _host.Snapshot();
        var state = snapshot.Running ? "Running" : "Stopped";
        _statusItem.Text = $"Status: {state} ({snapshot.Tabs.Count} tabs)";
        _restartItem.Enabled = !_isRestarting;
        _notifyIcon.Text = TooltipText(snapshot);
    }

    private static string TooltipText(GatewaySnapshot snapshot)
    {
        var state = snapshot.Running ? "running" : "stopped";
        return $"ABG {state} ({AbgPaths.RuntimeProfile}): {snapshot.Extensions.Count} ext, {snapshot.Tabs.Count} tabs";
    }

    private void ShowStatus()
    {
        var snapshot = _host.Snapshot();
        var message = snapshot.Running
            ? $"Version: {AbgPaths.Version}\nProfile: {AbgPaths.RuntimeProfile}\nRunning on {AbgPaths.WsHost}:{AbgPaths.WsPort}\nExtensions: {snapshot.Extensions.Count}\nShared tabs: {snapshot.Tabs.Count}\nProcess: {Environment.ProcessPath}\nState: {AbgPaths.AppDataDir}\nUser dir: {AbgPaths.AbgUserDir}\nAudit log: {AbgPaths.AuditLogPath}"
            : "Stopped";

        MessageBox.Show(
            message,
            "Agent Browser Gateway",
            MessageBoxButtons.OK,
            snapshot.Running ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
    }

    private static void OpenAuditLog()
    {
        Directory.CreateDirectory(AbgPaths.LogsDir);
        if (!File.Exists(AbgPaths.AuditLogPath))
        {
            File.WriteAllText(AbgPaths.AuditLogPath, string.Empty);
        }

        OpenPath(AbgPaths.AuditLogPath);
    }

    private static void OpenLogsFolder()
    {
        OpenPath(AbgPaths.LogsDir);
    }

    private async Task RestartGatewayAsync()
    {
        if (_isRestarting) return;
        _isRestarting = true;
        RefreshStatus();

        try
        {
            _host.Stop();
            await Task.Delay(500).ConfigureAwait(true);
            await _host.StartAsync().ConfigureAwait(true);
            RefreshStatus();
            _notifyIcon.ShowBalloonTip(
                2000,
                "Agent Browser Gateway",
                $"Restarted on {AbgPaths.WsHost}:{AbgPaths.WsPort}",
                ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Failed to restart Gateway.\n\n{ex.Message}",
                "Agent Browser Gateway",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            _isRestarting = false;
            RefreshStatus();
        }
    }

    private void Quit()
    {
        _notifyIcon.Visible = false;
        _host.StateChanged -= Host_StateChanged;
        _host.Stop();
        ExitThread();
    }

    private static void OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _notifyIcon.Visible = false;
            _host.StateChanged -= Host_StateChanged;
            _notifyIcon.Dispose();
            _menu.Dispose();
            _host.Stop();
        }

        base.Dispose(disposing);
    }
}
