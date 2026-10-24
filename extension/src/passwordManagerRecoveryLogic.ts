export type ExtensionFrameRecovery = {
  via: "scripting";
  strategy: "escape" | "focus-away" | "dismiss-1password-ui" | "debugger-reconnect";
  focusChanged: boolean;
  dismissedHosts?: string[];
};

export function isExtensionFrameAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot access a chrome-extension:// URL");
}

function isDebuggerNotAttachedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Debugger is not attached to the tab with id:");
}

export function canRecoverEscape(
  key: string,
  code: string | undefined,
  modifiers: string[],
  error: unknown,
): boolean {
  return (
    key === "Escape" &&
    (code === undefined || code === "Escape") &&
    modifiers.length === 0 &&
    isExtensionFrameAccessError(error)
  );
}

/** Self-contained function serialized by Chrome into ABG's isolated world. */
export function dismissExtensionMenuPageFn(
  strategy: "escape" | "focus-away" | "dismiss-1password-ui",
): { attempted: boolean; focusChanged: boolean; dismissedHosts?: string[] } {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (strategy === "escape") {
    for (const type of ["keydown", "keyup"]) {
      (active ?? document).dispatchEvent(
        new KeyboardEvent(type, {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    }
    return { attempted: true, focusChanged: false };
  }
  if (strategy === "dismiss-1password-ui") {
    // Dismiss page-mounted menus/notifications only. No access to closed shadow
    // roots or extension iframe contents. The USO host is the dismissible
    // page-top sign-in suggestion banner. Leave buttons and auth modals.
    const hosts = [
      ...document.querySelectorAll(
        "com-1password-menu,com-1password-notification,com-1password-uso",
      ),
    ];
    const dismissedHosts = hosts.map((host) => host.tagName.toLowerCase());
    for (const host of hosts) host.remove();
    return { attempted: hosts.length > 0, focusChanged: false, dismissedHosts };
  }
  const body = document.body;
  if (!body) return { attempted: false, focusChanged: false };
  // 1Password observes focusin on a different target rather than blur alone.
  const originalTabIndex = body.getAttribute("tabindex");
  try {
    body.setAttribute("tabindex", "-1");
    body.focus({ preventScroll: true });
  } finally {
    if (originalTabIndex === null) body.removeAttribute("tabindex");
    else body.setAttribute("tabindex", originalTabIndex);
  }
  return { attempted: true, focusChanged: active !== body };
}

export async function recoverExtensionFrame(
  deps: {
    isPermitted: () => boolean;
    scripting: Pick<typeof chrome.scripting, "executeScript">;
    probe: () => Promise<void>;
    wait?: (milliseconds: number) => Promise<void>;
    resetDebugger?: () => Promise<void>;
  },
  tabId: number,
): Promise<ExtensionFrameRecovery> {
  const requireSharedTab = () => {
    if (!deps.isPermitted()) throw new Error("tab not permitted");
  };
  let focusChanged = false;
  const attempts: string[] = [];
  const dismissedHosts: string[] = [];
  for (const strategy of ["escape", "focus-away", "dismiss-1password-ui"] as const) {
    requireSharedTab();
    const [injection] = await deps.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      func: dismissExtensionMenuPageFn,
      args: [strategy],
    });
    requireSharedTab();
    const result = injection?.result;
    attempts.push(
      `${strategy}:${result?.attempted ? "attempted" : "no-target"}${result?.dismissedHosts?.length ? `(${result.dismissedHosts.join(",")})` : ""}`,
    );
    if (!result?.attempted) continue;
    focusChanged ||= result.focusChanged;
    dismissedHosts.push(...(result.dismissedHosts ?? []));
    // Menu removal is asynchronous. Retry only the harmless access probe;
    // never replay a click, submit, or the original failed action.
    for (const delay of [0, 50, 100, 200, 400]) {
      requireSharedTab();
      if (delay > 0) {
        await (deps.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
          delay,
        );
        requireSharedTab();
      }
      try {
        await deps.probe();
        requireSharedTab();
        return {
          via: "scripting",
          strategy,
          focusChanged,
          ...(result.dismissedHosts ? { dismissedHosts: result.dismissedHosts } : {}),
        };
      } catch (error) {
        // Chrome can detach when a foreign frame is removed. A harmless probe
        // must reattach in that case rather than fail after dismissal succeeded.
        if (isDebuggerNotAttachedError(error) && deps.resetDebugger) {
          requireSharedTab();
          try {
            await deps.resetDebugger();
            requireSharedTab();
            await deps.probe();
            requireSharedTab();
            return {
              via: "scripting",
              strategy: "debugger-reconnect",
              focusChanged,
              ...(dismissedHosts.length ? { dismissedHosts } : {}),
            };
          } catch (reconnectError) {
            if (
              !isExtensionFrameAccessError(reconnectError) &&
              !isDebuggerNotAttachedError(reconnectError)
            )
              throw reconnectError;
          }
        } else if (!isExtensionFrameAccessError(error)) throw error;
      }
    }
  }
  // Reconnect only after all DOM dismissal attempts, so attaching while an
  // extension frame still exists cannot prevent the later dismissal steps.
  if (deps.resetDebugger) {
    requireSharedTab();
    try {
      await deps.resetDebugger();
      requireSharedTab();
      await deps.probe();
      requireSharedTab();
      return {
        via: "scripting",
        strategy: "debugger-reconnect",
        focusChanged,
        ...(dismissedHosts.length ? { dismissedHosts } : {}),
      };
    } catch (error) {
      if (!isExtensionFrameAccessError(error)) throw error;
      attempts.push("debugger-reconnect:blocked");
    }
  }
  throw new Error(
    `Cannot access a chrome-extension:// URL: ABG could not dismiss the inline menu; ${attempts.join("; ")}`,
  );
}
