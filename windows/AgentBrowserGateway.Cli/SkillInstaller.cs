using System.Reflection;
using System.Text.RegularExpressions;
using AgentBrowserGateway.Core;

namespace AgentBrowserGateway.Cli;

internal static class SkillInstaller
{
    public static int Install(string[] args)
    {
        var target = "both";
        var noUpgrade = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--target" when i + 1 < args.Length:
                    target = args[++i];
                    break;
                case "--no-upgrade":
                    noUpgrade = true;
                    break;
                default:
                    Console.Error.WriteLine("usage: abg install-skill [--target both|claude|codex] [--no-upgrade]");
                    return 2;
            }
        }

        var bases = target switch
        {
            "claude" => new[] { AbgPaths.ClaudeSkillsDir },
            "codex" => new[] { AbgPaths.CodexSkillsDir },
            "both" => new[] { AbgPaths.ClaudeSkillsDir, AbgPaths.CodexSkillsDir },
            _ => throw new ArgumentException("--target must be claude, codex, or both")
        };

        var markdown = ReadBundledSkill("agent-browser-gateway.windows.md");
        var bundledVersion = ReadVersion(markdown) ?? AbgPaths.Version;
        var pluginCreatorMarkdown = ReadBundledSkill("abg-plugin-creator.windows.md");
        var pluginCreatorVersion = ReadVersion(pluginCreatorMarkdown) ?? AbgPaths.Version;
        foreach (var baseDir in bases)
        {
            InstallOne(baseDir, "agent-browser-gateway", markdown, bundledVersion, noUpgrade);
            InstallOne(baseDir, "abg-plugin-creator", pluginCreatorMarkdown, pluginCreatorVersion, noUpgrade);
        }

        var legacy = Path.Combine(AbgPaths.ClaudeSkillsDir, "agent-browser-gateway.md");
        if (File.Exists(legacy))
        {
            File.Delete(legacy);
            Console.WriteLine($"removed legacy: {legacy}");
        }
        return 0;
    }

    private static void InstallOne(string baseDir, string skillName, string markdown, string bundledVersion, bool noUpgrade)
    {
        var skillDir = Path.Combine(baseDir, skillName);
        Directory.CreateDirectory(skillDir);
        var dest = Path.Combine(skillDir, "SKILL.md");
        var installedMarkdown = File.Exists(dest) ? File.ReadAllText(dest) : null;
        var installedVersion = installedMarkdown is null ? null : ReadVersion(installedMarkdown);

        if (installedVersion == bundledVersion && installedMarkdown == markdown)
        {
            Console.WriteLine($"up-to-date: {dest} (v{bundledVersion})");
            return;
        }
        if (installedVersion is not null && installedVersion != bundledVersion && noUpgrade)
        {
            Console.WriteLine($"skipped: installed v{installedVersion}, bundled v{bundledVersion} at {dest}. Re-run without --no-upgrade to overwrite.");
            return;
        }

        File.WriteAllText(dest, markdown);
        if (installedVersion is null)
        {
            Console.WriteLine($"installed: v{bundledVersion} at {dest}");
        }
        else if (installedVersion == bundledVersion)
        {
            Console.WriteLine($"updated: content changed at {dest} (v{bundledVersion})");
        }
        else
        {
            Console.WriteLine($"upgraded: v{installedVersion} -> v{bundledVersion} at {dest}");
        }
    }

    private static string ReadBundledSkill(string suffix)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resource = assembly.GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith(suffix, StringComparison.Ordinal));
        if (resource is null) throw new InvalidOperationException($"Bundled Windows skill resource was not found: {suffix}");
        using var stream = assembly.GetManifestResourceStream(resource) ?? throw new InvalidOperationException($"Bundled Windows skill resource could not be opened: {suffix}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static string? ReadVersion(string markdown)
    {
        foreach (var line in markdown.Split('\n').Take(20))
        {
            var match = Regex.Match(line.Trim(), @"^version:\s*(.+)$");
            if (match.Success) return match.Groups[1].Value.Trim();
        }
        return null;
    }
}
