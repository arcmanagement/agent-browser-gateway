# JPO 電子出願ソフト用テキスト変換メモ

本ディレクトリは、Markdown 原稿を JPO インターネット出願ソフトに投入するための中間テキスト置き場である。現時点では原稿の source of truth は `legal/patent/` 直下の Markdown である。

## 変換方針

1. `01-petition.md`、`02-specification.md`、`03-claims.md`、`04-abstract.md`、`05-drawings.md` を JPO 指定の HTML 又は XML 形式へ変換する。
2. Markdown の見出し記号、コードフェンス、表記ゆれを JPO 形式に合わせて除去又は置換する。
3. 図面は `figures/*.mmd` から SVG 又は PDF を生成し、JPO 提出可能な形式へ変換する。
4. 変換後のファイルは、インターネット出願ソフトの入力チェックに通したうえで、差分を Markdown 原稿へフィードバックする。

## 未実施事項

- [ ] JPO HTML テンプレートを確定する。
- [ ] Markdown から JPO HTML への変換スクリプトを作成する。
- [ ] 変換後ファイルの文字化け、段落番号、図番、符号を確認する。
