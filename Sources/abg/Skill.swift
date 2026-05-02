enum SkillBundle {
    static let version: String = "0.1.2"

    static let markdown: String = """
---
name: agent-browser-gateway
version: 0.1.2
description: 普段使いの Chrome タブを per-tab 明示許可で AI に渡すゲートウェイ。ユーザーが「いま見てる画面を見て」「このタブの DOM/スクショ/コンソールを取って」「ここをクリックして」のように現在の Chrome タブの内容や操作に言及したとき、`abg` CLI で共有中タブを観測・操作する
---

# Agent Browser Gateway

ユーザーは Chrome 拡張アイコンをクリックして「このタブを共有」を**明示的に許可**したタブだけを、`abg` CLI 経由で参照できる。許可されていないタブには触れない (エラーになる)。

## 基本フロー

1. `abg status` で Gateway が起動しているか確認 (running: true なら OK)
2. `abg tabs` で共有中タブの ID と URL を確認
3. 必要に応じて `abg read <tabId>` / `abg screenshot <tabId>` / `abg console <tabId>` を呼ぶ
4. タブが共有されていない場合は、ユーザーに「Chrome 拡張のアイコンをクリックして対象タブを共有してください」と案内する

## CLI コマンド

```bash
# 観測系
abg status                              # Gateway 起動状況、接続中拡張、共有タブ数
abg tabs                                # 共有中タブ一覧 (JSON、tabId と url を含む)
abg read <tabId> [--selector "<css>"] [--as-markdown]  # DOM (要素絞り + Markdown 化可)
abg screenshot <tabId> [--out <path>] [--x N --y N --width N --height N]  # 全体 or 領域
abg console <tabId>                     # console ログ

# 操作系 (v0.1.1)
abg click <tabId> --selector "<css>"            # CSS selector でクリック
abg click <tabId> --x <px> --y <px>             # 座標でクリック (canvas にも有効)
abg fill <tabId> --selector "<css>" --value "<text>"  # input/textarea に入力
abg type <tabId> "<text>"               # 現在フォーカスにテキスト送信 (Sheets セル等)
abg key <tabId> <key> [--modifiers ctrl,shift]  # キー入力 (Enter/Space/ArrowDown/a 等)
abg navigate <tabId> "<url>"            # タブを遷移 (別 origin で許可失効)
abg scroll <tabId> [--dy 800] [--dx 0] [--at-x N --at-y N]  # ホイールスクロール (内側 div も可)

# 待機系 (v0.1.2)
abg wait <tabId> --selector "<css>"             # 要素が出現するまで (デフォルト 10s)
abg wait <tabId> --selector "<css>" --hidden    # 要素が消えるまで
abg wait <tabId> --ms 1500                       # 単純 sleep

# 管理系
abg revoke <tabId>                      # タブの共有を解除
abg audit [--lines 50]                  # 監査ログ閲覧
```

## 注意点

- `abg` の出力は基本 JSON。値を取り出すときは `jq` 等でパースする
- `abg tabs` の結果が空なら、まずユーザーに共有を依頼する。**勝手にタブを覗こうとしない**
- `tabId` は Chrome 内部のタブ ID で、ブラウザ再起動で変わる。常に `abg tabs` で最新を取得する
- 共有はユーザーが明示的に許可した時だけ。CLI から `permit` で勝手に許可することはできない
- screenshot / console / click_at / type / key は Chrome の DevTools Protocol を使うため、対象タブには「このタブはデバッグ中です」の黄色バーが表示される (透明性の担保)
- **canvas ベースのアプリ (Google Sheets, Figma, Google Docs 等) の操作**:
  - DOM ベースの `click --selector` は効かない。`click --x --y` で座標クリック
  - 文字入力は `type` (Input.insertText 経由)。事前に対象セルにフォーカスを当てる
  - 例: Sheets の D1 チェックボックス ON → screenshot で D1 の座標確認 → `abg click <tab> --x N --y M`
  - もしくは Sheets のキーボードナビ: `abg key <tab> Space` で選択中セルのチェック切替 (要事前にセル選択)
- 操作系 (`click` / `fill` / `type` / `key` / `navigate` / `scroll`) を呼ぶ前に、必ず screenshot か read で**現状を確認**する。盲目的に操作しない
- ページ遷移後など要素出現を待つときは `abg wait <tabId> --selector "..."` を使う。`sleep` を bash で書かない
- read は出力が大きいので、可能なら `--selector` で絞るか `--as-markdown` で圧縮する。token 効率に直結
"""
}
