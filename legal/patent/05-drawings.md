# 図面

【書類名】図面

本図面一式は、JPO 提出前に Mermaid から SVG、PNG、又は Word に挿入可能な画像へ変換し、白黒印刷で読める線画として整形する。各図の符号は明細書【符号の説明】と一致させる。

## 図面一覧

【図1】全体構成図。ブラウザ操作連携機能10、Gateway モジュール20、エージェント操作インターフェース30、ブラウザタブ40、プラグイン50、監査記録60、許可管理部70、通信路80、AI エージェント90、注釈レイヤ100を示す。

【図2】共有許可ライフサイクル。非共有、共有許可操作中、共有中、失効の状態遷移を示す。

【図3】取得対象識別情報の変化時の自動失効フロー。ブラウザタブ40、ブラウザ操作連携機能10、許可管理部70、Gateway モジュール20、監査記録60、エージェント操作インターフェース30間の通知順序を示す。

【図4】メッセージフロー。AI エージェント90からブラウザタブ40までの操作要求及び結果返送の経路を示す。

【図5】タブ単位限定アクセス構成と包括的アクセス構成の比較を示す。

【図6】プラグインアーキテクチャ。Gateway モジュール20内のプラグイン50、JavaScriptCore VM、bundled plugins、user plugins、domain transform 選択処理を示す。

【図7】トークン削減ベンチ結果。ページ全体 HTML 取得と ABG `read --as-markdown` 等の出力文字数及び概算トークン数を示す。

【図8】注釈レイヤ統合構成。共有許可済みブラウザタブ40上の注釈レイヤ100、構造要素注釈、視覚領域注釈、テキスト注釈、注釈データ110、及び AI エージェント90への返送フローを示す。

【図9】接続要求セキュリティ強化構成。同一装置内通信の接続要求、発信元検証部120、許可されるブラウザ連携元、拒否される発信元、及び監査記録60のアクセス制限を示す。

## 原稿ファイル

- [figures/fig-1-system-overview.mmd](figures/fig-1-system-overview.mmd)
- [figures/fig-2-consent-lifecycle.mmd](figures/fig-2-consent-lifecycle.mmd)
- [figures/fig-3-auto-revoke-flow.mmd](figures/fig-3-auto-revoke-flow.mmd)
- [figures/fig-4-message-flow.mmd](figures/fig-4-message-flow.mmd)
- [figures/fig-5-limited-tab-access.mmd](figures/fig-5-limited-tab-access.mmd)
- [figures/fig-6-plugin-architecture.mmd](figures/fig-6-plugin-architecture.mmd)
- [figures/fig-7-token-economy.mmd](figures/fig-7-token-economy.mmd)
- [figures/fig-8-annotation-overlay.mmd](figures/fig-8-annotation-overlay.mmd)
- [figures/fig-9-ws-security.mmd](figures/fig-9-ws-security.mmd)

## 画像生成

Mermaid CLI が利用可能な環境では、次を実行する。

```bash
cd legal/patent/figures
./build.sh
```

画像生成後、図中の文字サイズ、符号、線の太さ、余白を確認する。生成された画像を Word に貼り込み、片面印刷後も全図の符号、矢印、文字が読めることを確認する。
