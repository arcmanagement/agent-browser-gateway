using System.Globalization;
using AgentBrowserGateway.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace AgentBrowserGateway.Windows;

internal static class UiText
{
    public static UiPreferences Preferences { get; private set; } = UiPreferences.Load();
    public static event Action? Changed;
    public static bool Japanese => Preferences.Language == "ja" ||
        (Preferences.Language == "auto" && CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ja");

    public static ElementTheme Theme => Preferences.Appearance switch
    {
        "light" => ElementTheme.Light,
        "dark" => ElementTheme.Dark,
        _ => ElementTheme.Default
    };

    public static void Save(UiPreferences value)
    {
        value.Save();
        Preferences = value;
        Changed?.Invoke();
    }

    public static string T(string english) => Japanese && JapaneseText.TryGetValue(english, out var text) ? text : english;

    public static void Apply(FrameworkElement root)
    {
        root.RequestedTheme = Theme;
        Walk(root);
    }

    private static void Walk(DependencyObject item)
    {
        if (item is FrameworkElement { Tag: string key })
        {
            var text = T(key);
            switch (item)
            {
                case TextBlock block: block.Text = text; break;
                case NavigationViewItem navigation: navigation.Content = text; break;
                case Button button: button.Content = text; break;
                case CheckBox check: check.Content = text; break;
                case ComboBox combo: combo.Header = text; break;
                case TextBox box: box.Header = text; break;
            }
        }
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(item); i++) Walk(VisualTreeHelper.GetChild(item, i));
    }

    private static readonly Dictionary<string, string> JapaneseText = new()
    {
        ["Connected"] = "接続済み", ["Filter activity"] = "操作履歴を絞り込む", ["No matching activity"] = "一致する操作はありません", ["Local · current user"] = "この PC・現在のユーザー", ["Gateway executable was not found."] = "Gateway の実行ファイルが見つかりません。",
        ["Overview"] = "概要", ["Shared tabs"] = "共有タブ", ["Audit"] = "操作履歴", ["Plugins"] = "プラグイン", ["Settings"] = "設定",
        ["RIGHT NOW"] = "現在の共有状態", ["Browser"] = "ブラウザー", ["Agents"] = "エージェント", ["Gateway"] = "Gateway",
        ["Browsers"] = "接続ブラウザー", ["CLI transport"] = "CLI の接続", ["Named pipe"] = "名前付きパイプ",
        ["Copy status command"] = "状態確認コマンドをコピー", ["Manage shared tabs"] = "共有タブを管理", ["Refresh"] = "更新",
        ["Waiting for a browser"] = "ブラウザーの接続待ち", ["Agents can't see any tab"] = "共有しているタブはありません",
        ["Gateway is stopped"] = "Gateway は停止しています", ["Start Gateway"] = "Gateway を起動",
        ["Open Chrome with the ABG extension. Share a tab from its popup to let agents access it."] = "ABG 拡張機能を入れた Chrome を開き、拡張機能のポップアップからタブを共有してください。",
        ["Every tab stays shared until you revoke it or it leaves its site."] = "共有は、解除するかタブが別のサイトへ移動するまで続きます。",
        ["All-tabs mode is enabled in a sandbox profile. Turn it off in that profile's extension popup."] = "サンドボックスのプロファイルで全タブ共有が有効です。解除は、その拡張機能のポップアップで行ってください。",
        ["No shared tabs"] = "共有タブはありません", ["Share this tab with agents"] = "このタブをエージェントと共有",
        ["Revoke"] = "共有を解除", ["Copy tab ID"] = "タブ ID をコピー", ["Copy URL"] = "URL をコピー", ["all tabs"] = "全タブ共有",
        ["Appearance"] = "表示モード", ["System"] = "システムに合わせる", ["Light"] = "ライト", ["Dark"] = "ダーク",
        ["Language"] = "表示言語", ["Automatic"] = "自動", ["Launch at sign in"] = "サインイン時に起動",
        ["Open audit log"] = "操作履歴を開く", ["Open logs folder"] = "ログフォルダーを開く", ["Open plugins folder"] = "プラグインフォルダーを開く",
        ["Local files"] = "ローカルファイル", ["Everything stays on this PC. No analytics or cloud dependency."] = "データはこの PC に保存されます。解析データの送信やクラウドへの依存はありません。",
        ["Windows plugins"] = "Windows のプラグイン", ["Dynamic plugin commands are not supported on Windows yet."] = "Windows では動的プラグインのコマンド実行にまだ対応していません。",
        ["Recent activity"] = "最近の操作", ["No activity yet"] = "操作履歴はまだありません", ["Quick start"] = "使い始める",
        ["Copied"] = "コピーしました", ["Refresh failed"] = "更新できませんでした", ["Action failed"] = "操作できませんでした",
        ["Install location"] = "インストール先", ["Add Agent Browser Gateway to PATH"] = "Agent Browser Gateway を PATH に追加",
        ["Start tray Gateway after install"] = "インストール後に Gateway を起動", ["Launch tray Gateway when I sign in"] = "サインイン時に Gateway を起動",
        ["Install / Update"] = "インストール／更新", ["Close"] = "閉じる", ["Open install folder"] = "インストール先を開く",
        ["Ready"] = "準備完了", ["Windows native setup"] = "Windows のセットアップ", ["Installed"] = "インストール済み",
        ["Installed successfully."] = "インストールが完了しました。", ["Stopping existing Gateway..."] = "現在の Gateway を停止しています…",
        ["Replacing installed files..."] = "ファイルを更新しています…", ["Updating PATH..."] = "PATH を更新しています…",
        ["Configuring sign-in startup..."] = "自動起動を設定しています…", ["Registering uninstall entry..."] = "アンインストール情報を登録しています…",
        ["Starting tray Gateway..."] = "Gateway を起動しています…", ["Ready to update the Windows Gateway"] = "Windows Gateway を更新できます",
        ["Ready to install the Windows Gateway"] = "Windows Gateway をインストールできます",
        ["Share only what you choose."] = "共有するタブは、あなたが選ぶ。",
        ["Install the Gateway, then share a tab from the browser extension."] = "Gateway をインストールして、ブラウザー拡張機能からタブを共有してください。",
        ["Setup replaces the existing app and applies the options above."] = "既存のアプリを更新し、選択した設定を適用します。"
    };
}
