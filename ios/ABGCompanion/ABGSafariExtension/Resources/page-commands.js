(() => {
  if (globalThis.__abgSafariPageCommands) return;

  const snapshotRefs = new Map();
  const describedElements = new Map();
  let streamObserver = null;
  let streamSender = null;

  function gatewayError(code, message, matchCount) {
    const error = new Error(message);
    error.code = code;
    if (matchCount !== undefined) error.matchCount = matchCount;
    return error;
  }

  function frameRecords() {
    const records = [{ ref: "@top", win: window, doc: document, url: location.href, title: document.title, accessible: true }];
    let index = 0;
    for (const frame of document.querySelectorAll("iframe,frame")) {
      index += 1;
      try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (!doc || !win) throw new Error("unavailable");
        records.push({ ref: `@f${index}`, win, doc, url: win.location.href, title: doc.title, accessible: true });
      } catch {
        records.push({ ref: `@f${index}`, win: null, doc: null, url: frame.src || "", title: frame.title || "", accessible: false });
      }
    }
    return records;
  }

  function frameContext(params = {}) {
    const ref = params.frame || "@top";
    const record = frameRecords().find((candidate) => candidate.ref === ref);
    if (!record) throw gatewayError("frame_not_found", `Frame ${ref} was not found.`);
    if (!record.accessible) throw gatewayError("frame_not_accessible", `Frame ${ref} is cross-origin and cannot be accessed by Safari.`);
    return record;
  }

  function deepQueryAll(doc, selector) {
    const matches = [];
    const visit = (root) => {
      matches.push(...root.querySelectorAll(selector));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(doc);
    return [...new Set(matches)];
  }

  function queryAll(params, selector = params.selector) {
    if (!selector) return [];
    return deepQueryAll(frameContext(params).doc, selector);
  }

  function uniqueElement(params) {
    if (typeof params.selector !== "string" || !params.selector) throw gatewayError("bad_params", "selector required");
    const matches = queryAll(params);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw gatewayError(
        "ambiguous_selector",
        `selector matched ${matches.length} elements; nothing was changed. Use find first, find last, find nth, a snapshot ref, or a more specific selector.`,
        matches.length,
      );
    }
    return matches[0];
  }

  function textOf(element) {
    return (element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function roleOf(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element.tagName === "A") return "link";
    if (element.tagName === "BUTTON") return "button";
    if (element.tagName === "SELECT") return "combobox";
    if (element.tagName === "TEXTAREA") return "textbox";
    if (element.tagName === "INPUT") {
      if (["checkbox", "radio"].includes(element.type)) return element.type;
      return "textbox";
    }
    return "generic";
  }

  function nameOf(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent || "").join(" ").trim()
      : "";
    return element.getAttribute("aria-label") || labelledText || element.getAttribute("title") || element.getAttribute("alt") || textOf(element).slice(0, 200);
  }

  function boxOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  function visible(element) {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
  }

  function selectorFor(element) {
    const escape = globalThis.CSS?.escape || ((value) => String(value).replace(/["\\]/g, "\\$&"));
    if (element.id) return `#${escape(element.id)}`;
    for (const attr of ["data-testid", "data-test", "name", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value) return `${element.tagName.toLowerCase()}[${attr}="${escape(value)}"]`;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 6) {
      const parent = current.parentElement;
      const tag = current.tagName.toLowerCase();
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
      current = parent;
    }
    return parts.join(" > ");
  }

  function readDom(params) {
    const ctx = frameContext(params);
    const root = params.selector ? uniqueElement(params) : ctx.doc.documentElement;
    if (!root) return { url: ctx.win.location.href, title: ctx.doc.title, selector: params.selector, found: false, text: "" };
    return {
      url: ctx.win.location.href,
      title: ctx.doc.title,
      frame: ctx.ref === "@top" ? undefined : { ref: ctx.ref, url: ctx.url, title: ctx.title },
      selector: params.selector || undefined,
      found: params.selector ? true : undefined,
      text: root.innerText ?? root.textContent ?? "",
      html: root.outerHTML,
    };
  }

  function getDom(params) {
    const ctx = frameContext(params);
    const elements = params.selector ? queryAll(params) : [];
    const first = elements[0];
    const base = { kind: params.kind, selector: params.selector, url: ctx.win.location.href, title: ctx.doc.title };
    if (params.kind === "title") return { ...base, value: ctx.doc.title };
    if (params.kind === "url") return { ...base, value: ctx.win.location.href };
    if (!params.selector) return { ...base, found: false, error: "selector_required" };
    if (params.kind === "count") return { ...base, value: elements.length };
    if (!first) return { ...base, found: false };
    if (params.kind === "text") return { ...base, found: true, value: textOf(first) };
    if (params.kind === "html") return { ...base, found: true, value: first.outerHTML };
    if (params.kind === "value") return { ...base, found: true, value: "value" in first ? first.value : first.textContent };
    if (params.kind === "attr") return { ...base, found: true, value: first.getAttribute(params.name || "") };
    if (params.kind === "box") return { ...base, found: true, value: boxOf(first) };
    if (params.kind === "styles") {
      const style = ctx.win.getComputedStyle(first);
      return { ...base, found: true, value: Object.fromEntries((params.props || []).map((prop) => [prop, style.getPropertyValue(prop)])) };
    }
    return { ...base, found: true, error: "unsupported_kind" };
  }

  function predicate(params) {
    const element = queryAll(params)[0];
    if (!element) return { kind: params.kind, selector: params.selector, found: false, value: false };
    if (params.kind === "visible") return { kind: params.kind, selector: params.selector, found: true, value: visible(element) };
    if (params.kind === "enabled") return { kind: params.kind, selector: params.selector, found: true, value: !("disabled" in element && element.disabled) };
    if (params.kind === "checked") return { kind: params.kind, selector: params.selector, found: true, value: Boolean(element.checked) };
    return { kind: params.kind, selector: params.selector, found: true, value: false, error: "unsupported_kind" };
  }

  function interactiveCandidates(params = {}) {
    const ctx = frameContext(params);
    const root = params.selector ? uniqueElement(params) : ctx.doc;
    if (!root) return [];
    return deepQueryAll(root, "a[href],button,input,textarea,select,summary,[role],[onclick],[tabindex]:not([tabindex='-1']),[contenteditable='true']");
  }

  function snapshot(params) {
    const ctx = frameContext(params);
    const limit = Math.max(1, Math.min(500, params.limit || 200));
    snapshotRefs.clear();
    const elements = interactiveCandidates(params)
      .filter((element) => !params.interactiveOnly || element.matches("a[href],button,input,textarea,select,summary,[contenteditable='true'],[role='button'],[role='link']"))
      .slice(0, limit)
      .map((element, index) => {
        const ref = `@e${index + 1}`;
        snapshotRefs.set(ref, element);
        return { ref, role: roleOf(element), name: nameOf(element), text: textOf(element).slice(0, 200), box: boxOf(element), interactive: true };
      });
    return { url: ctx.win.location.href, title: ctx.doc.title, count: elements.length, elements };
  }

  function describe(params) {
    const ctx = frameContext(params);
    const limit = Math.max(1, Math.min(500, params.limit || 80));
    describedElements.clear();
    const elements = interactiveCandidates(params)
      .filter((element) => params.all === true || visible(element))
      .slice(0, limit)
      .map((element, index) => {
        const id = index + 1;
        describedElements.set(id, element);
        return { id, kind: roleOf(element), selector: selectorFor(element), name: nameOf(element), text: textOf(element).slice(0, 160), box: boxOf(element), visible: visible(element) };
      });
    return { url: ctx.win.location.href, title: ctx.doc.title, viewport: { width: ctx.win.innerWidth, height: ctx.win.innerHeight }, elements };
  }

  function table(params) {
    const ctx = frameContext(params);
    const tables = params.selector ? queryAll(params) : [...ctx.doc.querySelectorAll("table")];
    return {
      url: ctx.win.location.href,
      title: ctx.doc.title,
      selector: params.selector,
      tables: tables.map((element, index) => {
        const rows = [...element.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => textOf(cell)));
        const headers = [...(element.querySelector("thead tr")?.querySelectorAll("th,td") || [])].map((cell) => textOf(cell));
        const dataRows = headers.length > 0 && rows[0]?.join("\0") === headers.join("\0") ? rows.slice(1) : rows;
        return { index, selector: selectorFor(element), headers, rows: dataRows, rowCount: dataRows.length, columnCount: Math.max(headers.length, ...dataRows.map((row) => row.length), 0) };
      }),
    };
  }

  function semanticMatches(params) {
    const locator = params.locator || "text";
    const query = String(params.query || "");
    const exact = params.exact === true;
    const normalized = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const matchesQuery = (value) => exact ? normalized(value) === normalized(query) : normalized(value).toLowerCase().includes(normalized(query).toLowerCase());
    const ctx = frameContext(params);
    const elements = deepQueryAll(ctx.doc, "*").filter((element) => {
      if (locator === "role") return roleOf(element) === params.role && (!query || matchesQuery(nameOf(element)));
      if (locator === "label") {
        const label = element.labels?.[0]?.textContent || (element.id ? ctx.doc.querySelector(`label[for="${element.id}"]`)?.textContent : "");
        return matchesQuery(label);
      }
      if (locator === "placeholder") return matchesQuery(element.getAttribute("placeholder"));
      if (locator === "alt") return matchesQuery(element.getAttribute("alt"));
      if (locator === "title") return matchesQuery(element.getAttribute("title"));
      if (locator === "testid") return matchesQuery(element.getAttribute("data-testid") || element.getAttribute("data-test"));
      return matchesQuery(textOf(element));
    });
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    return elements.slice(0, limit).map((element, index) => ({ index, selector: selectorFor(element), tag: element.tagName.toLowerCase(), role: roleOf(element), text: textOf(element).slice(0, 200), value: "value" in element ? element.value : undefined, box: boxOf(element), element }));
  }

  async function find(params) {
    const all = semanticMatches(params);
    let selected = all;
    if (params.indexModifier === "first") selected = all.slice(0, 1);
    if (params.indexModifier === "last") selected = all.slice(-1);
    if (params.indexModifier === "nth") selected = all.slice(params.index || 0, (params.index || 0) + 1);
    const matches = selected.map(({ element, ...match }) => match);
    const action = params.action || "inspect";
    if (action === "inspect") return { locator: params.locator, query: params.query, role: params.role, exact: params.exact === true, totalCount: all.length, count: matches.length, matches };
    if (!selected[0]) return { ok: false, action, count: 0, matches: [] };
    if (action === "text") return { ok: true, action, match: matches[0], value: matches[0].text };
    const element = selected[0].element;
    let result;
    if (action === "click") result = clickElement(element);
    else if (action === "fill") result = fillElement(element, String(params.value || ""), params.dryRun === true);
    else if (action === "type") { element.focus(); result = typeText({ text: String(params.value || "") }); }
    else if (action === "hover") result = hoverElement(element);
    else if (action === "focus") result = focusElement(element);
    else if (action === "check") result = setCheckedElement(element, true);
    else if (action === "uncheck") result = setCheckedElement(element, false);
    else return { ok: false, error: "unsupported_find_action", action };
    return { action, match: matches[0], result };
  }

  function clickElement(element) {
    if (!element) return { found: false };
    element.click();
    return { found: true, tag: element.tagName };
  }

  function click(params) {
    if (params.ref) return clickElement(snapshotRefs.get(params.ref));
    if (Number.isInteger(params.id)) return clickElement(describedElements.get(params.id));
    if (Number.isFinite(params.x) && Number.isFinite(params.y)) {
      const ctx = frameContext(params);
      const element = ctx.doc.elementFromPoint(params.x, params.y);
      if (!element) return { found: false };
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: ctx.win, clientX: params.x, clientY: params.y, button: 0 }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: ctx.win, clientX: params.x, clientY: params.y, button: 0 }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: ctx.win, clientX: params.x, clientY: params.y, button: 0 }));
      return { ok: true, found: true, tag: element.tagName, x: params.x, y: params.y, synthetic: true };
    }
    return clickElement(uniqueElement(params));
  }

  function dblclick(params) {
    const element = uniqueElement(params);
    if (!element) return { ok: false, found: false, selector: params.selector };
    for (let index = 0; index < 2; index += 1) {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: frameContext(params).win, detail: index + 1 }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: frameContext(params).win, detail: index + 1 }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: frameContext(params).win, detail: index + 1 }));
    }
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: frameContext(params).win, detail: 2 }));
    return { ok: true, found: true, selector: params.selector, ...boxOf(element) };
  }

  function focusElement(element) {
    if (!element) return { ok: false, found: false };
    element.focus({ preventScroll: true });
    return { ok: true, found: true, tag: element.tagName.toLowerCase(), active: element.ownerDocument.activeElement === element };
  }

  function focus(params) { return focusElement(uniqueElement(params)); }

  function hoverElement(element) {
    if (!element) return { ok: false, found: false };
    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith("enter"), cancelable: true, view: element.ownerDocument.defaultView }));
    }
    return { ok: true, found: true, selector: selectorFor(element), ...boxOf(element), synthetic: true };
  }

  function selectOption(params) {
    const element = uniqueElement(params);
    if (!element) return { ok: false, found: false };
    if (!(element instanceof HTMLSelectElement)) return { ok: false, found: true, error: "not_select" };
    const before = [...element.selectedOptions].map((option) => option.value);
    const option = [...element.options].find((candidate) => params.value !== undefined ? candidate.value === params.value : textOf(candidate) === params.label);
    if (!option) return { ok: false, found: true, error: "option_not_found", selectedValues: before };
    for (const candidate of element.options) candidate.selected = candidate === option;
    const after = [...element.selectedOptions].map((candidate) => candidate.value);
    const changed = before.join("\0") !== after.join("\0");
    if (changed) dispatchInputEvents(element, null, "insertReplacementText");
    return { ok: true, found: true, changed, selectedValues: after, selectedLabels: [...element.selectedOptions].map(textOf) };
  }

  function setCheckedElement(element, checked) {
    if (!element) return { ok: false, found: false };
    if (!(element instanceof HTMLInputElement)) return { ok: false, found: true, error: "not_input" };
    if (!["checkbox", "radio"].includes(element.type)) return { ok: false, found: true, type: element.type, error: "not_checkable" };
    const before = element.checked;
    element.checked = checked;
    if (before !== checked) dispatchInputEvents(element, null, "insertReplacementText");
    return { ok: true, found: true, type: element.type, before, after: element.checked, changed: before !== element.checked };
  }

  function setChecked(params) { return setCheckedElement(uniqueElement(params), params.checked === true); }

  function dispatchInputEvents(element, data, inputType) {
    try { element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data, inputType })); } catch {}
    try { element.dispatchEvent(new InputEvent("input", { bubbles: true, data, inputType })); } catch { element.dispatchEvent(new Event("input", { bubbles: true })); }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function editableKind(element) {
    if (element instanceof HTMLInputElement) return "input";
    if (element instanceof HTMLTextAreaElement) return "textarea";
    if (element.isContentEditable) return "contenteditable";
    if (element.getAttribute("role") === "textbox") return "role-textbox";
    return "unsupported";
  }

  function editableText(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent || "";
  }

  function setEditableText(element, value) {
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(element, value) : (element.value = value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(element, value) : (element.value = value);
    } else {
      element.textContent = value;
    }
  }

  function fillElement(element, value, dryRun = false) {
    if (!element) return { ok: false, found: false };
    const kind = editableKind(element);
    const beforeLength = editableText(element).length;
    if (kind === "unsupported") return { ok: false, found: true, kind, replacementLength: value.length };
    if (dryRun) return { ok: true, found: true, kind, dryRun: true, beforeLength, replacementLength: value.length, strategy: "preview" };
    element.focus({ preventScroll: true });
    setEditableText(element, value);
    dispatchInputEvents(element, value, "insertReplacementText");
    return { ok: true, found: true, kind, beforeLength, replacementLength: value.length, afterLength: editableText(element).length, strategy: "native-value-setter" };
  }

  function fill(params) { return fillElement(uniqueElement(params), String(params.value ?? ""), params.dryRun === true); }
  function clear(params) { return fillElement(uniqueElement(params), "", false); }

  function paste(params) {
    const element = uniqueElement(params);
    const value = String(params.value ?? "");
    const result = fillElement(element, value, false);
    if (result.ok) {
      try {
        const data = new DataTransfer();
        data.setData("text/plain", value);
        element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      } catch {}
    }
    return { ...result, pastedBytes: new TextEncoder().encode(value).byteLength };
  }

  function replaceDom(params) {
    const target = uniqueElement(params);
    if (!target) return { found: false, inserted: 0, selector: params.selector };
    const template = target.ownerDocument.createElement("template");
    template.innerHTML = params.html || "";
    const nodes = [...template.content.childNodes];
    target.replaceWith(template.content);
    return { found: true, inserted: nodes.length, selector: params.selector };
  }

  function insertAtSelection(element, text) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      const next = element.value.slice(0, start) + text + element.value.slice(end);
      setEditableText(element, next);
      element.setSelectionRange?.(start + text.length, start + text.length);
      dispatchInputEvents(element, text, "insertText");
      return true;
    }
    if (element?.isContentEditable || element?.getAttribute?.("role") === "textbox") {
      return element.ownerDocument.execCommand("insertText", false, text);
    }
    return false;
  }

  function typeText(params) {
    const active = document.activeElement;
    const text = String(params.text ?? "");
    if (!active || !insertAtSelection(active, text)) throw gatewayError("editable_not_focused", "Focus an editable element before typing.");
    for (const character of text) {
      active.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
      active.dispatchEvent(new KeyboardEvent("keyup", { key: character, bubbles: true }));
    }
    return { ok: true, insertedBytes: new TextEncoder().encode(text).byteLength, synthetic: true };
  }

  function insertText(params) {
    const active = document.activeElement;
    const text = String(params.text ?? "");
    if (!active || !insertAtSelection(active, text)) throw gatewayError("editable_not_focused", "Focus an editable element before inserting text.");
    return { ok: true, insertedBytes: new TextEncoder().encode(text).byteLength };
  }

  function keyEvent(params, type) {
    const target = document.activeElement || document.body;
    const event = new KeyboardEvent(type, { key: params.key || "", code: params.code || "", altKey: params.modifiers?.includes("alt"), ctrlKey: params.modifiers?.includes("ctrl"), metaKey: params.modifiers?.includes("cmd"), shiftKey: params.modifiers?.includes("shift"), bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (type === "keydown" && params.key === "Backspace" && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      const from = start === end ? Math.max(0, start - 1) : start;
      setEditableText(target, target.value.slice(0, from) + target.value.slice(end));
      target.setSelectionRange?.(from, from);
      dispatchInputEvents(target, null, "deleteContentBackward");
    }
    if (type === "keydown" && params.key === "Enter") target.form?.requestSubmit?.();
    return { ok: true, key: params.key || "", code: params.code || "", phase: type === "keydown" ? "down" : "up", synthetic: true };
  }

  function keyPress(params) {
    keyEvent(params, "keydown");
    keyEvent(params, "keyup");
    return { ok: true, key: params.key || "", synthetic: true };
  }

  function execCommand(params) {
    const allowed = new Set(["insertText", "delete", "selectAll", "undo", "redo"]);
    if (!allowed.has(params.command)) throw gatewayError("unsupported_exec_command", `unsupported execCommand: ${params.command || ""}`);
    const value = typeof params.value === "string" ? params.value : undefined;
    const ok = document.execCommand(params.command, false, value);
    return { ok, command: params.command, valueBytes: new TextEncoder().encode(value || "").byteLength, activeElement: document.activeElement?.tagName?.toLowerCase() };
  }

  function navigate(params) {
    if (typeof params.url !== "string" || !params.url) throw gatewayError("bad_params", "url required");
    const target = new URL(params.url, location.href);
    if (!["http:", "https:"].includes(target.protocol)) throw gatewayError("unsupported_url", "Only HTTP and HTTPS navigation is supported.");
    location.assign(target.href);
    return { ok: true, url: target.href };
  }

  function scroll(params) {
    const deltaX = Number(params.deltaX || 0);
    const deltaY = Number(params.deltaY || 0);
    const steps = Math.max(1, Math.min(100, Number(params.steps || 1)));
    if (params.selector) {
      const element = uniqueElement(params);
      if (!element) return { ok: false, found: false, selector: params.selector, deltaX, deltaY, steps };
      const beforeLeft = element.scrollLeft;
      const beforeTop = element.scrollTop;
      for (let index = 0; index < steps; index += 1) element.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
      return { ok: true, found: true, selector: params.selector, deltaX, deltaY, steps, moved: element.scrollLeft !== beforeLeft || element.scrollTop !== beforeTop, movedX: element.scrollLeft - beforeLeft, movedY: element.scrollTop - beforeTop, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
    }
    const beforeX = window.scrollX;
    const beforeY = window.scrollY;
    for (let index = 0; index < steps; index += 1) window.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
    return { ok: true, deltaX, deltaY, steps, x: window.scrollX, y: window.scrollY, movedX: window.scrollX - beforeX, movedY: window.scrollY - beforeY };
  }

  function scrollIntoView(params) {
    const element = uniqueElement(params);
    if (!element) return { ok: false, found: false, selector: params.selector };
    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    return { ok: true, found: true, selector: params.selector, box: boxOf(element), visible: visible(element) };
  }

  function drag(params) {
    const ctx = frameContext(params);
    const from = params.fromSelector ? queryAll({ ...params, selector: params.fromSelector })[0] : ctx.doc.elementFromPoint(params.fromX, params.fromY);
    const to = params.toSelector ? queryAll({ ...params, selector: params.toSelector })[0] : ctx.doc.elementFromPoint(params.toX, params.toY);
    if (!from || !to) return { ok: false, found: false };
    const dataTransfer = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    to.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    to.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    from.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
    return { ok: true, found: true, from: selectorFor(from), to: selectorFor(to), synthetic: true };
  }

  function validateEditable(params) {
    const element = params.selection ? null : queryAll(params)[0];
    const text = params.selection ? String(frameContext(params).win.getSelection()?.toString() || "") : editableText(element);
    if (!params.selection && !element) return { ok: false, found: false, selector: params.selector, issues: [] };
    const issues = [];
    const source = element?.outerHTML || text;
    const quoted = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(['"])/g;
    let match;
    while ((match = quoted.exec(source))) {
      const quote = match[2];
      let index = quoted.lastIndex;
      while (index < source.length && source[index] !== quote && source[index] !== "\n" && source[index] !== ">") index += 1;
      if (source[index] !== quote) issues.push({ ruleId: "html-attrs/unbalanced-quote", severity: "error", offset: match.index, message: `Attribute ${match[1]} has no matching quote.` });
    }
    return { ok: issues.length === 0, found: true, selector: params.selector, source: params.selection ? "selection" : editableKind(element), rules: String(params.rules || "html-attrs,shortcodes").split(","), issueCount: issues.length, errorCount: issues.length, textLength: text.length, issues };
  }

  function stateInspect(params) {
    const redact = (value) => params.includeValues === true ? value : value ? "[redacted]" : value;
    const storage = (store) => Object.fromEntries([...Array(store.length).keys()].map((index) => { const key = store.key(index); return [key, redact(store.getItem(key))]; }));
    const cookies = document.cookie ? document.cookie.split(/;\s*/).map((part) => { const index = part.indexOf("="); return { name: index < 0 ? part : part.slice(0, index), value: redact(index < 0 ? "" : part.slice(index + 1)) }; }) : [];
    return { ok: true, url: location.href, origin: location.origin, includeValues: params.includeValues === true, cookies, cookieScope: "script_visible_only", localStorage: storage(localStorage), sessionStorage: storage(sessionStorage) };
  }

  function frameworkInspect() {
    const root = document.documentElement;
    const react = Object.keys(root).some((key) => key.startsWith("__react") || key.startsWith("_reactRootContainer"));
    const navigation = performance.getEntriesByType("navigation")[0];
    return { ok: true, url: location.href, title: document.title, frameworks: { react: { detected: react } }, webVitals: navigation ? { domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd } : {}, executionWorld: "extension_isolated" };
  }

  function evalScript(params) {
    const script = String(params.script || "");
    if (!script.trim()) throw gatewayError("bad_params", "script required");
    const maxBytes = Math.max(1, Math.min(256 * 1024, Number(params.maxBytes || 64 * 1024)));
    return Promise.resolve((0, eval)(script)).then((value) => {
      const json = JSON.stringify(value === undefined ? { __abgType: "undefined" } : value);
      const jsonBytes = new TextEncoder().encode(json).byteLength;
      const summary = { type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, jsonBytes, maxBytes, truncated: jsonBytes > maxBytes };
      if (jsonBytes > maxBytes) return { ok: false, error: "result_too_large", resultSummary: summary, executionWorld: "extension_isolated" };
      return { ok: true, value: JSON.parse(json), resultSummary: summary, executionWorld: "extension_isolated" };
    }).catch((error) => ({ ok: false, error: "eval_failed", message: error.message || String(error), resultSummary: { type: "error", jsonBytes: 0, maxBytes, truncated: false }, executionWorld: "extension_isolated" }));
  }

  async function waitFor(params) {
    if (Number.isFinite(params.sleepMs)) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, params.sleepMs)));
      return { ok: true, mode: "sleep", ms: params.sleepMs };
    }
    const timeoutMs = Number.isFinite(params.timeoutMs) ? params.timeoutMs : 10000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let matched = false;
      let mode = "selector";
      if (typeof params.text === "string") { mode = "text"; matched = (frameContext(params).doc.body?.innerText || "").includes(params.text); }
      else if (typeof params.urlPattern === "string") { mode = "url"; const regex = new RegExp(`^${params.urlPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i"); matched = regex.test(frameContext(params).win.location.href); }
      else if (typeof params.loadState === "string") { mode = "load"; matched = params.loadState === "domcontentloaded" ? document.readyState !== "loading" : document.readyState === "complete"; }
      else if (typeof params.predicate === "string") { mode = "predicate"; try { matched = Boolean((0, eval)(params.predicate)); } catch { matched = false; } }
      else if (typeof params.selector === "string") { const element = queryAll(params)[0]; matched = params.hidden === true ? !element || !visible(element) : Boolean(element && visible(element)); }
      else throw gatewayError("bad_params", "wait_for needs selector, text, urlPattern, loadState, predicate, or sleepMs");
      if (matched) return { ok: true, mode, elapsedMs: Date.now() - start, selector: params.selector, found: params.selector ? true : undefined };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { ok: false, error: "timeout", timeoutMs };
  }

  function streamControl(params) {
    const enabled = params.enabled === true;
    streamObserver?.disconnect();
    streamObserver = null;
    if (enabled) {
      streamObserver = new MutationObserver((records) => streamSender?.({ kind: "dom_mutation", count: records.length, url: location.href, title: document.title }));
      streamObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    return { ok: true, enabled };
  }

  function unsupported(method, reason) {
    throw gatewayError("unsupported_on_safari", `${method} is unavailable on iPhone Safari: ${reason}`);
  }

  const handlers = {
    read_dom: readDom,
    get_dom: getDom,
    predicate,
    find,
    snapshot,
    table,
    describe,
    state_inspect: stateInspect,
    framework_inspect: frameworkInspect,
    wait_for: waitFor,
    eval_script: evalScript,
    validate_editable: validateEditable,
    stream_control: streamControl,
    click_selector: click,
    click_ref: click,
    click_described: click,
    click_at: click,
    dblclick_selector: dblclick,
    focus_selector: focus,
    hover_selector: (params) => hoverElement(uniqueElement(params)),
    select_option: selectOption,
    set_checked: setChecked,
    fill,
    paste,
    clear,
    replace_dom: replaceDom,
    type_text: typeText,
    key_press: keyPress,
    key_down: (params) => keyEvent(params, "keydown"),
    key_up: (params) => keyEvent(params, "keyup"),
    keyboard_insert_text: insertText,
    exec_command: execCommand,
    navigate,
    scroll,
    scroll_into_view: scrollIntoView,
    drag,
  };

  const unsupportedReasons = {
    pdf: "Safari Web Extensions do not expose page PDF generation",
    console: "Safari Web Extensions do not expose the page console stream",
    network_log: "iOS Safari does not expose webRequest or a debugger network domain",
    har_export: "iOS Safari does not expose the request data needed for HAR export",
    download_state: "iOS Safari does not expose download metadata to Web Extensions",
    bookmarks_list: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_search: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_get: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_open: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_create: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_update: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_move: "Safari does not expose browser bookmarks to this Web Extension",
    bookmarks_remove: "Safari does not expose browser bookmarks to this Web Extension",
    reading_list_list: "Safari does not expose Reading List to this Web Extension",
    reading_list_search: "Safari does not expose Reading List to this Web Extension",
    reading_list_add: "Safari does not expose Reading List to this Web Extension",
    reading_list_update: "Safari does not expose Reading List to this Web Extension",
    reading_list_remove: "Safari does not expose Reading List to this Web Extension",
    paste_rich: "the Mac clipboard cannot be transferred into iPhone Safari",
    upload_file: "Mac file paths are not available to iPhone Safari",
    sandbox_action: "iOS Safari has no isolated all-tabs browser profile",
    dialog_state: "Safari Web Extensions do not expose JavaScript dialog state",
    dialog_action: "Safari Web Extensions cannot accept or dismiss page dialogs",
    annotation_mode: "the Chrome annotation overlay has not been ported to touch input",
    record_start: "Safari Web Extensions do not expose tab video capture",
    record_stop: "Safari Web Extensions do not expose tab video capture",
    record_status: "Safari Web Extensions do not expose tab video capture",
  };

  globalThis.__abgSafariPageCommands = {
    handlers,
    unsupportedReasons,
    frames: () => ({ url: location.href, title: document.title, count: frameRecords().length, frames: frameRecords().map(({ ref, url, title, accessible }) => ({ ref, url, title, accessible })) }),
    setStreamSender(sender) { streamSender = sender; },
    unsupported,
  };
})();
