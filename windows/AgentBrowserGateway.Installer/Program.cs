using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using System.Windows.Forms;
using AgentBrowserGateway.Core;

namespace AgentBrowserGateway.Installer;

internal static class Program
{
    [STAThread]
    public static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
    }
}

internal sealed class SetupForm : Form
{
    private const string DefaultInstallDir = @"C:\Tools\AgentBrowserGateway";
    private readonly string _payloadDir = Path.Combine(AppContext.BaseDirectory, "payload");
    private readonly TextBox _installDirBox = new();
    private readonly CheckBox _pathCheckBox = new();
    private readonly CheckBox _startCheckBox = new();
    private readonly Label _modeLabel = new();
    private readonly Label _statusLabel = new();
    private readonly ProgressBar _progressBar = new();
    private readonly Button _installButton = new();
    private readonly Button _openFolderButton = new();
    private bool _busy;

    public SetupForm()
    {
        Text = "Agent Browser Gateway Setup";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 500);
        Size = new Size(760, 540);
        BackColor = Color.FromArgb(248, 250, 252);
        Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

        BuildLayout();
        DetectMode();
    }

    private void BuildLayout()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = BackColor
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 116));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        Controls.Add(root);

        var header = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            Padding = new Padding(30, 24, 30, 20)
        };
        root.Controls.Add(header, 0, 0);

        var title = new Label
        {
            AutoSize = true,
            Text = "Agent Browser Gateway",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 22F, FontStyle.Bold, GraphicsUnit.Point),
            Location = new Point(30, 22)
        };
        header.Controls.Add(title);

        var subtitle = new Label
        {
            AutoSize = true,
            Text = "Windows native setup",
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point),
            Location = new Point(33, 72)
        };
        header.Controls.Add(subtitle);

        var body = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(30, 26, 30, 20),
            BackColor = BackColor
        };
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 116));
        body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(body, 0, 1);

        body.Controls.Add(new Label
        {
            AutoSize = true,
            Text = "Install location",
            ForeColor = Color.FromArgb(15, 23, 42),
            Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point)
        }, 0, 0);

        _installDirBox.Dock = DockStyle.Fill;
        _installDirBox.Text = DefaultInstallDir;
        body.Controls.Add(_installDirBox, 0, 1);

        var checks = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false
        };
        _pathCheckBox.AutoSize = true;
        _pathCheckBox.Checked = true;
        _pathCheckBox.Text = "Add Agent Browser Gateway to PATH";
        _startCheckBox.AutoSize = true;
        _startCheckBox.Checked = true;
        _startCheckBox.Text = "Start tray Gateway after install";
        checks.Controls.Add(_pathCheckBox);
        checks.Controls.Add(_startCheckBox);
        body.Controls.Add(checks, 0, 2);

        var statusPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Padding = new Padding(16)
        };
        body.Controls.Add(statusPanel, 0, 3);

        _modeLabel.AutoSize = true;
        _modeLabel.Text = "Ready";
        _modeLabel.ForeColor = Color.FromArgb(15, 23, 42);
        _modeLabel.Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
        _modeLabel.Location = new Point(16, 14);
        statusPanel.Controls.Add(_modeLabel);

        _statusLabel.Text = "This setup will update existing files and restart the Gateway.";
        _statusLabel.ForeColor = Color.FromArgb(71, 85, 105);
        _statusLabel.AutoSize = false;
        _statusLabel.Size = new Size(620, 42);
        _statusLabel.Location = new Point(16, 40);
        statusPanel.Controls.Add(_statusLabel);

        _progressBar.Location = new Point(16, 86);
        _progressBar.Size = new Size(640, 12);
        _progressBar.Minimum = 0;
        _progressBar.Maximum = 100;
        statusPanel.Controls.Add(_progressBar);

        var footer = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(30, 16, 30, 18),
            BackColor = BackColor
        };
        root.Controls.Add(footer, 0, 2);

        _installButton.Text = "Install / Update";
        _installButton.Width = 136;
        _installButton.Height = 34;
        _installButton.BackColor = Color.FromArgb(37, 99, 235);
        _installButton.ForeColor = Color.White;
        _installButton.FlatStyle = FlatStyle.Flat;
        _installButton.FlatAppearance.BorderSize = 0;
        _installButton.Click += InstallButton_Click;
        footer.Controls.Add(_installButton);

        var closeButton = new Button { Text = "Close", Width = 92, Height = 34 };
        closeButton.Click += (_, _) => Close();
        footer.Controls.Add(closeButton);

        _openFolderButton.Text = "Open install folder";
        _openFolderButton.Width = 140;
        _openFolderButton.Height = 34;
        _openFolderButton.Click += OpenFolderButton_Click;
        footer.Controls.Add(_openFolderButton);
    }

    private void DetectMode()
    {
        var installed = File.Exists(Path.Combine(DefaultInstallDir, "abg.exe"));
        _modeLabel.Text = installed ? "Ready to update" : "Ready to install";
    }

    private async void InstallButton_Click(object? sender, EventArgs e)
    {
        if (_busy) return;

        var installDir = Environment.ExpandEnvironmentVariables(_installDirBox.Text.Trim());
        var addToPath = _pathCheckBox.Checked;
        var startAfterInstall = _startCheckBox.Checked;

        SetBusy(true);
        try
        {
            await Task.Run(() => InstallAsync(installDir, addToPath, startAfterInstall)).ConfigureAwait(true);
            SetStatus("Installed successfully.", 100);
            _modeLabel.Text = "Installed";
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message, 0);
            MessageBox.Show(this, ex.Message, "Install failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task InstallAsync(string installDir, bool addToPath, bool startAfterInstall)
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

        SetStatus("Updating Claude/Codex skills...", 72);
        RunInstallSkill(targetDir);

        if (startAfterInstall)
        {
            SetStatus("Starting tray Gateway...", 86);
            StartGateway(targetDir);
            await WaitGatewayReadyAsync().ConfigureAwait(false);
        }
    }

    private static void StopExistingGateway()
    {
        var names = new[] { "agent-browser-gateway", "AgentBrowserGateway.Windows" };
        var processes = names
            .SelectMany(Process.GetProcessesByName)
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
            if (names.SelectMany(Process.GetProcessesByName).Any())
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

        throw new InvalidOperationException("Port 127.0.0.1:8765 is still in use. Stop the existing Gateway, then retry.");
    }

    private static bool GatewayPortOpen()
    {
        using var client = new TcpClient();
        try
        {
            var connect = client.BeginConnect("127.0.0.1", AbgPaths.WsPort, null, null);
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
            _installButton.Enabled = !busy;
            _installDirBox.Enabled = !busy;
            _pathCheckBox.Enabled = !busy;
            _startCheckBox.Enabled = !busy;
        });
    }

    private void SetStatus(string text, double progress)
    {
        RunOnUi(() =>
        {
            _statusLabel.Text = text;
            _progressBar.Value = Math.Max(0, Math.Min(100, (int)progress));
        });
    }

    private void RunOnUi(Action action)
    {
        if (InvokeRequired)
        {
            BeginInvoke(action);
            return;
        }

        action();
    }

    private void OpenFolderButton_Click(object? sender, EventArgs e)
    {
        var installDir = Environment.ExpandEnvironmentVariables(_installDirBox.Text.Trim());
        if (Directory.Exists(installDir))
        {
            Process.Start(new ProcessStartInfo { FileName = installDir, UseShellExecute = true });
        }
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}
