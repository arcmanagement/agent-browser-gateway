using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class UiPreferencesTests
{
    [Fact]
    public void AppearanceAndLanguageSurviveRestartAndInvalidValuesRecover()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var path = Path.Combine(directory, "ui.json");
        try
        {
            new UiPreferences("dark", "ja").Save(path);
            Assert.Equal(new UiPreferences("dark", "ja"), UiPreferences.Load(path));
            File.WriteAllText(path, "{\"appearance\":\"invalid\",\"language\":\"invalid\"}");
            Assert.Equal(new UiPreferences(), UiPreferences.Load(path));
            File.WriteAllText(path, "{broken");
            Assert.Equal(new UiPreferences(), UiPreferences.Load(path));
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
