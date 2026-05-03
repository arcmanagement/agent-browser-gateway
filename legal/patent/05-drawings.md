# 図面

本図面一式は、JPO 提出前に Mermaid から SVG 又は PDF へ変換し、必要に応じてモノクロ線画として整形する。各図の符号は明細書【符号の説明】と一致させる。

## 図面一覧

【図1】全体構成図。ブラウザ拡張機能10、Gateway モジュール20、コマンドラインインターフェース30、ブラウザタブ40、プラグイン50、監査ログ60、許可管理部70、ローカル通信路80、AI エージェント90を示す。

【図2】共有許可ライフサイクル。非共有、共有許可操作中、共有中、失効の状態遷移を示す。

【図3】origin 変更時の自動失効フロー。ブラウザタブ40、ブラウザ拡張機能10、許可管理部70、Gateway モジュール20、監査ログ60、コマンドラインインターフェース30間の通知順序を示す。

【図4】メッセージフロー。AI エージェント90からブラウザタブ40までの操作要求及び結果返送の経路を示す。

【図5】CDP + activeTab 型構成と全 URL 一括 host_permissions 型構成の比較を示す。

【図6】プラグインアーキテクチャ。Gateway モジュール20内のプラグイン50、JavaScriptCore VM、bundled plugins、user plugins、domain transform 選択処理を示す。

【図7】トークン削減ベンチ結果。Playwright `page.content()` と ABG `read --as-markdown` 等の出力文字数及び概算トークン数を示す。

## 原稿ファイル

- [figures/fig-1-system-overview.mmd](figures/fig-1-system-overview.mmd)
- [figures/fig-2-consent-lifecycle.mmd](figures/fig-2-consent-lifecycle.mmd)
- [figures/fig-3-auto-revoke-flow.mmd](figures/fig-3-auto-revoke-flow.mmd)
- [figures/fig-4-message-flow.mmd](figures/fig-4-message-flow.mmd)
- [figures/fig-5-cdp-vs-host-perm.mmd](figures/fig-5-cdp-vs-host-perm.mmd)
- [figures/fig-6-plugin-architecture.mmd](figures/fig-6-plugin-architecture.mmd)
- [figures/fig-7-token-economy.mmd](figures/fig-7-token-economy.mmd)

## SVG 生成

Mermaid CLI が利用可能な環境では、次を実行する。

```bash
cd legal/patent/figures
./build.sh
```

SVG 生成後、図中の文字サイズ、符号、線の太さ、余白を確認する。JPO 提出用に画像形式を指定される場合は、SVG から PDF 又は PNG へ変換する。
