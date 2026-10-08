using Microsoft.UI.Xaml;
namespace AgentBrowserGateway.Windows;
public sealed partial class StatusWindow : Window
{
    public StatusWindow() { InitializeComponent(); WindowSizing.Apply(this, Dashboard, 1100, 780); }
}
