import { build } from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnnotationCommand, runAnnotationCommand } from "../src/annotationOverlay.js";
import type { annotationOverlayStrings } from "../src/i18n.js";

declare global {
  interface Window {
    annotationTest: {
      runAnnotationCommand: typeof runAnnotationCommand;
      ui: ReturnType<typeof annotationOverlayStrings>;
    };
    pageUndoCalls: number;
  }
}

let browser: Browser;
let script: string;
let modifier = "Control";

beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `export {runAnnotationCommand} from './annotationOverlay'; import {annotationOverlayStrings} from './i18n'; export const ui=annotationOverlayStrings('en');`,
      resolveDir: new URL("../src", import.meta.url).pathname,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "annotationTest",
  });
  script = output.outputFiles[0]?.text ?? "";
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => await browser?.close());

async function fixture() {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 760 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.route("https://fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>body{font:18px system-ui;padding:70px}section{padding:30px;width:420px}</style><section><h1>Project overview</h1><p id="subject">Review the project timeline.</p><input id="pageInput" value="Original input"><div id="editable" contenteditable>Editable text</div></section>',
    }),
  );
  await page.goto("https://fixture.test/");
  modifier = await page.evaluate(() => (navigator.platform.includes("Mac") ? "Meta" : "Control"));
  await page.addScriptTag({ content: script });
  return { context, page };
}
const command = (page: Page, params: AnnotationCommand) =>
  page.evaluate(
    (params) =>
      window.annotationTest.runAnnotationCommand({ ...params, ui: window.annotationTest.ui }),
    params,
  );
const notes = async (page: Page) =>
  (await command(page, { action: "list" })).annotations as Array<{
    uid: string;
    comment: string;
    reference: string;
    viewportRect: { x: number; y: number; width: number; height: number };
  }>;
const undo = (page: Page) => page.keyboard.press(`${modifier}+z`);
const redo = (page: Page) => page.keyboard.press(`${modifier}+Shift+z`);
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

