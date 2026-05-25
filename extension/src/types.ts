// Shared message types between background, popup, and Gateway.

export type AnnotationAction = "start" | "stop" | "clear" | "list" | "add_region" | "add_selector";

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
    }
  | { type: "tab_revoked"; tabId: number; reason: string }
  | { type: "tab_updated"; tabId: number; url: string; title: string; origin: string }
  | { type: "tab_closed"; tabId: number }
  | { type: "response"; id: string; result?: unknown; error?: { code: string; message: string } };

export type GatewayCommand = {
  id: string;
  method: GatewayMethod;
  params?: {
    tabId?: number;
    selector?: string;
    html?: string;
    value?: string;
    label?: string;
    checked?: boolean;
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
    grid?: string;
    urlPattern?: string;
    method?: string;
    statusMin?: number;
    type?: string;
    requestId?: string;
    body?: boolean;
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
    hidden?: boolean;
    sleepMs?: number;
    timeoutMs?: number;
    // screenshot
    clip?: { x: number; y: number; width: number; height: number };
    // read_dom
    asMarkdown?: boolean;
    // annotation_mode
    action?: AnnotationAction;
    comment?: string;
  };
};

export type GatewayMethod =
  | "read_dom"
  | "screenshot"
  | "console"
  | "table"
  | "describe"
  | "network_log"
  | "revoke"
  | "wait_for"
  | "annotation_mode"
  | "click_selector"
  | "click_described"
  | "click_at"
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
  | "drag";

export type OperationMethod = Extract<
  GatewayMethod,
  | "click_selector"
  | "click_described"
  | "click_at"
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
  | "drag"
>;

export type ExtensionSettings = {
  operationsRequireApproval: boolean;
  profileLabel: string;
};

export type ApprovalDecision = "allow" | "deny" | "timeout";

export type ApprovalRequest = {
  id: string;
  method: OperationMethod;
  intent: string;
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
  | { type: "set_profile_label"; value: string }
  | { type: "annotation_action"; tabId: number; action: AnnotationAction };

export type BackgroundToPopup =
  | {
      type: "state";
      permitted: boolean;
      wsConnected: boolean;
      sharedTabs: { tabId: number; title: string; url: string }[];
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
