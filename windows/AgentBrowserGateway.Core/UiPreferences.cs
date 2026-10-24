using System.Text.Json;

namespace AgentBrowserGateway.Core;

public sealed record UiPreferences(string Appearance = "system", string Language = "auto")
{
    public static UiPreferences Load(string? path = null)
    {
        try
        {
            var value = JsonSerializer.Deserialize<UiPreferences>(File.ReadAllText(path ?? FilePath), JsonUtil.Options);
            return value?.Validated() ?? new();
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return new();
        }
    }

    public void Save(string? path = null)
    {
        var target = path ?? FilePath;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(target))!);
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(Validated(), JsonUtil.PrettyOptions));
            File.Move(temporary, target, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private UiPreferences Validated() => new(
        Appearance is "light" or "dark" ? Appearance : "system",
        Language is "en" or "ja" ? Language : "auto");

    private static string FilePath => Path.Combine(AbgPaths.AppDataDir, "ui-preferences.json");
}
