# 一時 Zip インストール手順

この手順は、リポジトリを private のままにしている期間の一時配布用です。Homebrew ではなく、zip ファイルを Slack などで直接共有します。

## 前提

- Apple Silicon Mac のみ
- macOS 14 以上
- Google Chrome 116 以上

## 送るファイル

以下の 2 つを送ります。

```text
agent-browser-gateway-0.3.1-macos-arm64.zip
agent-browser-gateway-extension-0.3.1.zip
```

チェックサム:

```text
4fa4b9c060f9673de85af2aa3ea02bb909417d51009acd6dfd6604cb4f4ff8dd  agent-browser-gateway-0.3.1-macos-arm64.zip
559619e3351f2b57adaca2849fc3c316e13f842ed9e22b7670761ae1e922674a  agent-browser-gateway-extension-0.3.1.zip
```

`agent-browser-gateway-0.3.1-macos-arm64.zip` の中身:

```text
Agent Browser Gateway.app
abg
```

`Agent Browser Gateway.app` はメニューバーアプリです。`abg` は CLI です。アプリを起動しても `abg` コマンドは自動インストールされないので、両方を配置します。

## アプリと CLI をインストール

`agent-browser-gateway-0.3.1-macos-arm64.zip` を展開し、展開後のフォルダで以下を実行します。

```bash
sudo mkdir -p /usr/local/bin

sudo rm -rf "/Applications/Agent Browser Gateway.app"
sudo ditto "Agent Browser Gateway.app" "/Applications/Agent Browser Gateway.app"
sudo install -m 755 abg /usr/local/bin/abg

open "/Applications/Agent Browser Gateway.app"
abg status
```

`/usr/local/bin` が shell の `PATH` に入っていない場合は、`PATH` に追加するか、既に `PATH` に入っている別ディレクトリへ `abg` を配置してください。

## Chrome 拡張をインストール

`agent-browser-gateway-extension-0.3.1.zip` を、消さない場所へ展開します。

```bash
rm -rf "$HOME/Applications/Agent Browser Gateway Extension"
mkdir -p "$HOME/Applications/Agent Browser Gateway Extension"
unzip agent-browser-gateway-extension-0.3.1.zip -d "$HOME/Applications/Agent Browser Gateway Extension"
```

Chrome で以下を行います。

1. `chrome://extensions` を開く
2. `Developer mode` を有効にする
3. `Load unpacked` をクリックする
4. `$HOME/Applications/Agent Browser Gateway Extension` を選択する

このフォルダは削除しないでください。Chrome は選択したフォルダから unpacked extension を読み込みます。

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
