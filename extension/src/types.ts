// Shared message types between background, popup, and Gateway.

export type AnnotationAction = "start" | "stop" | "clear" | "list" | "add_region" | "add_selector";
export type TabAccessMode = "manual" | "all_tabs";

export type ExtToGateway =
  | {
      type: "hello";
      extensionId: string;
      version: string;
      profileLabel?: string;
      browserKind?: string;
    }
  | {
      type: "tab_permitted";
      tabId: number;
      url: string;
      title: string;
      origin: string;
      expiresAt?: string;
      accessMode?: TabAccessMode;
    }
  | { type: "tab_revoked"; tabId: number; reason: string }
  | {
      type: "tab_updated";
      tabId: number;
      url: string;
      title: string;
      origin: string;
      accessMode?: TabAccessMode;
    }
  | { type: "tab_closed"; tabId: number }
  | { type: "runtime_event"; tabId: number; event: Record<string, unknown> }
  | { type: "record_chunk"; recordingId: string; seq: number; dataBase64: string }
  | {
      type: "record_stopped";
      recordingId: string;
      durationMs: number;
      mime: string;
      micUsed: boolean;
      chunkCount: number;
    }
  | { type: "record_failed"; recordingId: string; error: string }
  | {
      type: "response";
      id: string;
      result?: unknown;
      error?: { code: string; message: string; matchCount?: number };
    }
  | {
      type: "approval_pending";
      approval: {
        approvalId: string;
        method: string;
        intent: string;
        tabId: number;
        origin: string;
        createdAt: number;
        timeoutMs: number;
        scriptPreview?: string;
      };
    }
  | { type: "approval_resolved"; approvalId: string; decision: string; decidedBy: string };

export type GatewayCommand = {
  id: string;
  method: GatewayMethod;
  params?: {
    tabId?: number;
    selector?: string;
    frame?: string;
    html?: string;
    value?: string;
    label?: string;
    checked?: boolean;
    enabled?: boolean;
    replaceEditable?: boolean;
    dryRun?: boolean;
    auditDiff?: boolean;
    auditDiffExcerptChars?: number;
    text?: string;
    url?: string;
    x?: number;
    y?: number;
    id?: number;
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
    all?: boolean;
    limit?: number;
    kind?: string;
    props?: string[];
    name?: string;
    role?: string;
    locator?: string;
    query?: string;
    indexModifier?: string;
    index?: number;
    exact?: boolean;
    ref?: string;
    depth?: number;
    interactiveOnly?: boolean;
    compact?: boolean;
    rules?: string;
    selection?: boolean;
    grid?: string;
    urlPattern?: string;
    method?: string;
    statusMin?: number;
    statusMax?: number;
    type?: string;
    requestId?: string;
    body?: boolean;
    urlRegex?: string;
    fromSelector?: string;
    toSelector?: string;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
    steps?: number;
    // upload_file: canonical `files` (array of absolute paths); `file` accepted
    // as a legacy single-path alias.
    files?: string[];
    file?: string;
    // scroll (mouseWheel)
    deltaX?: number;
    deltaY?: number;
    atX?: number;
    atY?: number;
    key?: string;
    command?: string;
    code?: string;
    modifiers?: string[]; // any of: alt, ctrl, cmd, shift
    mime?: string;
    contentBytes?: number;
    bookmarkId?: string;
    includeFolders?: boolean;
    title?: string;
    parentId?: string;
    approvalId?: string;
    decision?: string;
    decidedBy?: string;
    path?: string;
    hasBeenRead?: boolean;
    // wait_for
    wait?: boolean;
    hidden?: boolean;
    sleepMs?: number;
    timeoutMs?: number;
    loadState?: string;
    predicate?: string;
    // eval_script
    script?: string;
    approve?: boolean;
    maxBytes?: number;
    // screenshot
    clip?: { x: number; y: number; width: number; height: number };
    // read_dom
    asMarkdown?: boolean;
    // annotation_mode
    action?: AnnotationAction | string;
    comment?: string;
    // dialog_action
    promptText?: string;
    // har_export
    outputPath?: string;
    // state_inspect
    includeValues?: boolean;
    storageKey?: string;
    storageKind?: string;
    targetTabId?: number;
    // record
    mic?: boolean;
    recordingId?: string;
    timesliceMs?: number;
  };
};

export type GatewayMethod =
  | "frames"
  | "read_dom"
  | "get_dom"
  | "predicate"
  | "find"
  | "snapshot"
  | "screenshot"
  | "pdf"
  | "console"
  | "table"
  | "describe"
  | "network_log"
  | "har_export"
  | "state_inspect"
  | "framework_inspect"
  | "download_state"
  | "bookmarks_list"
  | "bookmarks_search"
  | "bookmarks_get"
  | "bookmarks_open"
  | "bookmarks_create"
  | "bookmarks_update"
  | "bookmarks_move"
  | "bookmarks_remove"
  | "reading_list_list"
  | "reading_list_search"
  | "reading_list_add"
  | "reading_list_update"
  | "reading_list_remove"
  | "raise_tab"
  | "revoke"
  | "approval_decide"
  | "wait_for"
  | "eval_script"
  | "annotation_mode"
  | "validate_editable"
  | "stream_control"
  | "dialog_state"
  | "dialog_action"
  | "click_selector"
  | "click_described"
  | "click_at"
  | "click_ref"
  | "dblclick_selector"
  | "focus_selector"
  | "hover_selector"
  | "select_option"
  | "set_checked"
  | "fill"
  | "paste"
  | "paste_rich"
  | "clear"
  | "replace_dom"
  | "upload_file"
  | "type_text"
  | "key_press"
  | "key_down"
  | "key_up"
  | "keyboard_insert_text"
  | "exec_command"
  | "navigate"
  | "sandbox_action"
  | "scroll"
  | "scroll_into_view"
  | "drag"
  | "record_start"
  | "record_stop"
  | "record_status";

