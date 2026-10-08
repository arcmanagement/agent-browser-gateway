using Microsoft.UI.Xaml;
namespace AgentBrowserGateway.Windows;
public sealed partial class MainWindow : Window
{
    public MainWindow() { InitializeComponent(); Dashboard.AutoStartGateway = true; WindowSizing.Apply(this, Dashboard, 1100, 780); }
}
