namespace AgentBrowserGateway.Core;

public static class AbgPaths
{
    public const string Version = "0.3.12";
    public const string WsHost = "127.0.0.1";
    public const int WsPort = 8765;
    public const string CliPipeName = "AgentBrowserGateway.Cli";

    public static string LocalAppData =>
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    public static string UserProfile =>
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static string AppDataDir
    {
        get
        {
            var dir = Path.Combine(LocalAppData, "AgentBrowserGateway");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string LogsDir
    {
        get
        {
            var dir = Path.Combine(AppDataDir, "Logs");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string AuditLogPath => Path.Combine(LogsDir, "audit.jsonl");

    public static string ScreenshotDir
    {
        get
        {
            var dir = Path.Combine(Path.GetTempPath(), "abg", "screenshots");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string LatestScreenshotMarker => Path.Combine(ScreenshotDir, "latest.txt");

    public static string AbgUserDir
    {
        get
        {
            var dir = Path.Combine(UserProfile, ".abg");
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

    public static string ClaudeSkillsDir => Path.Combine(UserProfile, ".claude", "skills");

    public static string CodexSkillsDir
    {
        get
        {
            var codexHome = Environment.GetEnvironmentVariable("CODEX_HOME");
            var home = string.IsNullOrWhiteSpace(codexHome)
                ? Path.Combine(UserProfile, ".codex")
                : ExpandUserPath(codexHome);
            return Path.Combine(home, "skills");
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
}
