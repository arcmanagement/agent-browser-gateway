using System.Runtime.Versioning;
using Microsoft.Win32;

namespace AgentBrowserGateway.Core;

public static class WindowsStartup
{
    public const string ValueName = "Agent Browser Gateway";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static string GatewayExecutablePath(string installDir)
    {
        return Path.Combine(Path.GetFullPath(installDir), "agent-browser-gateway.exe");
    }

    public static string CommandFor(string executablePath)
    {
        return Quote(Path.GetFullPath(executablePath));
    }

    public static bool CommandTargetsExecutable(string? command, string executablePath)
    {
        if (string.IsNullOrWhiteSpace(command)) return false;
        if (!TryReadExecutable(command, out var actualExecutable)) return false;

        var expected = Path.GetFullPath(executablePath).TrimEnd('\\');
        actualExecutable = Path.GetFullPath(actualExecutable).TrimEnd('\\');
        return string.Equals(actualExecutable, expected, StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsEnabledFor(string executablePath)
    {
        if (!OperatingSystem.IsWindows()) return false;
        return CommandTargetsExecutable(ReadCommand(), executablePath);
    }

    public static string? CurrentCommand()
    {
        if (!OperatingSystem.IsWindows()) return null;
        return ReadCommand();
    }

    public static void SetEnabled(string executablePath)
    {
        if (!OperatingSystem.IsWindows()) return;
        WriteCommand(CommandFor(executablePath));
    }

    public static void Disable()
    {
        if (!OperatingSystem.IsWindows()) return;
        DeleteCommand();
    }

    private static string Quote(string value)
    {
        return $"\"{value.Replace("\"", "\\\"")}\"";
    }

    private static bool TryReadExecutable(string command, out string executablePath)
    {
        command = command.Trim();
        executablePath = "";

        if (command.StartsWith('"'))
        {
            var endQuote = command.IndexOf('"', startIndex: 1);
            if (endQuote <= 1) return false;
            executablePath = command[1..endQuote];
            return true;
        }

        var firstSpace = command.IndexOf(' ');
        executablePath = firstSpace < 0 ? command : command[..firstSpace];
        return !string.IsNullOrWhiteSpace(executablePath);
    }

    [SupportedOSPlatform("windows")]
    private static string? ReadCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return key?.GetValue(ValueName) as string;
    }

    [SupportedOSPlatform("windows")]
    private static void WriteCommand(string command)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
        key.SetValue(ValueName, command, RegistryValueKind.String);
    }

    [SupportedOSPlatform("windows")]
    private static void DeleteCommand()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
