(() => {
  if (globalThis.__abgSafariBridgeInstalled) return;
  globalThis.__abgSafariBridgeInstalled = true;

  const api = globalThis.browser ?? globalThis.chrome;
  let tabRecord = null;
  let port = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let stopped = true;
  const pageCommands = globalThis.__abgSafariPageCommands;

  function sendHeartbeat() {
    if (!tabRecord || !port) return;
    port.postMessage({
      type: "heartbeat",
      url: location.href,
      title: document.title || tabRecord.title,
      origin: location.origin,
    });
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 5000);
  }

  function scheduleReconnect() {
    port = null;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 500);
  }

  function connect() {
    if (stopped || !tabRecord || port) return;
    const candidate = api.runtime.connect({
      name: `abg-tab:${tabRecord.tabId}:${tabRecord.bridgeToken}`,
    });
    port = candidate;
    candidate.onMessage.addListener((message) => {
      if (port !== candidate || message?.type !== "command") return;
      handleCommand(message.command).catch(() => undefined);
    });
    candidate.onDisconnect.addListener(() => {
      if (port === candidate) scheduleReconnect();
    });
    startHeartbeat();
  }

  function readDom(params) {
    const root = params.selector ? document.querySelector(params.selector) : document.documentElement;
    if (!root) return { url: location.href, title: document.title, origin: location.origin, selector: params.selector, found: false, text: "" };
    return {
      url: location.href,
      title: document.title,
      origin: location.origin,
      selector: params.selector || undefined,
      found: params.selector ? true : undefined,
      text: root.innerText ?? root.textContent ?? "",
      html: root.outerHTML,
    };
  }

  function getDom(params) {
    const elements = params.selector ? [...document.querySelectorAll(params.selector)] : [];
    const first = elements[0];
    const base = { kind: params.kind, selector: params.selector, url: location.href, title: document.title };
    if (params.kind === "title") return { ...base, value: document.title };
    if (params.kind === "url") return { ...base, value: location.href };
    if (!params.selector) return { ...base, found: false, error: "selector_required" };
    if (params.kind === "count") return { ...base, value: elements.length };
    if (!first) return { ...base, found: false };
    if (params.kind === "text") return { ...base, found: true, value: (first.innerText ?? first.textContent ?? "").trim() };
    if (params.kind === "html") return { ...base, found: true, value: first.outerHTML };
    if (params.kind === "value") return { ...base, found: true, value: "value" in first ? first.value : first.textContent };
    if (params.kind === "attr") return { ...base, found: true, value: first.getAttribute(params.name || "") };
    if (params.kind === "box") {
      const rect = first.getBoundingClientRect();
      return { ...base, found: true, value: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
    }
    if (params.kind === "styles") {
      const style = getComputedStyle(first);
      return { ...base, found: true, value: Object.fromEntries((params.props || []).map((prop) => [prop, style.getPropertyValue(prop)])) };
    }
    return { ...base, found: true, error: "unsupported_kind" };
  }

  function predicate(params) {
    const element = document.querySelector(params.selector || "");
    if (!element) return { kind: params.kind, selector: params.selector, found: false, value: false };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (params.kind === "visible") return { kind: params.kind, selector: params.selector, found: true, value: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 };
    if (params.kind === "enabled") return { kind: params.kind, selector: params.selector, found: true, value: !("disabled" in element && element.disabled) };
    if (params.kind === "checked") return { kind: params.kind, selector: params.selector, found: true, value: Boolean(element.checked) };
    return { kind: params.kind, selector: params.selector, found: true, value: false, error: "unsupported_kind" };
  }

  function snapshot(params) {
    const root = params.selector ? document.querySelector(params.selector) : document;
    if (!root) return { url: location.href, title: document.title, count: 0, elements: [] };
    const limit = Math.max(1, Math.min(500, params.limit || 200));
    const candidates = [...root.querySelectorAll("a[href],button,input,textarea,select,[role],[contenteditable=true]")];
    const elements = candidates
      .filter((element) => !params.interactiveOnly || element.matches("a[href],button,input,textarea,select,[contenteditable=true]"))
      .slice(0, limit)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const role = element.getAttribute("role") || ({ A: "link", BUTTON: "button", INPUT: "textbox", TEXTAREA: "textbox", SELECT: "combobox" }[element.tagName] || "generic");
        return {
          ref: `@e${index + 1}`,
          role,
          name: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim().slice(0, 200) || "",
          text: element.textContent?.trim().slice(0, 200) || "",
          box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          interactive: element.matches("a[href],button,input,textarea,select,[contenteditable=true]"),
        };
      });
    return { url: location.href, title: document.title, count: elements.length, elements };
  }

  function table(params) {
    const element = document.querySelector(params.selector || "table");
    if (!element) return { found: false, rows: [] };
    const rows = [...element.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => cell.innerText.trim()));
    return { found: true, url: location.href, title: document.title, rows };
  }

  async function handleCommand(command) {
    const request = command.params || {};
    try {
      if (!tabRecord || request.tabId !== tabRecord.tabId || location.origin !== tabRecord.origin) {
        throw Object.assign(new Error("Tab is not shared."), { code: "tab_not_permitted" });
      }
      let result;
      switch (command.method) {
        case "screenshot":
          if (request.clip) throw Object.assign(new Error("Clipped screenshots are not supported on iPhone Safari."), { code: "unsupported_on_safari" });
          result = await api.runtime.sendMessage({ type: "capture_visible", tabId: tabRecord.tabId });
          break;
        case "frames": result = pageCommands.frames(); break;
        case "raise_tab":
          result = await api.runtime.sendMessage({ type: "raise_bridge_tab", tabId: tabRecord.tabId });
          break;
        case "revoke":
          result = await api.runtime.sendMessage({ type: "revoke_bridge_tab", tabId: tabRecord.tabId });
          break;
        default:
          if (pageCommands.handlers[command.method]) result = await pageCommands.handlers[command.method](request);
          else if (pageCommands.unsupportedReasons[command.method]) pageCommands.unsupported(command.method, pageCommands.unsupportedReasons[command.method]);
          else throw Object.assign(new Error(`Unknown command: ${command.method}`), { code: "unknown_method" });
      }
      port?.postMessage({ type: "response", id: command.id, result });
    } catch (error) {
      port?.postMessage({
        type: "response",
        id: command.id,
        error: { code: error.code || "command_failed", message: error.message || String(error), matchCount: error.matchCount },
      });
    }
  }

  function stop() {
    stopped = true;
    clearInterval(heartbeatTimer);
    clearTimeout(reconnectTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
    const current = port;
    port = null;
    current?.disconnect();
  }

  function start(message) {
    stop();
    tabRecord = message.tab;
    if (!tabRecord || location.origin !== tabRecord.origin) {
      throw new Error("The shared tab no longer matches its approved origin.");
    }
    stopped = false;
    pageCommands.setStreamSender((event) => port?.postMessage({ type: "runtime_event", event }));
    connect();
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "start_bridge") {
      try {
        start(message);
        return Promise.resolve({ ok: true });
      } catch (error) {
        return Promise.resolve({ ok: false, error: error.message || String(error) });
      }
    }
    if (message?.type === "stop_bridge") {
      stop();
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  window.addEventListener("pagehide", stop);
})();
