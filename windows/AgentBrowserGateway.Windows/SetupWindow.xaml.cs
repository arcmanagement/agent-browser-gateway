using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using AgentBrowserGateway.Core;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Win32;

namespace AgentBrowserGateway.Windows;

public sealed partial class SetupWindow : Window
{
    private const string DefaultInstallDir = @"C:\Tools\AgentBrowserGateway";
    private readonly string _payloadDir;
    private bool _busy;

    public SetupWindow(string? payloadDir)
    {
        InitializeComponent();
        _payloadDir = Path.GetFullPath(string.IsNullOrWhiteSpace(payloadDir) ? AppContext.BaseDirectory : payloadDir);
        InstallDirBox.Text = DefaultInstallDir;
        PayloadText.Text = $"Payload: {_payloadDir}";
        DetectMode();
    }

    private void DetectMode()
    {
        var installed = File.Exists(Path.Combine(DefaultInstallDir, "abg.exe"));
        ModeText.Text = installed ? "Ready to update the Windows Gateway" : "Ready to install the Windows Gateway";
    }

    private async void Install_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        var installDir = Environment.ExpandEnvironmentVariables(InstallDirBox.Text.Trim());
        var addToPath = PathCheckBox.IsChecked == true;
        var startAfterInstall = StartCheckBox.IsChecked == true;
        var enableStartup = StartupCheckBox.IsChecked == true;

