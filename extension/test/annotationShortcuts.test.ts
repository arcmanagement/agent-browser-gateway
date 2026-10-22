import { describe, expect, it, vi } from "vitest";
import {
  CLEAR_ANNOTATIONS_COMMAND,
  performAnnotationShortcut,
  SWITCH_ANNOTATION_MODE_COMMAND,
  TOGGLE_ANNOTATE_COMMAND,
  TOGGLE_ANNOTATION_TOOLBAR_COMMAND,
} from "../src/annotationShortcuts.js";

function setup(shared: boolean, enabled = false) {
  return {
    shared,
    share: vi.fn(async () => true),
    run: vi.fn(async () => ({ ok: true as const, enabled, count: 0, annotations: [] })),
  };
}

describe("annotation shortcuts", () => {
  it("shares an unshared tab before starting and never revokes it when stopping", async () => {
    const deps = setup(false);
    await performAnnotationShortcut(TOGGLE_ANNOTATE_COMMAND, deps);
    expect(deps.share).toHaveBeenCalledOnce();
    expect(deps.share.mock.invocationCallOrder[0]).toBeLessThan(
      deps.run.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deps.run).toHaveBeenLastCalledWith({ action: "start" });

    const shared = setup(true, true);
    await performAnnotationShortcut(TOGGLE_ANNOTATE_COMMAND, shared);
    expect(shared.share).not.toHaveBeenCalled();
    expect(shared.run).toHaveBeenLastCalledWith({ action: "stop" });
  });

  it("does not inject an overlay when sharing was blocked", async () => {
    const deps = setup(false);
    deps.share.mockResolvedValue(false);
    await performAnnotationShortcut(TOGGLE_ANNOTATE_COMMAND, deps);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it.each([
    CLEAR_ANNOTATIONS_COMMAND,
    SWITCH_ANNOTATION_MODE_COMMAND,
    TOGGLE_ANNOTATION_TOOLBAR_COMMAND,
  ])("%s never shares a tab or starts annotation mode", async (command) => {
    const unshared = setup(false);
    await performAnnotationShortcut(command, unshared);
    expect(unshared.share).not.toHaveBeenCalled();
    expect(unshared.run).not.toHaveBeenCalled();
    const inactive = setup(true);
    await performAnnotationShortcut(command, inactive);
    expect(inactive.run).toHaveBeenCalledExactlyOnceWith({ action: "list" });
  });

  it("uses the overlay confirmation for clear and switches tools without restarting", async () => {
    const deps = setup(true, true);
    await performAnnotationShortcut(CLEAR_ANNOTATIONS_COMMAND, deps);
    expect(deps.run).toHaveBeenLastCalledWith({ action: "clear_confirm" });
    await performAnnotationShortcut(SWITCH_ANNOTATION_MODE_COMMAND, deps);
    expect(deps.run).toHaveBeenLastCalledWith({ action: "switch_mode" });
    await performAnnotationShortcut(TOGGLE_ANNOTATION_TOOLBAR_COMMAND, deps);
    expect(deps.run).toHaveBeenLastCalledWith({ action: "toggle_toolbar" });
  });
});
