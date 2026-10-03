// Japanese UI catalog. The MessageCatalog type requires exactly the English keys.
//
// Terms: タブ, 共有 / 共有解除 (share / revoke), 許可 / 拒否 (allow / deny), 注釈 (annotation),
// エージェント, 承認 (approval), Gateway (kept as is). Sentences use です・ます; buttons are short
// noun or verb phrases.

import type { MessageCatalog } from "../i18n.js";

export const ja: MessageCatalog = {
  // ---- Shared ----
  "common.untitled": "（無題）",
  "common.errorPrefix": "エラー: {message}",

  // ---- Popup ----
  "popup.gateway.checking": "確認中…",
  "popup.gateway.connected": "接続中",
  "popup.gateway.connectedDescription": "Gateway に接続しています",
  "popup.gateway.disconnected": "未接続",
  "popup.gateway.disconnectedDescription": "Gateway に接続していません",
  "popup.tab.none": "（アクティブなタブがありません）",
  "popup.tab.unknownState": "状態を取得できませんでした",
  "popup.tab.allTabsShared": "全タブ共有中",
  "popup.tab.blocked": "ブロック中",
  "popup.tab.shared": "共有中",
  "popup.tab.notShared": "未共有",
  "popup.incognito.title": "シークレット モードでのアクセスがオフです",
  "popup.incognito.body":
    "この拡張機能をシークレット モードで許可するまで、Chrome はシークレット ウィンドウで ABG をブロックします。",
  "popup.incognito.openSettings": "拡張機能の設定を開く",
  "popup.action.share": "このタブをエージェントと共有",
  "popup.action.revoke": "このタブの共有を解除",
  "popup.action.disableAllTabs": "全タブ共有をオフにする",
  "popup.action.enableIncognito": "先にシークレット モードを許可",
  "popup.annotation.start": "このタブに注釈を付ける",
  "popup.annotation.done": "注釈 {count} 件 - 完了",
  "popup.annotation.resume": "注釈 {count} 件 - 再開",
  "popup.annotation.clear": "クリア",
  "popup.annotation.restore": "保存済みの注釈を復元",
  "popup.annotation.restoreCount": "保存済みの注釈 {count} 件を復元",
  "popup.restore.noSaved": "このタブに保存済みの注釈はありません。何も復元していません。",
  "popup.restore.urlMismatch":
    "保存済みの注釈は {savedUrl} のものですが、このタブには {currentUrl} が表示されています。何も復元していません。",
  "popup.restore.anotherPage": "別のページ",
  "popup.restore.differentPage": "別のページ",
  "popup.restore.restored": "注釈を {count} 件復元しました。",
  "popup.restore.partial":
    "{total} 件中 {restored} 件の注釈を復元しました。残りの {unrestored} 件は変更後のページと対応付けられなかったため、表示していません。",
  "popup.restore.noneRestored":
    "保存済みの注釈を変更後のページと対応付けられなかったため（{unrestored} 件を試行）、何も表示していません。",
  "popup.restore.alreadyPresent": "保存済みの注釈はすべてページに表示されています。",
  "popup.shortcut.last": "直前のショートカット: {message}",
  "popup.shortcut.hint":
    "ショートカット: {toggle} でこのタブを共有／共有解除、{copy} でタブ ID をコピーします。変更は {settingsPage} で行えます。",
  "popup.shortcut.notSet": "（未設定）",
  "popup.shortcut.chromeSettingsPage": "chrome://extensions/shortcuts",
  "popup.shortcut.firefoxSettingsPage": "about:addons > 拡張機能のショートカットキーを管理",
  "popup.sharedTabs.heading": "共有中のタブ（{count}）",
  "popup.sharedTabs.allTabs": "全タブ",
  "popup.permissions.heading": "権限",
  "popup.permissions.requireApproval": "書き込み操作に承認を求める",
  "popup.permissions.eval": "承認制の JavaScript eval を有効にする",
  "popup.permissions.trustedAutomation": "信頼済み自動化 / AutoMode",
  "popup.permissions.trustedAutomation.off":
    "オンにすると、共有中のタブでの eval はローカルの承認ポップアップを省略できます。スクリプトは引き続き監査ログに記録されます。",
  "popup.permissions.trustedAutomation.active":
    "AutoMode が有効です。共有中のタブでの eval は承認ポップアップを省略し、引き続き監査ログに記録されます。",
  "popup.permissions.trustedAutomation.evalDisabled":
    "AutoMode は有効ですが、eval のスイッチをオンにするまで eval は使えません。",
  "popup.permissions.allTabs": "全タブ共有モード（サンドボックス専用）",
  "popup.permissions.allTabs.active":
    "サンドボックスモードで {count} 個のタブを共有中です。この隔離プロファイルでは、ブラウザ自体を操作する自動化機能が有効です。",
  "popup.permissions.allTabs.permissionMissing":
    "Chrome の権限がありません。オンにし直して、もう一度許可してください。",
  "popup.permissions.allTabs.default":
    "隔離したサンドボックス用プロファイル専用です。普段使いのプロファイルではオンにしないでください。",
  "popup.permissions.allTabs.notGranted": "全タブ共有の権限が許可されませんでした。",
  "popup.permissions.bookmarks": "ブックマークへのアクセス",
  "popup.permissions.bookmarks.note":
    "ブラウザの個人データ用の個別の権限です。URL はブックマーク用のコマンドでのみ返され、共有タブの状態には含まれません。",
  "popup.permissions.bookmarks.unsupported":
    "このブラウザでは bookmarks 拡張機能 API を利用できません。",
  "popup.permissions.bookmarks.notGranted": "ブックマークの権限が許可されませんでした。",
  "popup.permissions.readingList": "リーディングリストへのアクセス",
  "popup.permissions.readingList.note":
    "リーディングリストに保存した項目を扱う、ブラウザの個人データ用の個別の権限です。",
  "popup.permissions.readingList.unsupported":
    "このブラウザでは chrome.readingList を利用できません。Chrome 120 以降で提供されている API です。",
  "popup.permissions.readingList.notGranted": "リーディングリストの権限が許可されませんでした。",
  "popup.permissions.personalDataMutations": "ブックマークとリーディングリストの変更を許可",
  "popup.permissions.personalDataMutations.note":
    "エージェントが要求するブックマークとリーディングリストの変更を許可します。変更のたびに承認ウィンドウが開き、削除はより強い確認文で表示されます。",
  "popup.advanced.heading": "詳細設定",
  "popup.advanced.language": "表示言語",
  "popup.advanced.language.auto": "自動（ブラウザの言語）",
  "popup.advanced.language.note":
    "このポップアップにはすぐに反映されます。承認ウィンドウ、注釈ツールバー、ショートカットの通知には、次に表示されたときから反映されます。",
  "popup.advanced.profileLabel": "プロファイル名（メニューバーに表示）",
  "popup.advanced.profileLabel.placeholder": "例: personal、work、staging",
  "popup.advanced.gatewayUrl": "Gateway の WebSocket エンドポイント",
  "popup.advanced.gatewayUrl.apply": "適用",
  "popup.advanced.gatewayUrl.note":
    "開発者向け、セルフホスト環境の診断専用です。適用するとすぐに再接続します。",
  "popup.advanced.gatewayUrl.reconnecting": "Gateway に再接続しています…",

  "error.all_tabs_permission_required":
    "このプロファイルでは、ABG にすべてのサイトへのアクセスが許可されていません。",
  "error.bookmarks_permission_required":
    "このプロファイルでは、ABG にブックマークへのアクセスが許可されていません。",
  "error.reading_list_permission_required":
    "このプロファイルでは、ABG にリーディングリストへのアクセスが許可されていません。",
  "error.bookmarks_unsupported": "このブラウザでは chrome.bookmarks API を利用できません。",
  "error.reading_list_unsupported":
    "このブラウザでは chrome.readingList API を利用できません。Chrome 120 以降で提供されている API で、ほかの Chromium 系ブラウザにはない場合があります。",
  "error.tab_not_shared": "このタブは ABG と共有されていません",
  "error.approval_not_found":
    "承認リクエストが見つかりません。期限切れか、すでに処理された可能性があります。",

  // ---- Approval window ----
  "approval.windowTitle": "操作の承認",
  "approval.heading": "この操作を許可しますか？",
  "approval.loading": "読み込み中…",
  "approval.allow": "許可",
  "approval.deny": "拒否",
  "approval.escToDeny": "で拒否",
  "approval.noUrl": "（URL なし）",
  "approval.submitting": "判断を送信しています…",
  "approval.expires": "{seconds} 秒以内に応答がないと拒否されます。",
  "approval.tabPickerNote":
    "「許可」を押すと Chrome のタブ選択画面が開きます。録画するタブを選び、音声の共有をオンにしてください。",
  "approval.tabPickerCancelled": "タブが選択されなかったため、録画は開始していません。",
  "approval.tabCaptureFailed": "タブのキャプチャを開始できませんでした",
  "approval.missingRequest": "承認リクエストが指定されていません。",
  "approval.unavailable": "承認リクエストを取得できませんでした。",
  "approval.loadFailed": "承認リクエストを読み込めませんでした。",

  // ---- Approval intents ----
  "intent.frameSuffix": " (フレーム {frame} 内)",
  "intent.clickSelector": "セレクタ {selector}{frame} に一致する要素をクリックします。",
  "intent.clickAt": "ページ座標 ({x}, {y}) をクリックします。",
  "intent.clickRef": "スナップショット参照 {ref} をクリックします。",
  "intent.clickDescribed": "describe ID {id} の要素をクリックします。",
  "intent.dblclickSelector": "セレクタ {selector}{frame} に一致する要素をダブルクリックします。",
  "intent.focusSelector":
    "セレクタ {selector}{frame} に一致する要素に、クリックせずにフォーカスを移します。",
  "intent.hoverSelector": "セレクタ {selector}{frame} に一致する要素にマウスを重ねます。",
  "intent.selectOption": "{selector}{frame} で選択肢を選びます。",
  "intent.check": "セレクタ {selector}{frame} に一致する入力を、必要ならオンにします。",
  "intent.uncheck": "セレクタ {selector}{frame} に一致する入力を、必要ならオフにします。",
  "intent.fillPreview":
    "セレクタ {selector}{frame} の編集可能な要素について、置き換え結果をプレビューします。",
  "intent.fillAuditDiff":
    "セレクタ {selector}{frame} に一致する編集可能な要素に {bytes} バイトを入力し、マスク済みの監査用差分を記録します。",
  "intent.fill": "セレクタ {selector}{frame} に一致する編集可能な要素に {value} を入力します。",
  "intent.paste":
    "セレクタ {selector}{frame} に一致する編集可能な要素に {bytes} バイトを貼り付けます。",
  "intent.pasteRich": "{payload}を{target}に貼り付けます。",
  "intent.clipboardCurrent": "現在のクリップボードの内容",
  "intent.clipboardMime": "クリップボードの {mime} データ",
  "intent.clipboardMimeBytes": "クリップボードの {mime} データ（{bytes} バイト）",
  "intent.targetSelector": "セレクタ {selector}{frame} に一致する要素",
  "intent.targetFocused": "現在フォーカスされている要素",
  "intent.clear": "セレクタ {selector}{frame} に一致する編集可能な要素の内容を消去します。",
  "intent.replaceDom":
    "セレクタ {selector}{frame} に一致する要素を、指定された HTML で置き換えます。",
  "intent.uploadFile": "{files} をファイル入力 {selector}{frame} に添付します。",
  "intent.localFile": "ローカルファイル {file}",
  "intent.localFiles": "{count} 個のローカルファイル（{file} など）",
  "intent.typeText": "フォーカス中の要素に {text} を入力します。",
  "intent.insertText": "フォーカス中の要素に、キーイベントなしで {bytes} バイトを挿入します。",
  "intent.execCommand":
    "フォーカス中の要素に document.execCommand({command}) を実行します（値 {bytes} バイト）。",
  "intent.keyPress": "{chord} を押します。",
  "intent.keyDown": "{chord} のキーダウンを送信します。",
  "intent.keyUp": "{chord} のキーアップを送信します。",
  "intent.navigate": "このタブで {url} に移動します。",
  "intent.sandboxViewport": "サンドボックスのビューポートを {width}x{height} に設定します。",
  "intent.sandboxViewportMobile":
    "サンドボックスのビューポートを {width}x{height}（モバイル）に設定します。",
  "intent.sandboxViewportClear": "サンドボックスのビューポートのエミュレーションを解除します。",
  "intent.sandboxStorageSet":
    "サンドボックスプロファイルの {kind} のキー {key} に {bytes} バイトの値を設定します。",
  "intent.sandboxStorageDelete":
    "サンドボックスプロファイルの {kind} からキー {key} を削除します。",
  "intent.sandboxTabCreate": "{url} を開く新しいサンドボックスタブを作成します。",
  "intent.sandboxTabClose": "サンドボックスタブ {tabId} を閉じます。",
  "intent.drag": "{from} から {to} までドラッグします{frame}。",
  "intent.dragPointSelector": "セレクタ {selector}",
  "intent.dragPointCoords": "({x}, {y})",
  "intent.scrollIntoView":
    "セレクタ {selector}{frame} に一致する要素が見えるまでスクロールします。",
  "intent.dialogAccept": "{type} ダイアログを OK で閉じます{prompt}: {message}",
  "intent.dialogDismiss": "{type} ダイアログをキャンセルで閉じます{prompt}: {message}",
  "intent.dialogPrompt": "（入力 {bytes} バイト）",
  "intent.scrollElement":
    "セレクタ {selector} に一致する要素を (Δx={dx}, Δy={dy}) スクロールします{frame}。",
  "intent.scrollTab": "このタブを{where}で (Δx={dx}, Δy={dy}) スクロールします。",
  "intent.scrollAtPoint": "位置 ({x}, {y})",
  "intent.scrollAtCenter": "ビューポートの中央",
  "intent.findAction": "{selector}{frame} に対して find アクション {action} を実行します。",
  "intent.eval": "承認制の JavaScript eval を実行します（{bytes} バイト）。",
  "intent.record": "このタブを動画ファイルに録画します。タブの音声も記録します。",
  "intent.recordWithMic":
    "このタブを動画ファイルに録画します。タブの音声に加えて、マイク（周囲の音）も記録します。",
  "intent.personal.idLabel": "ID {id}",
  "intent.personal.bookmarkCreate":
    "ブックマーク {label}{forUrl}{inFolder}を作成します。ブラウザの個人データへの書き込みです。",
  "intent.personal.forUrl": "（{url}）",
  "intent.personal.inFolder": "（フォルダ {parentId} 内）",
  "intent.personal.bookmarkUpdate":
    "ブックマーク {label}（ID {id}）を更新します。ブラウザの個人データへの書き込みです。",
  "intent.personal.bookmarkMove":
    "ブックマーク {label}（ID {id}）を{toFolder}移動します。ブラウザの個人データへの書き込みです。",
  "intent.personal.toFolder": "フォルダ {parentId} へ",
  "intent.personal.bookmarkRemove":
    "【取り消し不可】ブックマーク {label}（ID {id}）を完全に削除します。ブラウザに保存された個人データが消え、ABG では元に戻せません。",
  "intent.personal.readingListAdd":
    "{label} をリーディングリストに追加します。ブラウザの個人データへの書き込みです。",
  "intent.personal.readingListUpdate":
    "リーディングリストの項目 {label} を更新します。ブラウザの個人データへの書き込みです。",
  "intent.personal.readingListRemove":
    "【取り消し不可】リーディングリストの項目 {label} を完全に削除します。ブラウザに保存された個人データが消え、ABG では元に戻せません。",

  // ---- Keyboard shortcut feedback ----
  "shortcut.tab": "タブ {tabId}",
  "shortcut.tabWithTitle": 'タブ {tabId} ("{title}")',
  "shortcut.shared": "{tab} をエージェントと共有しました。",
  "shortcut.revoked":
    "{tab} の共有を解除しました。エージェントはこのタブにアクセスできなくなりました。",
  "shortcut.blocked.noActiveTab":
    "アクティブなタブが見つかりません。ブラウザのタブにフォーカスしてから、もう一度ショートカットを押してください。",
  "shortcut.blocked.allTabsMode":
    "全タブ共有モードがオンのため、タブごとの共有と共有解除は使えません。変更はしていません。タブを個別に管理するには、ポップアップで全タブ共有をオフにしてください。",
  "shortcut.blocked.incognito":
    "Agent Browser Gateway はシークレット モードでのアクセスがオフのため、このタブは共有できません。先に拡張機能の設定で「シークレット モードでの実行を許可する」をオンにしてください。",
  "shortcut.blocked.unsupportedPage":
    "{subject}は共有できません。共有できるのは http、https、file のページだけです。変更はしていません。",
  "shortcut.blocked.schemePages": "{scheme}: のページ",
  "shortcut.blocked.thisPage": "このページ",
  "shortcut.shareFailed": "タブ {tabId} を共有できませんでした: {error}",
  "shortcut.revokeFailed": "タブ {tabId} の共有を解除できませんでした: {error}",
  "shortcut.copiedNotShared":
    "{tab} のタブ ID {tabId} をコピーしました。このタブは共有されていないため、共有するまでエージェントはアクセスできません。",
  "shortcut.copiedShared":
    "{tab} のタブ ID {tabId} をコピーしました。このタブはエージェントと共有中です。",
  "shortcut.copiedSharedAllTabs":
    "{tab} のタブ ID {tabId} をコピーしました。このタブは全タブ共有モードでエージェントと共有中です。",
  "shortcut.copyFailed": "タブ ID {tabId} をコピーできませんでした: {error}",

  // ---- Annotation overlay ----
  "overlay.annotating": "注釈中",
  "overlay.modeGroup": "注釈の対象",
  "overlay.modeArea": "範囲",
  "overlay.modeText": "テキスト",
  "overlay.clear": "クリア",
  "overlay.clearConfirm": "{count} 件をクリア？",
  "overlay.clearConfirmTitle": "もう一度クリックすると、このページの注釈をすべて削除します",
  "overlay.done": "完了",
  "overlay.doneTitle": "注釈を終了（Esc）",
  "overlay.count": "注釈 {count} 件",
  "overlay.hintArea": "ドラッグかクリックで指定",
  "overlay.hintText": "テキストを選択して指定",
  "overlay.hintSelected": "Delete キーで削除",
  "overlay.hintFinish": "Esc で終了",
  "overlay.annotationLabel": "注釈 {number}",
  "overlay.editorPlaceholder": "エージェントへのコメントを入力…",
  "overlay.editorSave": "保存",
  "overlay.editorDelete": "削除",
  "overlay.editorKeysPrimary": "Enter で保存 · Esc でキャンセル",
  "overlay.editorKeysNewline": "Shift+Enter で改行",
  "overlay.doneToastNone": "注釈モードを終了しました",
  "overlay.doneToast": "注釈 {count} 件をエージェントが読み取れます",
};
