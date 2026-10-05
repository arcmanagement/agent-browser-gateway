import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canRecoverEscape,
  dismissExtensionMenuPageFn,
  isExtensionFrameAccessError,
  recoverExtensionFrame,
} from "../src/passwordManagerRecoveryLogic.js";
import { installChromeMock } from "./chromeMock.js";

const blocked = () => new Error("Cannot access a chrome-extension:// URL of different extension");

function recoveryFixture() {
  const chrome = installChromeMock();
  chrome.scripting.executeScript.mockResolvedValue([
    { frameId: 0, result: { attempted: true, focusChanged: false } },
  ]);
  return {
    chrome,
    deps: {
      isPermitted: vi.fn(() => true),
      scripting: chrome.scripting as unknown as Pick<
        typeof globalThis.chrome.scripting,
        "executeScript"
      >,
      probe: vi.fn(async () => {}),
      wait: vi.fn(async (_milliseconds: number) => {}),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("extension frame recovery", () => {
  it("only recovers an unmodified Escape for the specific cross-extension denial", () => {
    expect(canRecoverEscape("Escape", undefined, [], blocked())).toBe(true);
    expect(canRecoverEscape("Escape", "Escape", [], blocked())).toBe(true);
    expect(canRecoverEscape("Enter", undefined, [], blocked())).toBe(false);
    expect(canRecoverEscape("Escape", "Enter", [], blocked())).toBe(false);
    expect(canRecoverEscape("Escape", undefined, ["ctrl"], blocked())).toBe(false);
    expect(canRecoverEscape("Escape", undefined, [], new Error("Not allowed"))).toBe(false);
    expect(isExtensionFrameAccessError(new Error("tab not permitted"))).toBe(false);
  });

  it("injects only into the shared top frame and verifies debugger recovery", async () => {
    const { chrome, deps } = recoveryFixture();
    await expect(recoverExtensionFrame(deps, 123)).resolves.toEqual({
      via: "scripting",
      strategy: "escape",
      focusChanged: false,
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 123, frameIds: [0] },
      world: "ISOLATED",
      func: dismissExtensionMenuPageFn,
      args: ["escape"],
    });
    expect(deps.probe).toHaveBeenCalledOnce();
  });

  it("moves focus away if synthetic Escape is ignored, then verifies recovery", async () => {
    const { chrome, deps } = recoveryFixture();
    for (let i = 0; i < 5; i++) deps.probe.mockRejectedValueOnce(blocked());
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ frameId: 0, result: { attempted: true, focusChanged: false } }])
      .mockResolvedValueOnce([{ frameId: 0, result: { attempted: true, focusChanged: true } }]);
    await expect(recoverExtensionFrame(deps, 123)).resolves.toEqual({
      via: "scripting",
      strategy: "focus-away",
      focusChanged: true,
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ args: ["escape"] }),
    );
    expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ args: ["focus-away"] }),
    );
  });

  it("waits for asynchronous iframe removal without resending the dismissal", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.probe.mockRejectedValueOnce(blocked()).mockRejectedValueOnce(blocked());
    await expect(recoverExtensionFrame(deps, 123)).resolves.toEqual({
      via: "scripting",
      strategy: "escape",
      focusChanged: false,
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
    expect(deps.wait.mock.calls).toEqual([[50], [100]]);
    expect(deps.probe).toHaveBeenCalledTimes(3);
  });

  it("reconnects only after dismissal strategies have run, without replaying actions", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.probe.mockRejectedValue(blocked());
    const resetDebugger = vi.fn(async () => {
      deps.probe.mockResolvedValue(undefined);
    });
    await expect(recoverExtensionFrame({ ...deps, resetDebugger }, 123)).resolves.toMatchObject({
      strategy: "debugger-reconnect",
    });
    expect(resetDebugger).toHaveBeenCalledOnce();
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  it("does not reset a debugger for unrelated errors", async () => {
    const { deps } = recoveryFixture();
    deps.probe.mockRejectedValue(new Error("tab not permitted"));
    const resetDebugger = vi.fn(async () => {});
    await expect(recoverExtensionFrame({ ...deps, resetDebugger }, 123)).rejects.toThrow(
      "tab not permitted",
    );
    expect(resetDebugger).not.toHaveBeenCalled();
  });

  it("reattaches when Chrome detaches during host dismissal, then verifies access", async () => {
    const { chrome, deps } = recoveryFixture();
    for (let i = 0; i < 10; i++) deps.probe.mockRejectedValueOnce(blocked());
    deps.probe.mockRejectedValueOnce(
      new Error("Debugger is not attached to the tab with id: 123."),
    );
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { attempted: true, focusChanged: false } }])
      .mockResolvedValueOnce([{ result: { attempted: true, focusChanged: true } }])
      .mockResolvedValueOnce([
        {
          result: {
            attempted: true,
            focusChanged: false,
            dismissedHosts: ["com-1password-uso"],
          },
        },
      ]);
    const resetDebugger = vi.fn(async () => {});
    await expect(recoverExtensionFrame({ ...deps, resetDebugger }, 123)).resolves.toEqual({
      via: "scripting",
      strategy: "debugger-reconnect",
      focusChanged: true,
      dismissedHosts: ["com-1password-uso"],
    });
    expect(resetDebugger).toHaveBeenCalledOnce();
    expect(deps.probe).toHaveBeenCalledTimes(12);
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
  });

  it("fails after three bounded strategies instead of claiming success", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.probe.mockRejectedValue(blocked());
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("could not dismiss");
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(3);
    expect(deps.probe).toHaveBeenCalledTimes(15);
    expect(deps.wait.mock.calls).toHaveLength(12);
  });

  it("preserves permission errors without retrying or injecting another action", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.probe.mockRejectedValue(new Error("Debugger is not attached"));
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("Debugger is not attached");
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
  });

  it("rejects an unshared tab before script injection", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.isPermitted.mockReturnValue(false);
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("tab not permitted");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("stops if sharing is revoked while injection is in flight", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.isPermitted.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("tab not permitted");
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("stops if sharing is revoked while waiting for the menu to close", async () => {
    const { chrome, deps } = recoveryFixture();
    deps.probe.mockRejectedValueOnce(blocked());
    deps.wait.mockImplementationOnce(async () => {
      deps.isPermitted.mockReturnValue(false);
    });
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("tab not permitted");
    expect(deps.probe).toHaveBeenCalledOnce();
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
  });

  it("does not claim success when injection produced no result", async () => {
    const { chrome, deps } = recoveryFixture();
    chrome.scripting.executeScript.mockResolvedValue([]);
    await expect(recoverExtensionFrame(deps, 123)).rejects.toThrow("could not dismiss");
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("reports dismissed UI hosts and preserves earlier focus changes", async () => {
    const { chrome, deps } = recoveryFixture();
    for (let i = 0; i < 10; i++) deps.probe.mockRejectedValueOnce(blocked());
    chrome.scripting.executeScript
      .mockResolvedValueOnce([{ result: { attempted: true, focusChanged: false } }])
      .mockResolvedValueOnce([{ result: { attempted: true, focusChanged: true } }])
      .mockResolvedValueOnce([
        {
          result: {
            attempted: true,
            focusChanged: false,
            dismissedHosts: ["com-1password-notification"],
          },
        },
      ]);
    await expect(recoverExtensionFrame(deps, 123)).resolves.toEqual({
      via: "scripting",
      strategy: "dismiss-1password-ui",
      focusChanged: true,
      dismissedHosts: ["com-1password-notification"],
    });
  });
});

describe("dismissExtensionMenuPageFn", () => {
  class Field extends EventTarget {
    value = "unchanged";
    shadowRoot = null;
    blur = vi.fn();
  }
  class KeyEvent extends Event {
    key: string;
    code: string;
    constructor(type: string, init: KeyboardEventInit) {
      super(type, init);
      this.key = init.key ?? "";
      this.code = init.code ?? "";
    }
  }

  it("dispatches Escape without reading or changing the field value", () => {
    const field = new Field();
    const events: string[] = [];
    for (const type of ["keydown", "keyup"]) {
      field.addEventListener(type, (event) =>
        events.push(`${event.type}:${(event as KeyEvent).key}`),
      );
    }
    vi.stubGlobal("document", { activeElement: field });
    vi.stubGlobal("KeyboardEvent", KeyEvent);
    expect(dismissExtensionMenuPageFn("escape")).toEqual({ attempted: true, focusChanged: false });
    expect(events).toEqual(["keydown:Escape", "keyup:Escape"]);
    expect(field.value).toBe("unchanged");
    expect(field.blur).not.toHaveBeenCalled();
  });

  it.each([null, "3"])("moves focus to the body and restores tabindex %s", (tabindex) => {
    const field = new Field();
    const body = {
      getAttribute: vi.fn(() => tabindex),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      focus: vi.fn(),
    };
    vi.stubGlobal("document", { activeElement: field, body });
    expect(dismissExtensionMenuPageFn("focus-away")).toEqual({
      attempted: true,
      focusChanged: true,
    });
    expect(body.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    if (tabindex === null) expect(body.removeAttribute).toHaveBeenCalledWith("tabindex");
    else expect(body.setAttribute).toHaveBeenLastCalledWith("tabindex", tabindex);
    expect(field.value).toBe("unchanged");
  });

  it("restores the body's tabindex even when focus throws", () => {
    const body = {
      getAttribute: vi.fn(() => null),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      focus: vi.fn(() => {
        throw new Error("focus failed");
      }),
    };
    vi.stubGlobal("document", { activeElement: new Field(), body });
    expect(() => dismissExtensionMenuPageFn("focus-away")).toThrow("focus failed");
    expect(body.removeAttribute).toHaveBeenCalledWith("tabindex");
  });

  it("dismisses only allowlisted page UI hosts without inspecting their contents", () => {
    const hosts = ["COM-1PASSWORD-MENU", "COM-1PASSWORD-NOTIFICATION", "COM-1PASSWORD-USO"].map(
      (tagName) => {
        const host = { tagName, remove: vi.fn() };
        Object.defineProperty(host, "shadowRoot", {
          get: () => {
            throw new Error("private UI");
          },
        });
        return host;
      },
    );
    const querySelectorAll = vi.fn(() => hosts);
    const field = new Field();
    vi.stubGlobal("document", { activeElement: field, querySelectorAll });
    expect(dismissExtensionMenuPageFn("dismiss-1password-ui")).toEqual({
      attempted: true,
      focusChanged: false,
      dismissedHosts: ["com-1password-menu", "com-1password-notification", "com-1password-uso"],
    });
    expect(querySelectorAll).toHaveBeenCalledExactlyOnceWith(
      "com-1password-menu,com-1password-notification,com-1password-uso",
    );
    for (const host of hosts) expect(host.remove).toHaveBeenCalledOnce();
    expect(field.value).toBe("unchanged");
  });
});
