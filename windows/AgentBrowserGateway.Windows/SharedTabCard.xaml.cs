using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace AgentBrowserGateway.Windows;

public sealed record SharedTabRow(string Ref, int TabId, string ExtensionId, string Title, string Url, string ProfileLabel,
    string AccessMode, string? Favicon, DateTimeOffset? ExpiresAt)
{
    public bool AllTabs => AccessMode == "all_tabs";
}

public sealed partial class SharedTabCard : UserControl
{
    public event EventHandler<SharedTabRow>? RevokeRequested;
    public event EventHandler<string>? CopyRequested;

    public SharedTabCard()
    {
        InitializeComponent();
        DataContextChanged += (_, _) => Refresh();
        Loaded += (_, _) => Refresh();
    }

    private async void Refresh()
    {
        if (DataContext is not SharedTabRow row) return;
        IdButton.Content = $"{row.Ref} · tab {row.TabId}";
        ToolTipService.SetToolTip(IdButton, UiText.T("Copy tab ID"));
        UrlButton.Content = UiText.T("Copy URL");
        RevokeButton.Content = UiText.T("Revoke");
        RevokeButton.Visibility = row.AllTabs ? Visibility.Collapsed : Visibility.Visible;
        ScopeBadge.Text = row.AllTabs ? UiText.T("all tabs") : "";
        Timing.Text = row.ExpiresAt is { } expiry
            ? (UiText.Japanese ? $"有効期限 {expiry.LocalDateTime:t}" : $"Expires {expiry.LocalDateTime:t}") : "";
        FaviconImage.Source = null;
        FallbackIcon.Visibility = Visibility.Visible;
        if (row.Favicon is null) return;
        try
        {
            var bytes = Convert.FromBase64String(row.Favicon.Split(',', 2)[1]);
            using var stream = new InMemoryRandomAccessStream();
            using var writer = new DataWriter(stream);
            writer.WriteBytes(bytes);
            await writer.StoreAsync();
            stream.Seek(0);
            var bitmap = new BitmapImage { DecodePixelWidth = 32, DecodePixelHeight = 32 };
            await bitmap.SetSourceAsync(stream);
            if (!ReferenceEquals(DataContext, row)) return;
            FaviconImage.Source = bitmap;
            FallbackIcon.Visibility = Visibility.Collapsed;
        }
        catch (Exception) { /* Keep the local placeholder when the browser icon cannot be decoded. */ }
    }

    private void CopyId_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is SharedTabRow row) CopyRequested?.Invoke(this, row.TabId.ToString());
    }

    private void CopyUrl_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is SharedTabRow row) CopyRequested?.Invoke(this, row.Url);
    }

    private void Revoke_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is SharedTabRow row && !row.AllTabs) RevokeRequested?.Invoke(this, row);
    }
}
