using System.Diagnostics;

namespace AgentBrowserGateway.Installer;

internal static class Program
{
    public static int Main()
    {
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
            return ShowMissingWinUiError(winUiApp);
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

    private static int ShowMissingWinUiError(string path)
    {
        try
        {
            File.WriteAllText(
                Path.Combine(AppContext.BaseDirectory, "setup-error.txt"),
                $"AgentBrowserGateway.Windows.exe was not found: {path}");
        }
        catch
        {
            // The launcher has no UI dependency; best effort error file only.
        }

        return 1;
    }
}
