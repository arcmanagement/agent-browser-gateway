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
  | { type: "response"; id: string; result?: unknown; error?: { code: string; message: string } };

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
    text?: string;
    url?: string;
    x?: number;
    y?: number;
    id?: number;
    width?: number;
    height?: number;
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
    file?: string;
    // scroll (mouseWheel)
    deltaX?: number;
    deltaY?: number;
    atX?: number;
    atY?: number;
    key?: string;
    code?: string;
    modifiers?: string[]; // any of: alt, ctrl, cmd, shift
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
  | "download_state"
  | "revoke"
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
  | "clear"
  | "replace_dom"
  | "upload_file"
  | "type_text"
  | "key_press"
  | "key_down"
  | "key_up"
  | "keyboard_insert_text"
  | "navigate"
  | "scroll"
  | "scroll_into_view"
  | "drag";

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
  | "clear"
  | "replace_dom"
  | "upload_file"
  | "type_text"
  | "key_press"
  | "key_down"
  | "key_up"
  | "keyboard_insert_text"
  | "navigate"
  | "scroll"
  | "scroll_into_view"
  | "dialog_action"
  | "drag"
>;

export type ExtensionSettings = {
  operationsRequireApproval: boolean;
  evalEnabled: boolean;
  profileLabel: string;
  allTabsAccessEnabled: boolean;
};

export type ApprovalDecision = "allow" | "deny" | "timeout";
export type ApprovalMethod = OperationMethod | "eval_script";

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
  | { type: "set_profile_label"; value: string }
  | { type: "set_all_tabs_access"; value: boolean }
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
      settings: ExtensionSettings;
      annotationState: { enabled: boolean; count: number };
    }
  | { type: "ok" }
  | { type: "error"; message: string };

export type ApprovalToBackground =
  | { type: "get_approval_request"; approvalId: string }
  | { type: "approval_decision"; approvalId: string; decision: ApprovalDecision };

export type BackgroundToApproval =
  | { type: "approval_request"; request: ApprovalRequest }
  | { type: "ok" }
  | { type: "error"; message: string };

export type ConsoleEntry = {
  ts: number;
  level: string;
  text: string;
};
