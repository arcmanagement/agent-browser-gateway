// Store-asset capture only (not shipped): a chrome.* stub so the built popup.html and
// approval.html render outside an extension with fictional sample data.
// render.mjs injects window.__ABG_SCENARIO and window.__ABG_LANG before this script.
(() => {
  const scenario = window.__ABG_SCENARIO || "shared";
  const lang = window.__ABG_LANG || "en";
  const is = (name) => scenario === name;

  const checkout = {
    tabId: 1043,
    title: "Acme Outdoor — Checkout",
    url: "https://shop.example.com/checkout",
    accessMode: "manual",
  };
  const sharedTabs = is("not-shared") ? [] : [checkout];
  const settings = {
    allTabsAccessEnabled: false,
    evalEnabled: false,
    operationsRequireApproval: true,
    profileLabel: "",
    gatewayWebSocketUrl: "ws://127.0.0.1:8765/ws",
    trustedAutomationEnabled: false,
    bookmarksAccessEnabled: false,
    readingListAccessEnabled: false,
    personalDataMutationsEnabled: false,
    uiLanguage: lang,
  };
  const state = {
    type: "state",
    permitted: !is("not-shared"),
    wsConnected: true,
    activeTab: { incognito: false, incognitoAccessAllowed: true },
    sharedTabs,
    allTabsAccess: {
      permissionGranted: false,
      active: false,
      shareableTabCount: 4,
      skippedTabCount: 0,
    },
    personalDataAccess: {
      bookmarks: { permissionGranted: false, active: false, supported: true },
      readingList: { permissionGranted: false, active: false, supported: true },
    },
    settings,
    annotationState: {
      enabled: false,
      count: 0,
      restorableCount: is("restore") ? 3 : 0,
    },
  };
  const approvalRequest = {
    id: "req-1",
    method: "click",
    intent: 'Click the element matching selector "button#pay".',
    intentText: { key: "intent.clickSelector", params: { selector: '"button#pay"', frame: "" } },
    tab: {
      tabId: 1043,
      title: "Acme Outdoor — Checkout",
      url: "https://shop.example.com/checkout?step=2",
    },
    createdAt: Date.now() - 1500,
    timeoutMs: 600000,
  };

  const noop = () => {};
  const event = {
    addListener: noop,
    removeListener: noop,
    hasListener: () => false,
    hasListeners: () => false,
  };
  window.chrome = {
    i18n: { getUILanguage: () => (lang === "ja" ? "ja" : "en-US") },
    storage: {
      local: { get: async () => ({ uiLanguage: lang }), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
    runtime: {
      id: "storeassets",
      getURL: (p) => p,
      onMessage: event,
      sendMessage: async (msg) => {
        if (msg.type === "get_state") return state;
        if (msg.type === "get_approval_request")
          return { type: "approval_request", request: approvalRequest };
        return { type: "ok" };
      },
    },
    tabs: {
      query: async () => [{ id: 1043, title: checkout.title, url: checkout.url }],
      create: async () => ({}),
    },
    windows: {
      WINDOW_ID_CURRENT: -2,
      // The approval window sizes itself to its content; render.mjs applies this height.
      update: async (_id, info) => {
        window.__fitHeight = info.height;
        return {};
      },
    },
    permissions: {
      request: async () => true,
      remove: async () => true,
      contains: async () => true,
    },
    tabCapture: { getMediaStreamId: noop },
    commands: {
      getAll: async () => [
        { name: "toggle-share-current-tab", shortcut: "⌥⇧S" },
        { name: "copy-current-tab-id", shortcut: "⌥⇧C" },
      ],
    },
  };
})();
