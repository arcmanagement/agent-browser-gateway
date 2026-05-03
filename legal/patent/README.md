# ABG 特許出願書類一式

本ディレクトリは、agent-browser-gateway に係る日本国特許出願のための提出前原稿である。提出方針は、Markdown 原稿から Word 文書を生成し、Word で最終整形して印刷し、特許庁へ郵送する書面出願である。提出前に、出願人情報、識別番号、住所、代表者表示、手数料表示、図面、印刷状態を本人が確定する必要がある。

## 書類一覧

- [01-petition.md](01-petition.md): 特許願。様式第26を Markdown で再現した表紙である。
- [02-specification.md](02-specification.md): 明細書。技術分野、背景技術、課題、手段、効果、実施形態、実施例、符号の説明を含む。
- [03-claims.md](03-claims.md): 特許請求の範囲。システム発明15項、方法発明2項、プログラム発明1項の計18項である。
- [04-abstract.md](04-abstract.md): 要約書。400字以内、選択図は図1である。
- [05-drawings.md](05-drawings.md): 図面一覧。9図の説明と提出用変換方針を記載する。
- [figures/](figures/): Mermaid 図面原稿。SVG 生成用の [build.sh](figures/build.sh) を含む。
- [checklist.md](checklist.md): 出願前チェックリスト、自己レビュー記録、進歩性論点メモである。
- [word-print/README.md](word-print/README.md): Word 出力、印刷、郵送提出の作業メモである。
- [scripts/build-paper-docx.py](scripts/build-paper-docx.py): Word 確認用 DOCX を生成する補助スクリプトである。

## 提出手順

1. 識別番号を取得又は確認する。未取得の場合は JPO の手続に従い初回取得する。
2. 特許願の TODO 欄を埋める。特に発明者住所、法人住所、提出日、手数料表示は未確定である。
3. 図1から図9を Mermaid 原稿から提出用画像へ変換し、白黒で印刷して読めることを確認する。
4. Word 確認用 DOCX を生成する。例: `python3 legal/patent/scripts/build-paper-docx.py`。
5. 生成された `legal/patent/out/abg-patent-paper-package.docx` を Word で開き、ページ区切り、段落番号、請求項番号、図番、符号、表の折り返し、余白、文字化けを目視確認する。
6. 特許願、明細書、特許請求の範囲、要約書、図面を片面印刷し、提出順に並べる。
7. 特許出願料14,000円分の特許印紙を特許願に貼付する。2026年5月3日時点で、特許出願料は14,000円である。
8. 特許庁長官宛に郵送する。宛先は `〒100-8915 東京都千代田区霞が関3丁目4番3号 特許庁長官 宛て` を用いる。
9. 書面提出後、登録情報処理機関から届く電子化手数料の払込用紙に従い、期限内に電子化手数料を納付する。
10. 出願番号通知を受領後、README 等の公開可能箇所に「Patent Pending (JP 20XX-XXXXXX)」を追記する。出願完了前には追記しない。

## 手数料メモ

- 出願料: 14,000円。
- 書面出願の電子化手数料: 手続1件につき2,400円 + 書面1枚につき800円。電子化手数料は特許印紙ではなく、後日届く払込用紙に従って納付する。
- 出願審査請求料: 138,000円 + 請求項数 x 4,000円。請求項18項の場合は210,000円である。
- 特許料第1年から第3年まで: 毎年4,300円 + 請求項数 x 300円。請求項18項の場合は毎年9,700円である。
- 減免制度: 中小企業等を対象に審査請求料及び特許料の減免措置が設けられている。ArcManagement 株式会社が対象となるかは、審査請求前に本人確認事項である。

## 新規性喪失例外の留意

出願前に発明を公開しないことを原則とする。ABG リポジトリは出願完了まで private のまま維持する。新規性喪失の例外は例外手続であり、海外出願では不利益となる可能性があるため、出願前公開に依存しない運用を採る。

## PCT 国際出願

日本国内出願日から1年以内に PCT 国際出願を検討できる。米国、欧州、中国等での権利化を検討する場合は、国内出願後の事業進捗、競合状況、費用対効果を見て判断する。

## 拒絶理由通知への応答

出願審査請求後、拒絶理由通知が来た場合は、意見書及び手続補正書で応答する。進歩性の主張では、per-tab 明示許可、origin 変更時の自動失効、loopback only Gateway、WebSocket Origin 検証、CDP による host_permissions 不要化、注釈レイヤによる操作対象の視覚化、ローカル監査ログ、プラグイン変換の組合せによる技術的効果を中核に置く。

## マイルストーン

- 出願日: 日本国特許出願完了。出願番号を本 README に追記する。
- 出願後1年以内: PCT 国際出願の要否を判断する。
- 出願後3年以内: 出願審査請求の要否を判断する。
- 出願公開後: 公開番号及び公開公報の URL を追記する。

## 参照した公式情報

- JPO 産業財産権関係料金一覧: https://www.jpo.go.jp/system/process/tesuryo/hyou.html
- JPO 要約書の概要: https://www.jpo.go.jp/system/patent/shutugan/sakusei/ygaiyo.html
- JPO 明細書への登録商標の記載について: https://www.jpo.go.jp/system/patent/shutugan/sakusei/tourokusyohyo_kisai.html
- JPO 初心者のための電子出願ガイド: https://www.jpo.go.jp/system/process/shutugan/pcinfo/hajimete/index.html
- JPO PC機器等の準備: https://www.jpo.go.jp/system/process/shutugan/pcinfo/preparation/os.html
- JPO 書面提出から電子化までの流れ: https://www.jpo.go.jp/system/process/shutugan/paper/denshikaflow.html
- JPO 書面で手続する場合の電子化手数料について: https://www.jpo.go.jp/system/process/shutugan/paper/denshika.html
- JPO 特許料等の減免制度: https://www.jpo.go.jp/system/process/tesuryo/genmen/genmensochi.html
- JPO 発明の新規性喪失の例外規定: https://www.jpo.go.jp/system/laws/rule/guideline/patent/hatumei_reigai.html
