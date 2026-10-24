using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace AgentBrowserGateway.Windows;

public sealed partial class GateMark : UserControl
{
    private bool _open;
    private bool _sandbox;

    public GateMark()
    {
        InitializeComponent();
        ActualThemeChanged += (_, _) => Update(_open, _sandbox);
    }

    public void Update(bool open, bool sandbox = false)
    {
        _open = open;
        _sandbox = sandbox;
        Canvas.SetLeft(LeftPillar, open ? 5 : 6.6);
        Canvas.SetLeft(RightPillar, open ? 12.7 : 11.1);
        LeftRail.Width = open ? 4 : 5.6;
        Canvas.SetLeft(RightRail, open ? 15 : 13.4);
        RightRail.Width = open ? 4 : 5.6;
        Signal.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
        var color = sandbox
            ? (ActualTheme == ElementTheme.Dark ? Color.FromArgb(255, 255, 196, 110) : Color.FromArgb(255, 154, 81, 0))
            : (ActualTheme == ElementTheme.Dark ? Color.FromArgb(255, 61, 255, 143) : Color.FromArgb(255, 10, 122, 63));
        Signal.Fill = new SolidColorBrush(new AccessibilitySettings().HighContrast ? new UISettings().GetColorValue(UIColorType.Foreground) : color);
    }
}