export type OperationMethod = Extract<
  GatewayMethod,
  | "click_selector"
  | "click_described"
  | "click_at"
  | "click_ref"
  | "dblclick_selector"
  | "focus_selector"
  | "hover_selector"
  | "select_option"
  | "set_checked"
  | "fill"
  | "paste"
  | "paste_rich"
  | "clear"
  | "replace_dom"
  | "upload_file"
  | "type_text"
  | "key_press"
  | "key_down"
  | "key_up"
  | "keyboard_insert_text"
  | "exec_command"
  | "navigate"
  | "scroll"
  | "scroll_into_view"
  | "sandbox_action"
  | "dialog_action"
  | "drag"
>;

export type ExtensionSettings = {
  operationsRequireApproval: boolean;
  evalEnabled: boolean;
  trustedAutomationEnabled: boolean;
  profileLabel: string;
  gatewayWebSocketUrl: string;
  allTabsAccessEnabled: boolean;
  bookmarksAccessEnabled: boolean;
  readingListAccessEnabled: boolean;
  personalDataMutationsEnabled: boolean;
};

export type ApprovalDecision = "allow" | "deny" | "timeout";
export type ApprovalMethod =
  | OperationMethod
  | "eval_script"
  | "record_start"
  | "personal_data_mutation";

export type ApprovalRequest = {
  id: string;
  method: ApprovalMethod;
  intent: string;
  script?: string;
  tab: {
    tabId: number;
    title: string;
    url: string;
  };
  createdAt: number;
  timeoutMs: number;
};

export type PopupToBackground =
  | { type: "get_state"; tabId: number }
  | { type: "permit"; tabId: number }
  | { type: "revoke"; tabId: number }
  | { type: "set_operations_require_approval"; value: boolean }
  | { type: "set_eval_enabled"; value: boolean }
  | { type: "set_trusted_automation_enabled"; value: boolean }
  | { type: "set_profile_label"; value: string }
  | { type: "set_gateway_websocket_url"; value: string }
  | { type: "set_all_tabs_access"; value: boolean }
  | { type: "set_bookmarks_access"; value: boolean }
  | { type: "set_reading_list_access"; value: boolean }
  | { type: "set_personal_data_mutations"; value: boolean }
  | { type: "annotation_action"; tabId: number; action: AnnotationAction };

export type BackgroundToPopup =
  | {
      type: "state";
      permitted: boolean;
      wsConnected: boolean;
      activeTab: {
        incognito: boolean;
        incognitoAccessAllowed: boolean;
      };
      sharedTabs: { tabId: number; title: string; url: string; accessMode: TabAccessMode }[];
      allTabsAccess: {
        permissionGranted: boolean;
        active: boolean;
        shareableTabCount: number;
        skippedTabCount: number;
      };
      personalDataAccess: {
        bookmarks: {
          permissionGranted: boolean;
          active: boolean;
          supported: boolean;
        };
        readingList: {
          permissionGranted: boolean;
          active: boolean;
          supported: boolean;
        };
      };
      settings: ExtensionSettings;
      annotationState: { enabled: boolean; count: number };
    }
  | { type: "ok" }
  | { type: "error"; message: string };

export type ApprovalToBackground =
  | { type: "get_approval_request"; approvalId: string }
  | {
      type: "approval_decision";
      approvalId: string;
      decision: ApprovalDecision;
      // Present only for record_start: the capture stream ID minted inside the
      // "Allow" click so the capture gesture stays live.
      streamId?: string;
      // How the stream ID was minted: tabCapture ("tab", default) or the
      // desktopCapture tab picker ("desktop"), which all-tabs mode falls back to.
      streamSource?: "tab" | "desktop";
    };

export type BackgroundToApproval =
  | { type: "approval_request"; request: ApprovalRequest }
  | { type: "ok" }
  | { type: "error"; message: string };

export type ConsoleEntry = {
  ts: number;
  level: string;
  text: string;
};

// Background <-> offscreen recorder document (chrome.runtime messaging).
export type BackgroundToOffscreen =
  | {
      target: "abg-offscreen";
      cmd: "start";
      recordingId: string;
      streamId: string;
      source?: "tab" | "desktop";
      withMic: boolean;
      timesliceMs?: number;
    }
  | { target: "abg-offscreen"; cmd: "stop"; recordingId: string };

export type OffscreenStartResult = {
  ok: boolean;
  micUsed?: boolean;
  mime?: string;
  error?: string;
};
export type OffscreenStopResult = { ok: boolean; error?: string };

export type OffscreenToBackground =
  | { type: "abg_offscreen_chunk"; recordingId: string; seq: number; dataBase64: string }
  | {
      type: "abg_offscreen_stopped";
      recordingId: string;
      durationMs: number;
      mime: string;
      micUsed: boolean;
      chunkCount: number;
    }
  | { type: "abg_offscreen_error"; recordingId: string; error: string };
