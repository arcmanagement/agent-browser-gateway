# Word 目視確認メモ

本ディレクトリは、Markdown 原稿を Word 文書に出力し、オンライン出願前の目視確認を行うための作業メモである。source of truth は `legal/patent/` 直下の Markdown である。特許庁への提出は、オンライン出願用 HTML と PNG をインターネット出願ソフトで変換した送信ファイルにより行う。

## 方針

1. `01-petition.md`、`02-specification.md`、`03-claims.md`、`04-abstract.md`、`05-drawings.md` を Word 確認用 DOCX へ変換する。
2. Word で、書類名、見出し、段落番号、請求項番号、図番、符号、表、余白、ページ区切りを目視確認する。
3. 図面は `figures/*.mmd` から画像化し、Word 上ではプレビュー用として確認する。
4. 正式提出用には `scripts/build-online-application.py` が生成する Shift_JIS HTML と PNG を使用する。

## DOCX 生成

```bash
python3 legal/patent/scripts/build-paper-docx.py
```

生成先は `legal/patent/out/abg-patent-word-check-package.docx` である。同時に確認用 HTML も `legal/patent/out/abg-patent-word-check-package.html` に出力される。

`mmdc` が利用可能な環境では、DOCX 生成時に `figures/build.sh` が自動実行され、生成済みの SVG を図面プレビューとして DOCX に含める。`mmdc` がない場合でも、HTML では Mermaid.js により図面プレビューをブラウザ内で描画し、DOCX では Mermaid 原稿を確認用 fallback として含める。

## Word での最終確認

- TODO 欄に識別番号、提出日を記入したか。
- 各書類の先頭が新しいページから始まっているか。
- 明細書の段落番号が欠番又は重複していないか。
- 請求項1から10までが連続しているか。
- 要約書が400字以内で、選択図が図1であるか。
- 図1から図9までがオンライン出願用 PNG として読めるか。
- 明細書【符号の説明】と図中符号が一致しているか。
- 登録商標に該当し得る固有名が、やむを得ない引用以外で本文に残っていないか。
- オンライン出願用 HTML で書類順が崩れていないか。

## 提出ルートとの関係

この DOCX は提出物ではない。スーパー早期審査を狙うため、特許願、出願審査請求書、早期審査に関する事情説明書はオンライン手続で提出する。