describe("annotation browser interactions", () => {
  it("keeps marker focus and keyboard activation across position refreshes", async () => {
    const { context, page } = await fixture();
    try {
      await command(page, { action: "start" });
      await command(page, { action: "add_selector", selector: "#subject", comment: "Focus note" });
      const marker = page.locator(".abg-annotation-box");
      await marker.click();
      const original = await marker.elementHandle();
      await page.waitForTimeout(450);
      expect(
        await marker.evaluate(
          (el) => el === (el.getRootNode() as Document | ShadowRoot).activeElement,
        ),
      ).toBe(true);
      expect(await marker.evaluate((el, first) => el === first, original)).toBe(true);
      await page.keyboard.press("Enter");
      expect(await page.locator(".abg-editor textarea").inputValue()).toBe("Focus note");
      await page.keyboard.press("Escape");
      await marker.focus();
      await page.keyboard.down("Space");
      await page.waitForTimeout(450);
      await page.keyboard.up("Space");
      expect(await page.locator(".abg-editor textarea").inputValue()).toBe("Focus note");
      await page.keyboard.press("Escape");
      await page.locator("#pageInput").focus();
      await page.waitForTimeout(300);
      expect(
        await page
          .locator("#pageInput")
          .evaluate((el) => el === (el.getRootNode() as Document | ShadowRoot).activeElement),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("keeps text-fragment focus, updates marker positions, and preserves inactive copying", async () => {
    const { context, page } = await fixture();
    try {
      await command(page, { action: "start" });
      await command(page, { action: "switch_mode" });
      await page.locator("#subject").selectText();
      await page.locator("#subject").dispatchEvent("mouseup", { bubbles: true });
      await page.locator(".abg-editor textarea").fill("Text focus");
      await page.keyboard.press("Enter");
      const piece = page.locator(".abg-text-selection-piece").first();
      await piece.click();
      const first = await piece.elementHandle();
      const bounds = await piece.boundingBox();
      await page.locator("#subject").evaluate((el) => {
        el.style.transform = "translateY(25px)";
      });
      await page.waitForTimeout(450);
      expect(
        await piece.evaluate((el) => el === (el.getRootNode() as ShadowRoot).activeElement),
      ).toBe(true);
      expect(await piece.evaluate((el, original) => el === original, first)).toBe(true);
      expect((await piece.boundingBox())?.y).toBeCloseTo((bounds?.y ?? 0) + 25, 0);
      await page.keyboard.press("Space");
      expect(await page.locator(".abg-editor textarea").inputValue()).toBe("Text focus");
      await page.keyboard.press("Escape");
      const [note] = await notes(page);
      await command(page, { action: "stop" });
      await piece.focus();
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await expect.poll(() => clipboard(page)).toBe(note?.reference);
    } finally {
      await context.close();
    }
  });

  it("copies stable IDs while preserving native text copy and reports clipboard failures", async () => {
    const { context, page } = await fixture();
    try {
      await command(page, { action: "start" });
      await command(page, {
        action: "add_selector",
        selector: "#subject",
        comment: "Original note",
      });
      const [note] = await notes(page);
      expect(note).toBeDefined();
      const box = page.locator(".abg-annotation-box");
      await box.click();
      await page.keyboard.press(`${modifier}+c`);
      await expect.poll(() => clipboard(page)).toBe(note?.reference);
      await page.locator("#pageInput").focus();
      await page.locator("#pageInput").selectText();
      await page.keyboard.press(`${modifier}+c`);
      await expect.poll(() => clipboard(page)).toBe("Original input");
      await box.click();
      await page.locator(".abg-editor textarea").selectText();
      await page.keyboard.press(`${modifier}+c`);
      await expect.poll(() => clipboard(page)).toBe("Original note");
      await page.keyboard.press("Escape");
      await page.locator("#editable").focus();
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.press(`${modifier}+c`);
      await expect.poll(() => clipboard(page)).toBe("Editable text");
      await page.evaluate(() => getSelection()?.removeAllRanges());
      await command(page, { action: "stop" });
      await box.click();
      await expect.poll(() => clipboard(page)).toBe(note?.reference);
      await page.evaluate(() =>
        Object.defineProperty(navigator.clipboard, "writeText", {
          value: () => Promise.reject(new Error("Denied")),
        }),
      );
      await box.click();
      await expect
        .poll(() => page.locator(".abg-toast").textContent())
        .toContain("Could not copy the ID");
      expect((await notes(page))[0]?.uid).toBe(note?.uid);
    } finally {
      await context.close();
    }
  });

  it("undoes complete annotation operations and keeps page/editor undo native", async () => {
    const { context, page } = await fixture();
    try {
      await command(page, { action: "start" });
      await page.evaluate(() => {
        window.pageUndoCalls = 0;
        window.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z")
            window.pageUndoCalls++;
        });
      });
      await undo(page);
      expect(await page.evaluate(() => window.pageUndoCalls)).toBe(0);
      await command(page, {
        action: "add_selector",
        selector: "#subject",
        comment: "Original note",
      });
      const [first] = await notes(page);
      await undo(page);
      expect(await notes(page)).toHaveLength(0);
      await redo(page);
      expect((await notes(page))[0]?.uid).toBe(first?.uid);
      const box = page.locator(".abg-annotation-box").first();
      await box.click();
      await page.keyboard.press("Delete");
      expect(await notes(page)).toHaveLength(0);
      await undo(page);
      expect((await notes(page))[0]?.uid).toBe(first?.uid);
      await box.click();
      await box.click();
      const editor = page.locator(".abg-editor textarea");
      await editor.selectText();
      await page.keyboard.type("Changed note");
      await undo(page);
      expect(await editor.inputValue()).toBe("Original note");
      expect(await notes(page)).toHaveLength(1);
      await editor.selectText();
      await page.keyboard.type("Saved change");
      await page.keyboard.press("Enter");
      await undo(page);
      expect((await notes(page))[0]?.comment).toBe("Original note");
      await redo(page);
      expect((await notes(page))[0]?.comment).toBe("Saved change");
      await command(page, { action: "add_region", x: 700, y: 300, width: 120, height: 90 });
      const screenshot = (await notes(page))[1];
      await page.mouse.move(710, 310);
      await page.mouse.down();
      await page.mouse.move(750, 340, { steps: 4 });
      await page.mouse.up();
      expect((await notes(page))[1]?.viewportRect.x).toBe(740);
      await undo(page);
      expect((await notes(page))[1]?.viewportRect).toEqual(screenshot?.viewportRect);
      await redo(page);
      expect((await notes(page))[1]?.viewportRect.x).toBe(740);
      await page.locator(".abg-annotation-box").nth(1).click();
      const handle = page.locator(".abg-resize-se");
      const bounds = await handle.boundingBox();
      if (!bounds) throw new Error("Missing resize handle");
      const beforeResize = (await notes(page))[1]?.viewportRect;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 15, {
        steps: 4,
      });
      await page.mouse.up();
      expect((await notes(page))[1]?.viewportRect.width).toBe((beforeResize?.width ?? 0) + 20);
      await undo(page);
      expect((await notes(page))[1]?.viewportRect).toEqual(beforeResize);
      await page.getByRole("button", { name: "Clear all", exact: true }).click();
      await page.locator('button[data-action="clear"]').click();
      expect(await notes(page)).toHaveLength(0);
      await undo(page);
      expect(await notes(page)).toHaveLength(2);
      await redo(page);
      expect(await notes(page)).toHaveLength(0);
      await undo(page);
      await command(page, { action: "remove", uid: first?.uid });
      expect(await page.locator('button[data-action="undo"]').isDisabled()).toBe(true);
      expect(await page.locator('button[data-action="redo"]').isDisabled()).toBe(true);
      await undo(page);
      expect((await notes(page)).map((note) => note.uid)).toEqual([screenshot?.uid]);
      await command(page, { action: "stop" });
      const count = await page.evaluate(() => window.pageUndoCalls);
      await redo(page);
      expect(await page.evaluate(() => window.pageUndoCalls)).toBe(count + 1);
      await command(page, { action: "start" });
      await page.locator("#pageInput").focus();
      await page.locator("#pageInput").selectText();
      await page.keyboard.type("Changed input");
      await undo(page);
      expect(await page.locator("#pageInput").inputValue()).toBe("Original input");
    } finally {
      await context.close();
    }
  }, 30000);
});
