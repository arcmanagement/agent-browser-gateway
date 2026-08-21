namespace AgentBrowserGateway.Core;

public static class AbgPaths
{
    public const string Version = "0.4.5";
    public const int DefaultWsPort = 8765;
    public static string WsHost => "127.0.0.1";
    public static int WsPort => ResolveWsPort(Environment.GetEnvironmentVariable("ABG_PORT"));
    public static string RuntimeProfile => ProfileName ?? "prod";
    public static string CliPipeName =>
        ProfileName is { Length: > 0 } profile
            ? $"AgentBrowserGateway.Cli.{profile}"
            : "AgentBrowserGateway.Cli";

    private static string? ProfileName =>
        ResolveProfile(Environment.GetEnvironmentVariable("ABG_PROFILE"), WsPort);

    public static string LocalAppData =>
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    public static string UserProfile =>
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static string AppDataDir
    {
        get
        {
            var dir = ResolveProfiledDirectory(
                Environment.GetEnvironmentVariable("ABG_STATE_DIR"),
                LocalAppData,
                "AgentBrowserGateway");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string LogsDir
    {
        get
        {
            var logsOverride = Environment.GetEnvironmentVariable("ABG_LOGS_DIR");
            var dir = string.IsNullOrWhiteSpace(logsOverride)
                ? Path.Combine(AppDataDir, "Logs")
                : ExpandUserPath(logsOverride);
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string AuditLogPath => Path.Combine(LogsDir, "audit.jsonl");

    public static string ScreenshotDir
    {
        get
        {
            var component = ProfileName is { Length: > 0 } profile ? $"abg-{profile}" : "abg";
            var dir = Path.Combine(Path.GetTempPath(), component, "screenshots");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string LatestScreenshotMarker => Path.Combine(ScreenshotDir, "latest.txt");

    public static string AbgUserDir
    {
        get
        {
            var userOverride = Environment.GetEnvironmentVariable("ABG_USER_DIR");
            var dir = string.IsNullOrWhiteSpace(userOverride)
                ? Path.Combine(UserProfile, ProfileName is { Length: > 0 } profile ? $".abg-{profile}" : ".abg")
                : ExpandUserPath(userOverride);
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string UserPluginsDir
    {
        get
        {
            var dir = Path.Combine(AbgUserDir, "plugins");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string ExpandUserPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return path;
        if (path == "~") return UserProfile;
        if (path.StartsWith("~/", StringComparison.Ordinal) ||
            path.StartsWith(@"~\", StringComparison.Ordinal))
        {
            return Path.Combine(UserProfile, path[2..]);
        }
        return Environment.ExpandEnvironmentVariables(path);
    }

    public static int ResolveWsPort(string? rawPort)
    {
        return int.TryParse(rawPort?.Trim(), out var port) && port is >= 1 and <= 65535
            ? port
            : DefaultWsPort;
    }

    public static string? ResolveProfile(string? rawProfile, int wsPort)
    {
        if (!string.IsNullOrWhiteSpace(rawProfile))
        {
            return NormalizeProfile(rawProfile);
        }
        return wsPort == DefaultWsPort ? null : "dev";
    }

    public static string ResolveProfiledDirectory(string? overridePath, string baseDir, string productionComponent)
    {
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            return ExpandUserPath(overridePath);
        }
        var component = ProfileName is { Length: > 0 } profile
            ? $"{productionComponent}-{profile}"
            : productionComponent;
        return Path.Combine(baseDir, component);
    }

    private static string? NormalizeProfile(string rawProfile)
    {
        var trimmed = rawProfile.Trim();
        if (trimmed.Length == 0) return null;
        if (trimmed.Equals("prod", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("production", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("default", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var chars = trimmed
            .Select(ch => char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' or '-' ? ch : '-')
            .ToArray();
        var sanitized = new string(chars).Trim('.', '_', '-');
        return sanitized.Length == 0 ? null : sanitized;
    }
}
