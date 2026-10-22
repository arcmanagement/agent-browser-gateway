// Serialized by scripting.executeScript; keep this function self-contained.
export function showShortcutToastInPage(
  message: string,
  accent: string,
  durationMs: number,
  closeLabel: string,
): void {
  type ToastHost = HTMLDivElement & { dismiss?: () => void };
  const hostId = "__abg_shortcut_toast__";
  (document.getElementById(hostId) as ToastHost | null)?.dismiss?.();
  const host = document.createElement("div") as ToastHost;
  host.id = hostId;
  host.style.cssText =
    "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:auto;";
  const root = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.setAttribute("role", "status");
  box.style.cssText = `position:relative;max-width:min(360px,calc(100vw - 76px));padding:12px 42px 12px 14px;border-radius:12px;border:1px solid #ffffff24;border-left:3px solid ${accent};background:#151819;color:#fff;font:13px/1.5 -apple-system,system-ui,sans-serif;box-shadow:0 8px 32px #0005;`;
  const label = document.createElement("strong");
  label.textContent = "Agent Browser Gateway";
  label.style.cssText = "display:block;margin-bottom:3px;font-size:11px;opacity:.65;";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.title = `${closeLabel} (Esc)`;
  close.setAttribute("aria-label", close.title);
  close.style.cssText =
    "position:absolute;right:6px;top:6px;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:#ccc;font:22px/1 system-ui;cursor:pointer;";
  let escapeHeld = false;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    host.remove();
    clearTimeout(timer);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
  };
  const dismiss = () => {
    host.remove();
    cleanup();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || (!host.isConnected && !escapeHeld)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keydown") {
      escapeHeld = true;
      host.style.display = "none";
      clearTimeout(timer);
      // Retain the guard through keyup so a page cannot react to the same Escape.
      timer = setTimeout(cleanup, 1000);
    } else {
      cleanup();
    }
  };
  host.dismiss = dismiss;
  close.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
  box.append(label, document.createTextNode(message), close);
  root.append(box);
  document.documentElement.append(host);
  const overlay = (
    window as Window & { __abgAnnotationMode?: { enabled: boolean; toolbar: HTMLElement } }
  ).__abgAnnotationMode;
  if (overlay?.enabled) {
    const toolbarRect = overlay.toolbar.getBoundingClientRect();
    const toastRect = host.getBoundingClientRect();
    if (
      toastRect.left < toolbarRect.right &&
      toastRect.right > toolbarRect.left &&
      toastRect.top < toolbarRect.bottom &&
      toastRect.bottom > toolbarRect.top
    ) {
      if (toolbarRect.top >= toastRect.height + 24) {
        host.style.bottom = `${innerHeight - toolbarRect.top + 12}px`;
      } else {
        host.style.bottom = "auto";
        host.style.top = "16px";
      }
    }
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  timer = setTimeout(dismiss, durationMs);
}
