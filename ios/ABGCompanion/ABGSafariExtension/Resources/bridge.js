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
    try {
      port.postMessage({
        type: "heartbeat",
        url: location.href,
        title: document.title || tabRecord.title,
        origin: location.origin,
      });
    } catch {
      scheduleReconnect();
    }
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

  function waitForPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Safari could not decode the captured image."));
      image.src = dataUrl;
    });
  }

  async function captureVisible() {
    const captured = await api.runtime.sendMessage({ type: "capture_visible", tabId: tabRecord.tabId });
    if (!captured?.dataUrl) throw new Error("Safari did not return a screenshot.");
    return captured.dataUrl;
  }

  async function cropScreenshot(dataUrl, clip) {
    const image = await loadImage(dataUrl);
    const scale = image.naturalWidth / innerWidth;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(clip.width * scale));
    canvas.height = Math.max(1, Math.round(clip.height * scale));
    canvas.getContext("2d").drawImage(
      image,
      clip.x * scale,
      clip.y * scale,
      clip.width * scale,
      clip.height * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, clip };
  }

  async function captureFullPage() {
    const original = { x: scrollX, y: scrollY };
    const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const pageHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    const columns = Math.ceil(pageWidth / innerWidth);
    const rows = Math.ceil(pageHeight / innerHeight);
    if (columns * rows > 64) throw Object.assign(new Error("The page needs more than 64 screenshot tiles."), { code: "screenshot_too_large" });
    let canvas;
    let context;
    let scale = 1;
    try {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = Math.min(column * innerWidth, Math.max(0, pageWidth - innerWidth));
          const y = Math.min(row * innerHeight, Math.max(0, pageHeight - innerHeight));
          scrollTo(x, y);
          await waitForPaint();
          const image = await loadImage(await captureVisible());
          if (!canvas) {
            scale = image.naturalWidth / innerWidth;
            canvas = document.createElement("canvas");
            canvas.width = Math.round(pageWidth * scale);
            canvas.height = Math.round(pageHeight * scale);
            if (canvas.width > 16384 || canvas.height > 16384) throw Object.assign(new Error("The full-page image exceeds Safari's 16384 pixel canvas limit."), { code: "screenshot_too_large" });
            context = canvas.getContext("2d");
          }
          const sourceWidth = Math.min(innerWidth, pageWidth - x);
          const sourceHeight = Math.min(innerHeight, pageHeight - y);
          context.drawImage(image, 0, 0, sourceWidth * scale, sourceHeight * scale, x * scale, y * scale, sourceWidth * scale, sourceHeight * scale);
        }
      }
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, fullPage: true, tiles: columns * rows };
    } finally {
      scrollTo(original.x, original.y);
    }
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
      if (request.frame && request.frame !== "@top" && command.method !== "frames") {
        result = await api.runtime.sendMessage({ type: "frame_command", tabId: tabRecord.tabId, frame: request.frame, method: command.method, params: request });
        port?.postMessage({ type: "response", id: command.id, result });
        return;
      }
      switch (command.method) {
        case "screenshot":
          if (request.fullPage === true) result = await captureFullPage();
          else if (request.clip) result = await cropScreenshot(await captureVisible(), request.clip);
          else result = { dataUrl: await captureVisible() };
          break;
        case "frames": result = await api.runtime.sendMessage({ type: "enumerate_frames", tabId: tabRecord.tabId }); break;
        case "state_inspect": {
          result = await pageCommands.handlers.state_inspect(request);
          if ([undefined, "cookies"].includes(request.store)) {
            const cookieResult = await api.runtime.sendMessage({ type: "get_cookies", tabId: tabRecord.tabId, origin: tabRecord.origin });
            if (!cookieResult?.ok) throw Object.assign(new Error(cookieResult?.error?.message || "Safari cookie access failed."), { code: cookieResult?.error?.code || "cookie_access_failed" });
            if (cookieResult.cookies.length > 0 || result.cookies.length === 0) {
              result.cookies = cookieResult.cookies.map((cookie) => ({ ...cookie, value: request.includeValues === true ? cookie.value : cookie.value ? "[redacted]" : "" }));
              result.cookieScope = "extension_with_explicit_site_permission";
            } else {
              result.cookieScope = "script_visible_fallback_with_explicit_site_permission";
            }
          }
          break;
        }
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
    tabRecord = {
      ...message.tab,
      capabilities: {
        trustedAutomationEnabled: false,
        cookieAccessEnabled: false,
        readingListEnabled: false,
        frameAccessOrigins: [],
        ...(message.tab?.capabilities || {}),
      },
    };
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
    if (message?.type === "get_bridge_state") {
      return Promise.resolve({ ok: true, active: Boolean(tabRecord && !stopped), tab: tabRecord });
    }
    if (message?.type === "set_bridge_capabilities") {
      if (!tabRecord || stopped) return Promise.resolve({ ok: false, error: "Tab is not shared." });
      tabRecord = {
        ...tabRecord,
        capabilities: { ...tabRecord.capabilities, ...(message.changes || {}) },
      };
      return Promise.resolve({ ok: true, tab: tabRecord });
    }
    return undefined;
  });

  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", () => { if (tabRecord) { stopped = false; connect(); sendHeartbeat(); } });
  window.addEventListener("focus", () => { if (tabRecord) { stopped = false; connect(); sendHeartbeat(); } });
  window.addEventListener("online", () => { if (tabRecord) { stopped = false; connect(); sendHeartbeat(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && tabRecord) {
      stopped = false;
      connect();
      sendHeartbeat();
    }
  });
})();
