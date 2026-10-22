import type { AnnotationCommand, AnnotationModeResult } from "./annotationOverlay.js";

export const TOGGLE_ANNOTATE_COMMAND = "toggle-annotate-current-tab";
export const SWITCH_ANNOTATION_MODE_COMMAND = "switch-annotation-mode";
export const CLEAR_ANNOTATIONS_COMMAND = "clear-annotations-current-tab";
export const TOGGLE_ANNOTATION_TOOLBAR_COMMAND = "toggle-annotation-toolbar";

export const ANNOTATION_COMMANDS = [
  TOGGLE_ANNOTATE_COMMAND,
  SWITCH_ANNOTATION_MODE_COMMAND,
  CLEAR_ANNOTATIONS_COMMAND,
  TOGGLE_ANNOTATION_TOOLBAR_COMMAND,
];

export async function performAnnotationShortcut(
  command: string,
  deps: {
    shared: boolean;
    share: () => Promise<boolean>;
    run: (command: AnnotationCommand) => Promise<AnnotationModeResult>;
  },
): Promise<void> {
  if (!ANNOTATION_COMMANDS.includes(command)) return;
  // Only the explicit start/stop command may grant access to a new tab.
  if (!deps.shared && (command !== TOGGLE_ANNOTATE_COMMAND || !(await deps.share()))) return;
  const current = await deps.run({ action: "list" });
  if (command === TOGGLE_ANNOTATE_COMMAND) {
    await deps.run({ action: current.enabled ? "stop" : "start" });
  } else if (current.enabled) {
    const action =
      command === SWITCH_ANNOTATION_MODE_COMMAND
        ? "switch_mode"
        : command === CLEAR_ANNOTATIONS_COMMAND
          ? "clear_confirm"
          : "toggle_toolbar";
    await deps.run({ action });
  }
}
