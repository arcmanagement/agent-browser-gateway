# 一時 Zip インストール手順

この手順は、リポジトリを private のままにしている期間の一時配布用です。Homebrew ではなく、zip ファイルを Slack などで直接共有します。

## 前提

- Apple Silicon Mac のみ
- macOS 14 以上
- Google Chrome 116 以上

## 送るファイル

以下の 2 つを送ります。

```text
agent-browser-gateway-0.4.5-macos-arm64.zip
agent-browser-gateway-extension-0.4.5.zip
```

チェックサム (リリース時に `make dist` の出力で更新):

```text
2a576dcda46c8eafebe4636f3b75dc352e3ac56aa1fbf25a41376465afd9857e  agent-browser-gateway-0.4.5-macos-arm64.zip
10cb6fbeee6f3dcf39978ad794447b4fb35f759635d1777264aa01d4c2504bed  agent-browser-gateway-extension-0.4.5.zip
```

`agent-browser-gateway-0.4.5-macos-arm64.zip` の中身:

```text
Agent Browser Gateway.app
abg
```

`Agent Browser Gateway.app` はメニューバーアプリです。`abg` は CLI です。アプリを起動しても `abg` コマンドは自動インストールされないので、CLI も配置します。Claude Code / Codex 用スキルは `npx skills add arcmanagement/agent-browser-gateway -g` でインストールします。

`Agent Browser Gateway.app` と `abg` は Developer ID 署名済みです。`Agent Browser Gateway.app` は notarization ticket を staple 済みです。

## アプリと CLI をインストール

`agent-browser-gateway-0.4.5-macos-arm64.zip` を展開し、展開後のフォルダで以下を実行します。

```bash
sudo mkdir -p /usr/local/bin

sudo rm -rf "/Applications/Agent Browser Gateway.app"
sudo ditto "Agent Browser Gateway.app" "/Applications/Agent Browser Gateway.app"
sudo install -m 755 abg /usr/local/bin/abg
sudo rm -rf /usr/local/bin/AgentBrowserGateway_abg.bundle  # 0.4.3 以前の残骸を掃除

open "/Applications/Agent Browser Gateway.app"
abg status
npx skills add arcmanagement/agent-browser-gateway -g
```

`/usr/local/bin` が shell の `PATH` に入っていない場合は、`PATH` に追加するか、既に `PATH` に入っている別ディレクトリへ `abg` を配置してください。

## Chrome 拡張をインストール

`agent-browser-gateway-extension-0.4.5.zip` を、消さない場所へ展開します。

```bash
rm -rf "$HOME/Applications/Agent Browser Gateway Extension"
mkdir -p "$HOME/Applications/Agent Browser Gateway Extension"
unzip agent-browser-gateway-extension-0.4.5.zip -d "$HOME/Applications/Agent Browser Gateway Extension"
```

Chrome で以下を行います。

1. `chrome://extensions` を開く
2. `Developer mode` を有効にする
3. `Load unpacked` をクリックする
4. `$HOME/Applications/Agent Browser Gateway Extension` を選択する

このフォルダは削除しないでください。Chrome は選択したフォルダから unpacked extension を読み込みます。

シークレットウィンドウで ABG を使う場合は、Chrome の拡張機能詳細画面で `Allow in incognito`
を有効にしてください。Chrome は初期状態では拡張機能をシークレットウィンドウで実行しません。
通常ウィンドウだけで使う場合、この設定は不要です。

## 動作確認

1. Chrome で共有したいタブを開く
2. `Agent Browser Gateway` 拡張アイコンをクリックする
3. `Share this tab with agent` をクリックする
4. 以下を実行する

```bash
abg status
abg tabs
```

共有したタブが `abg tabs` に表示されれば OK です。

## アンインストール

```bash
rm -rf "/Applications/Agent Browser Gateway.app"
sudo rm -f /usr/local/bin/abg
sudo rm -rf /usr/local/bin/AgentBrowserGateway_abg.bundle
rm -rf "$HOME/Applications/Agent Browser Gateway Extension"
```

Chrome 側でも `chrome://extensions` から `Agent Browser Gateway` を削除してください。

## 更新

新しい zip へ更新する場合:

1. `Agent Browser Gateway` を終了する
2. `/Applications/Agent Browser Gateway.app` を差し替える
3. `/usr/local/bin/abg` を差し替える
4. 展開済み Chrome 拡張フォルダを差し替える
5. `chrome://extensions` で拡張の reload ボタンを押す
6. `npx skills update -g` でスキルを更新する
