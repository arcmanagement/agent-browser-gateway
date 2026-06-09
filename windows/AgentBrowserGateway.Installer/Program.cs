using System.Diagnostics;

namespace AgentBrowserGateway.Installer;

internal static class Program
{
    public static int Main(string[] args)
    {
        var options = InstallerOptions.Parse(args);
        var setupRoot = AppContext.BaseDirectory;
        var payloadDir = Path.Combine(setupRoot, "payload");
        var winUiApp = Path.Combine(payloadDir, "AgentBrowserGateway.Windows.exe");

        if (!File.Exists(winUiApp))
        {
            payloadDir = setupRoot;
            winUiApp = Path.Combine(setupRoot, "AgentBrowserGateway.Windows.exe");
        }

        if (!File.Exists(winUiApp))
        {
            return ShowMissingPayloadError(winUiApp);
        }

        if (options.Silent)
        {
            return RunSilentInstall(payloadDir, options);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = winUiApp,
            WorkingDirectory = Path.GetDirectoryName(winUiApp)!,
            UseShellExecute = false
        };
        startInfo.ArgumentList.Add("--setup");
        startInfo.ArgumentList.Add("--payload");
        startInfo.ArgumentList.Add(payloadDir);

        using var process = Process.Start(startInfo);

        if (process is null) return 1;
        process.WaitForExit();
        return process.ExitCode;
    }

    private static int RunSilentInstall(string payloadDir, InstallerOptions options)
    {
        var scriptPath = Path.Combine(payloadDir, "Install-AgentBrowserGateway.ps1");
        if (!File.Exists(scriptPath))
        {
            return ShowMissingPayloadError(scriptPath);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = payloadDir,
            UseShellExecute = false
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        if (!string.IsNullOrWhiteSpace(options.InstallDir))
        {
            startInfo.ArgumentList.Add("-InstallDir");
            startInfo.ArgumentList.Add(options.InstallDir);
        }
        if (options.NoPathUpdate) startInfo.ArgumentList.Add("-NoPathUpdate");
        if (options.NoStart) startInfo.ArgumentList.Add("-NoStart");
        if (options.StartUi) startInfo.ArgumentList.Add("-StartUi");

        using var process = Process.Start(startInfo);
        if (process is null) return 1;

        process.WaitForExit();
        return process.ExitCode;
    }

    private static int ShowMissingPayloadError(string path)
    {
        try
        {
            File.WriteAllText(
                Path.Combine(AppContext.BaseDirectory, "setup-error.txt"),
                $"Setup payload was not found: {path}");
        }
        catch
        {
            // The launcher has no UI dependency; best effort error file only.
        }

        return 1;
    }

    private sealed record InstallerOptions(
        bool Silent,
        string? InstallDir,
        bool NoPathUpdate,
        bool NoStart,
        bool StartUi)
    {
        public static InstallerOptions Parse(IReadOnlyList<string> args)
        {
            var silent = false;
            string? installDir = null;
            var noPathUpdate = false;
            var noStart = false;
            var startUi = false;

            for (var index = 0; index < args.Count; index++)
            {
                var arg = args[index];
                if (EqualsArg(arg, "--silent") || EqualsArg(arg, "/silent") || EqualsArg(arg, "/quiet"))
                {
                    silent = true;
                }
                else if (EqualsArg(arg, "--interactive"))
                {
                    silent = false;
                }
                else if ((EqualsArg(arg, "--install-dir") || EqualsArg(arg, "/installDir")) && index + 1 < args.Count)
                {
                    installDir = args[++index];
                }
                else if (EqualsArg(arg, "--no-path-update"))
                {
                    noPathUpdate = true;
                }
                else if (EqualsArg(arg, "--no-start"))
                {
                    noStart = true;
                }
                else if (EqualsArg(arg, "--start-ui"))
                {
                    startUi = true;
                }
            }

            return new InstallerOptions(silent, installDir, noPathUpdate, noStart, startUi);
        }

        private static bool EqualsArg(string actual, string expected)
        {
            return string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
        }
    }
}
