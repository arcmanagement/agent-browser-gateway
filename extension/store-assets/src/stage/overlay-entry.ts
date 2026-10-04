// Store-asset capture only (not shipped): runs the real annotation overlay in a plain page.
// chrome.scripting.executeScript is stubbed to call the injected function inline, the same way
// the extension injects it into a shared tab. The stub is only read when a command runs.
import { manageAnnotationMode } from "../../../src/annotationOverlay.js";
import { annotationOverlayStrings } from "../../../src/i18n.js";

(globalThis as unknown as { chrome: unknown }).chrome = {
  scripting: {
    executeScript: async ({
      func,
      args,
    }: {
      func: (...a: unknown[]) => unknown;
      args: unknown[];
    }) => [{ result: func(...args) }],
  },
  runtime: { id: "store-assets", sendMessage: async () => ({ type: "ok" }) },
};

const lang = new URLSearchParams(location.search).get("lang") === "ja" ? "ja" : "en";
(window as unknown as { abgAnnotate: unknown }).abgAnnotate = (cmd: Record<string, unknown>) =>
  manageAnnotationMode(1, { ...cmd, ui: annotationOverlayStrings(lang) } as never);
