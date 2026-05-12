# ABG 特許出願書類一式

本ディレクトリは、agent-browser-gateway に係る日本国特許出願のための提出前原稿である。現在の提出方針は、Markdown 原稿からオンライン出願用 HTML と図面 PNG を生成し、インターネット出願ソフトで入力チェック及び特許庁フォーマット変換を行ってオンライン出願することである。Word 文書生成はローカル目視確認用であり、特許庁への提出ルートはオンラインに限定する。提出前に、法人の電子証明書、出願人情報、識別番号、代表者表示、手数料表示、図面、及びインターネット出願ソフトでの変換結果を本人が確定する必要がある。

## 書類一覧

- [01-petition.md](01-petition.md): 特許願。様式第26を Markdown で再現した表紙である。
- [02-specification.md](02-specification.md): 明細書。技術分野、背景技術、課題、手段、効果、実施形態、実施例、符号の説明を含む。
- [03-claims.md](03-claims.md): 特許請求の範囲。システム発明8項、方法発明1項、プログラム発明1項の計10項である。
- [04-abstract.md](04-abstract.md): 要約書。400字以内、選択図は図1である。
- [05-drawings.md](05-drawings.md): 図面一覧。9図の説明と提出用変換方針を記載する。
- [06-examination-request-reduced.md](06-examination-request-reduced.md): 出願番号取得後にオンライン提出する、1/3減免前提の出願審査請求書原稿である。
- [07-super-early-examination-statement.md](07-super-early-examination-statement.md): スーパー早期審査申請用の早期審査に関する事情説明書原稿である。
- [figures/](figures/): Mermaid 図面原稿。SVG 生成用の [build.sh](figures/build.sh) を含む。
- [checklist.md](checklist.md): 出願前チェックリスト、自己レビュー記録、進歩性論点メモである。
- [word-print/README.md](word-print/README.md): Word 出力による目視確認メモである。
- [scripts/build-online-application.py](scripts/build-online-application.py): オンライン出願用の Shift_JIS HTML と図面 PNG を生成する補助スクリプトである。
- [scripts/build-paper-docx.py](scripts/build-paper-docx.py): Word 確認用 DOCX を生成する補助スクリプトである。

## オンライン提出手順

1. 法人の商業登記電子証明書を取得し、Windows 環境のインターネット出願ソフトで申請人利用登録を行う。
2. 識別番号を取得又は確認する。未取得の場合は JPO の手続に従い初回取得する。
3. 特許願の出願人、発明者、識別番号、代表者、手数料表示を確認する。
4. オンライン出願用 HTML と図面 PNG を生成する。例: `python3 legal/patent/scripts/build-online-application.py`。
5. 生成された `legal/patent/out/online/abg-patent-online-application.html` と `legal/patent/out/online/figures/` を同じフォルダ構成のまま Windows 環境へ配置する。
6. インターネット出願ソフトで HTML を入力し、入力チェック及び特許庁フォーマット変換を行う。エラーが出た場合は Markdown 原稿又は生成スクリプトを修正して再生成する。
7. 送信ファイルをプレビューし、図面、符号、請求項番号、文字化け、出願人情報、手数料表示を確認する。
8. オンライン出願を行い、受領書で出願番号を確認する。
9. 出願番号通知を受領後、README 等の公開可能箇所に「Patent Pending (JP 20XX-XXXXXX)」を追記する。出願完了前には追記しない。

## Word 目視確認

Word 確認用 DOCX は `python3 legal/patent/scripts/build-paper-docx.py` で生成できる。`legal/patent/out/abg-patent-word-check-package.docx` を Word で開き、ページ区切り、段落番号、請求項番号、図番、符号、表の折り返し、余白、文字化けを目視確認する。この DOCX は提出物ではなく、正式提出はオンライン出願用 HTML と図面 PNG をインターネット出願ソフトで変換した送信ファイルにより行う。

## スーパー早期審査前提

スーパー早期審査を狙うため、特許庁に対する本件関連手続はオンラインで行う。特許願の出願後、出願番号を確認したうえで、出願審査請求書を1/3減免の特記事項付きでオンライン提出し、続けて早期審査に関する事情説明書をオンライン提出する。

スーパー早期審査の事情説明書では、少なくとも次の事項を確定する。

- 「早期審査の種別」を「スーパー早期審査」とする。
- 冒頭に「スタートアップ対応スーパー早期審査を希望する。」と記載する。
- ＡｒｃＭａｎａｇｅｍｅｎｔ株式会社がスタートアップ要件を満たすことを、設立日、資本金又は従業員数、大企業支配がないことにより説明する。
- ABG が実施関連出願であることを、実施中又は2年以内の実施予定として具体的に説明する。
- 出願人が知っている先行技術文献と本願発明との対比説明を記載する。
- スーパー早期審査申請前4週間以降の本件関連手続がオンライン手続であることを確認する。