        SetBusy(true);
        try
        {
            await Task.Run(() => InstallAsync(installDir, addToPath, startAfterInstall, enableStartup)).ConfigureAwait(true);
            SetStatus("Installed successfully.", 100);
            ModeText.Text = "Installed";
        }
        catch (Exception ex)
        {
            SetStatus($"Install failed: {ex.Message}", 0);
            await ShowErrorAsync(ex.Message).ConfigureAwait(true);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task InstallAsync(string installDir, bool addToPath, bool startAfterInstall, bool enableStartup)
    {
        if (string.IsNullOrWhiteSpace(installDir))
        {
            throw new InvalidOperationException("Install location is empty.");
        }

        var payloadDir = Path.GetFullPath(_payloadDir);
        if (!Directory.Exists(payloadDir))
        {
            throw new DirectoryNotFoundException($"Installer payload was not found: {payloadDir}");
        }

        var targetDir = Path.GetFullPath(installDir);
        if (IsSameOrChildPath(payloadDir, targetDir) || IsSameOrChildPath(AppContext.BaseDirectory, targetDir))
        {
            throw new InvalidOperationException("Choose an install location outside the setup folder.");
        }

        SetStatus("Stopping existing Gateway...", 10);
        StopExistingGateway();
        WaitGatewayPortFree();

        SetStatus("Replacing installed files...", 35);
        ReplaceDirectory(payloadDir, targetDir);

        if (addToPath)
        {
            SetStatus("Updating PATH...", 60);
            AddUserPath(targetDir);
        }

        SetStatus("Configuring sign-in startup...", 68);
        ConfigureStartup(targetDir, enableStartup);

        SetStatus("Updating Claude/Codex skills...", 76);
        RunInstallSkill(targetDir);

        SetStatus("Registering uninstall entry...", 82);
        RegisterUninstallEntry(targetDir);

        if (startAfterInstall)
        {
            SetStatus("Starting tray Gateway...", 88);
            StartGateway(targetDir);
            await WaitGatewayReadyAsync().ConfigureAwait(false);
        }
    }

    private static void StopExistingGateway()
    {
        var currentProcessId = Environment.ProcessId;
        var names = new[] { "agent-browser-gateway", "AgentBrowserGateway.Windows" };
        var processes = names
            .SelectMany(Process.GetProcessesByName)
            .Where(process => process.Id != currentProcessId)
            .GroupBy(process => process.Id)
            .Select(group => group.First())
            .ToList();

        foreach (var process in processes)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Process may exit between enumeration and kill.
            }
        }

        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (names.SelectMany(Process.GetProcessesByName).Any(process => process.Id != currentProcessId))
            {
                Thread.Sleep(250);
                continue;
            }
            return;
        }

        throw new InvalidOperationException("Could not stop the existing Gateway. Quit it from the tray menu or Task Manager, then retry.");
    }

    private static void WaitGatewayPortFree()
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (!GatewayPortOpen()) return;
            Thread.Sleep(250);
        }

        throw new InvalidOperationException($"Port {AbgPaths.WsHost}:{AbgPaths.WsPort} is still in use. Stop the existing Gateway, then retry.");
    }

    private static bool GatewayPortOpen()
    {
        using var client = new TcpClient();
        try
        {
            var connect = client.BeginConnect(AbgPaths.WsHost, AbgPaths.WsPort, null, null);
            if (!connect.AsyncWaitHandle.WaitOne(150)) return false;
            client.EndConnect(connect);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void ReplaceDirectory(string sourceDir, string targetDir)
    {
        if (Directory.Exists(targetDir))
        {
            Directory.Delete(targetDir, recursive: true);
        }

        Directory.CreateDirectory(targetDir);
        CopyDirectory(sourceDir, targetDir);
    }

    private static void CopyDirectory(string sourceDir, string targetDir)
    {
        foreach (var directory in Directory.EnumerateDirectories(sourceDir, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(targetDir, Path.GetRelativePath(sourceDir, directory)));
        }

        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var destination = Path.Combine(targetDir, Path.GetRelativePath(sourceDir, file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination, overwrite: true);
        }
    }

    private static void AddUserPath(string installDir)
    {
        var current = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
        var parts = current
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        var normalizedInstallDir = Path.GetFullPath(installDir).TrimEnd('\\');
        foreach (var part in parts)
        {
            try
            {
                var normalizedPart = Path.GetFullPath(Environment.ExpandEnvironmentVariables(part)).TrimEnd('\\');
                if (string.Equals(normalizedPart, normalizedInstallDir, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            catch
            {
                // Keep unusual PATH entries rather than blocking install.
            }
        }

        parts.Add(installDir);
        Environment.SetEnvironmentVariable("Path", string.Join(';', parts), EnvironmentVariableTarget.User);
        NativeMethods.BroadcastEnvironmentChange();
    }

    private static void ConfigureStartup(string installDir, bool enabled)
    {
        if (enabled)
        {
            WindowsStartup.SetEnabled(WindowsStartup.GatewayExecutablePath(installDir));
            return;
        }

        WindowsStartup.Disable();
    }

    private static void RunInstallSkill(string installDir)
    {
        var abg = Path.Combine(installDir, "abg.exe");
        if (!File.Exists(abg)) return;

        var result = RunHidden(abg, "install-skill --target both", installDir);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException($"Skill update failed.\n\n{result.Output}");
        }
    }

    private static void RegisterUninstallEntry(string installDir)
    {
        const string uninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentBrowserGateway";
        var versionPath = Path.Combine(installDir, "VERSION");
        var displayVersion = File.Exists(versionPath) ? File.ReadAllText(versionPath).Trim() : AbgPaths.Version;
        var powershell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(powershell))
        {
            powershell = "powershell.exe";
        }

        var uninstallScript = Path.Combine(installDir, "Uninstall-AgentBrowserGateway.ps1");
        var uninstallCommand =
            $"{QuoteCommandArgument(powershell)} -NoProfile -ExecutionPolicy Bypass -File {QuoteCommandArgument(uninstallScript)} -InstallDir {QuoteCommandArgument(installDir)}";

        using var key = Registry.CurrentUser.CreateSubKey(uninstallKeyPath);
        key.SetValue("DisplayName", "Agent Browser Gateway", RegistryValueKind.String);
        key.SetValue("DisplayVersion", displayVersion, RegistryValueKind.String);
        key.SetValue("Publisher", "ArcManagement", RegistryValueKind.String);
        key.SetValue("InstallLocation", installDir, RegistryValueKind.String);
        key.SetValue("DisplayIcon", Path.Combine(installDir, "AgentBrowserGateway.Windows.exe"), RegistryValueKind.String);
        key.SetValue("URLInfoAbout", "https://github.com/arcmanagement/agent-browser-gateway", RegistryValueKind.String);
        key.SetValue("UninstallString", uninstallCommand, RegistryValueKind.String);
        key.SetValue("QuietUninstallString", $"{uninstallCommand} -Silent", RegistryValueKind.String);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    }

    private static string QuoteCommandArgument(string value)
    {
        return $"\"{value.Replace("\"", "\\\"")}\"";
    }

    private static void StartGateway(string installDir)
    {
        var gateway = Path.Combine(installDir, "agent-browser-gateway.exe");
        if (!File.Exists(gateway))
        {
            throw new FileNotFoundException("Gateway executable was not found.", gateway);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = gateway,
            WorkingDirectory = installDir,
            UseShellExecute = true
        });
    }

    private static async Task WaitGatewayReadyAsync()
    {
        var client = new CliPipeClient();
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (DateTimeOffset.UtcNow < deadline)
        {
            var response = await client.CallAsync("status", timeoutMs: 700).ConfigureAwait(false);
            if (response.Error is null)
            {
                return;
            }
            await Task.Delay(500).ConfigureAwait(false);
        }

        throw new InvalidOperationException("Gateway was installed, but did not become ready within 10 seconds.");
    }

    private static ProcessResult RunHidden(string fileName, string arguments, string workingDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Failed to start {fileName}");
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        process.WaitForExit();
        return new ProcessResult(process.ExitCode, output);
    }

    private static bool IsSameOrChildPath(string parent, string child)
    {
        var parentPath = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var childPath = Path.GetFullPath(child).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return childPath.StartsWith(parentPath, StringComparison.OrdinalIgnoreCase);
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        RunOnUi(() =>
        {
            InstallButton.IsEnabled = !busy;
            InstallDirBox.IsEnabled = !busy;
            PathCheckBox.IsEnabled = !busy;
            StartCheckBox.IsEnabled = !busy;
            StartupCheckBox.IsEnabled = !busy;
            OpenFolderButton.IsEnabled = !busy;
        });
    }

    private void SetStatus(string text, double progress)
    {
        RunOnUi(() =>
        {
            StatusText.Text = text;
            Progress.Value = Math.Max(0, Math.Min(100, progress));
        });
    }

    private void RunOnUi(Action action)
    {
        if (!DispatcherQueue.HasThreadAccess)
        {
            DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, () => action());
            return;
        }

        action();
    }

    private async Task ShowErrorAsync(string message)
    {
        if (Content is not FrameworkElement root) return;
        var dialog = new ContentDialog
        {
            Title = "Install failed",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = root.XamlRoot
        };
        await dialog.ShowAsync();
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        var installDir = Environment.ExpandEnvironmentVariables(InstallDirBox.Text.Trim());
        if (Directory.Exists(installDir))
        {
            Process.Start(new ProcessStartInfo { FileName = installDir, UseShellExecute = true });
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private sealed record ProcessResult(int ExitCode, string Output);

    private static class NativeMethods
    {
        private const int HwndBroadcast = 0xffff;
        private const int WmSettingChange = 0x001a;
        private const int SmtoAbortIfHung = 0x0002;

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern nint SendMessageTimeout(
            nint hwnd,
            uint msg,
            nint wParam,
            string lParam,
            uint fuFlags,
            uint uTimeout,
            out nint lpdwResult);

        public static void BroadcastEnvironmentChange()
        {
            _ = SendMessageTimeout(
                new nint(HwndBroadcast),
                WmSettingChange,
                0,
                "Environment",
                SmtoAbortIfHung,
                5000,
                out _);
        }
    }
}
