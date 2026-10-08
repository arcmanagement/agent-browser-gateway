using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace AgentBrowserGateway.Windows;

internal static class WindowSizing
{
    public static void Apply(Window window, FrameworkElement root, int width, int height)
    {
        void ApplyTheme()
        {
            root.RequestedTheme = UiText.Theme;
            if (new AccessibilitySettings().HighContrast) return;
            var dark = root.ActualTheme == ElementTheme.Dark;
            var background = dark ? Color.FromArgb(255, 13, 17, 18) : Color.FromArgb(255, 246, 247, 245);
            var foreground = dark ? Color.FromArgb(255, 255, 255, 255) : Color.FromArgb(255, 0, 0, 0);
            var bar = window.AppWindow.TitleBar;
            bar.BackgroundColor = bar.ButtonBackgroundColor = background;
            bar.ForegroundColor = bar.ButtonForegroundColor = foreground;
            bar.InactiveBackgroundColor = bar.ButtonInactiveBackgroundColor = background;
        }
        root.ActualThemeChanged += (_, _) => ApplyTheme();
        UiText.Changed += ApplyTheme;
        window.Closed += (_, _) => UiText.Changed -= ApplyTheme;
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "Abg.ico");
        if (File.Exists(icon)) window.AppWindow.SetIcon(icon);
        root.Loaded += (_, _) =>
        {
            ApplyTheme();
            var scale = root.XamlRoot.RasterizationScale;
            var work = DisplayArea.GetFromWindowId(window.AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
            var size = new SizeInt32(Math.Min((int)(width * scale), work.Width - 48), Math.Min((int)(height * scale), work.Height - 48));
            window.AppWindow.Resize(size);
            window.AppWindow.Move(new PointInt32(work.X + (work.Width - size.Width) / 2, work.Y + (work.Height - size.Height) / 2));
        };
    }
}