## 手数料メモ

- 出願料: 14,000円。
- 出願料14,000円は、インターネット出願ソフトで選択する納付方法に従って納付する。
- 出願審査請求料: 138,000円 + 請求項数 x 4,000円。請求項10項の場合は178,000円である。
- 1/3減免後の出願審査請求料: 請求項10項の場合は59,330円である。出願審査請求書には「特許法施行令第10条第5号ロに掲げる者に該当する請求人である。減免申請書の提出を省略する。」を記載する。
- 特許料第1年から第3年まで: 毎年4,300円 + 請求項数 x 300円。請求項10項の場合は毎年7,300円である。
- 減免制度: 中小スタートアップ企業等を対象に審査請求料及び特許料の減免措置が設けられている。ＡｒｃＭａｎａｇｅｍｅｎｔ株式会社が対象となるかは、審査請求前に本人確認事項である。

## 新規性喪失例外の留意

出願前に発明を公開しないことを原則とする。ABG リポジトリは出願完了まで private のまま維持する。新規性喪失の例外は例外手続であり、海外出願では不利益となる可能性があるため、出願前公開に依存しない運用を採る。

## PCT 国際出願

日本国内出願日から1年以内に PCT 国際出願を検討できる。米国、欧州、中国等での権利化を検討する場合は、国内出願後の事業進捗、競合状況、費用対効果を見て判断する。

## 拒絶理由通知への応答

出願審査請求後、拒絶理由通知が来た場合は、意見書及び手続補正書で応答する。進歩性の主張では、タブ単位の明示的な共有許可、取得対象識別情報の変化時の自動失効、Gateway の配置非依存性、通信方式非限定性、接続要求の発信元検証、ブラウザ制御機構又は外部操作連携部及び範囲限定権限による包括的アクセス不要化、注釈レイヤによる操作対象の視覚化、監査記録、変換処理の組合せによる技術的効果を中核に置く。

## マイルストーン

- 出願日: 日本国特許出願完了。出願番号を本 README に追記する。
- 出願直後: 1/3減免付き出願審査請求書をオンライン提出する。
- 出願直後: 早期審査に関する事情説明書をオンライン提出し、スーパー早期審査を申請する。
- 出願後1年以内: PCT 国際出願の要否を判断する。
- 出願公開後: 公開番号及び公開公報の URL を追記する。

## 参照した公式情報

- JPO 産業財産権関係料金一覧: https://www.jpo.go.jp/system/process/tesuryo/hyou.html
- JPO 要約書の概要: https://www.jpo.go.jp/system/patent/shutugan/sakusei/ygaiyo.html
- JPO 明細書への登録商標の記載について: https://www.jpo.go.jp/system/patent/shutugan/sakusei/tourokusyohyo_kisai.html
- JPO 初心者のための電子出願ガイド: https://www.jpo.go.jp/system/process/shutugan/pcinfo/hajimete/index.html
- JPO PC機器等の準備: https://www.jpo.go.jp/system/process/shutugan/pcinfo/preparation/os.html
- JPO 電子証明書の取得: https://www.jpo.go.jp/system/process/shutugan/pcinfo/preparation/purchase/index.html
- JPO インターネット出願の概要: https://www.jpo.go.jp/system/process/shutugan/pcinfo/outline/procedure/appl.html
- JPO スーパー早期審査について: https://www.jpo.go.jp/system/patent/shinsa/soki/super_souki.html
- JPO 特許審査に関するスタートアップ支援策: https://www.jpo.go.jp/system/patent/shinsa/soki/patent-venture-shien.html
- JPO 中小スタートアップ企業を対象とした減免措置: https://www.jpo.go.jp/system/process/tesuryo/genmen/genmen20190401/02_04.html
- JPO 出願審査請求書の書き方ガイド: https://www.pcinfo.jpo.go.jp/guide/Content/Guide/Patent/ShinsaSeikyu/doc/P_ShinsaSeikyu.htm
- JPO 早期審査に関する事情説明書の書き方ガイド: https://www.pcinfo.jpo.go.jp/guide/Content/Guide/Patent/SokiShinsa/doc/P_SokiJijoSetusmeiSho.htm
- JPO 特許料等の減免制度: https://www.jpo.go.jp/system/process/tesuryo/genmen/genmensochi.html
- JPO 発明の新規性喪失の例外規定: https://www.jpo.go.jp/system/laws/rule/guideline/patent/hatumei_reigai.html
