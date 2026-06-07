using Microsoft.UI.Xaml;

namespace AgentBrowserGateway.Windows;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var options = LaunchOptions.Parse(Environment.GetCommandLineArgs().Skip(1));
        _window = options.Mode switch
        {
            LaunchMode.Setup => new SetupWindow(options.PayloadDir),
            LaunchMode.Status => new StatusWindow(),
            _ => new MainWindow()
        };
        _window.Activate();
    }
}

internal enum LaunchMode
{
    Gateway,
    Setup,
    Status
}

internal sealed record LaunchOptions(LaunchMode Mode, string? PayloadDir)
{
    public static LaunchOptions Parse(IEnumerable<string> args)
    {
        var mode = LaunchMode.Gateway;
        string? payloadDir = null;
        var tokens = args.ToList();
        for (var index = 0; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (string.Equals(token, "--setup", StringComparison.OrdinalIgnoreCase))
            {
                mode = LaunchMode.Setup;
            }
            else if (string.Equals(token, "--status", StringComparison.OrdinalIgnoreCase))
            {
                mode = LaunchMode.Status;
            }
            else if (string.Equals(token, "--payload", StringComparison.OrdinalIgnoreCase) &&
                     index + 1 < tokens.Count)
            {
                payloadDir = tokens[++index];
            }
        }

        return new LaunchOptions(mode, payloadDir);
    }
}
