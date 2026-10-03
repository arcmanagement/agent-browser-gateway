import { afterEach, describe, expect, it, vi } from "vitest";
import buildScript from "../build.mjs?raw";
import enMessagesJson from "../public/_locales/en/messages.json";
import jaMessagesJson from "../public/_locales/ja/messages.json";
import approvalHtml from "../public/approval.html?raw";
import manifestJson from "../public/manifest.json";
import popupHtml from "../public/popup.html?raw";
import {
  annotationOverlayStrings,
  browserUiLocale,
  catalogFor,
  formatText,
  isUiLanguageSetting,
  LANGUAGES,
  languageForLocale,
  type MessageEntry,
  type MessageKey,
  msg,
  normalizeUiLanguageSetting,
  readUiLanguage,
  resolveUiLanguage,
  t,
  template,
} from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { ja } from "../src/locales/ja.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const keys = Object.keys(en) as MessageKey[];

function forms(entry: MessageEntry): string[] {
  return typeof entry === "string" ? [entry] : [entry.one, entry.other];
}

function placeholders(entry: MessageEntry): string[] {
  const names = new Set<string>();
  for (const form of forms(entry)) {
    for (const match of form.matchAll(/\{(\w+)\}/g)) names.add(match[1] ?? "");
  }
  return [...names].sort();
}

const pages: Record<string, string> = { "popup.html": popupHtml, "approval.html": approvalHtml };

describe("message catalogs", () => {
  it("define exactly the same keys in every language", () => {
    expect(Object.keys(ja).sort()).toEqual([...keys].sort());
  });

  it("use the same placeholders as English", () => {
    for (const key of keys) {
      expect({ key, placeholders: placeholders(ja[key]) }).toEqual({
        key,
        placeholders: placeholders(en[key]),
      });
    }
  });

  it("have no empty messages", () => {
    for (const lang of LANGUAGES) {
      for (const key of keys) {
        const entry = catalogFor(lang)[key];
        expect(entry, `${lang}:${key}`).toBeDefined();
        for (const form of forms(entry as MessageEntry)) {
          expect(form.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keep Allow/Deny and Share/Revoke distinct in Japanese", () => {
    expect(t("ja", "approval.allow")).toBe("許可");
    expect(t("ja", "approval.deny")).toBe("拒否");
    expect(t("ja", "popup.action.share")).toBe("このタブをエージェントと共有");
    expect(t("ja", "popup.action.revoke")).toBe("このタブの共有を解除");
  });
});

describe("t", () => {
  it("interpolates named placeholders, including nested messages", () => {
    expect(t("en", "approval.expires", { seconds: 60 })).toBe(
      "This request expires in 60 seconds.",
    );
    expect(
      t("en", "intent.clickSelector", {
        selector: '"#go"',
        frame: msg("intent.frameSuffix", { frame: '"iframe"' }),
      }),
    ).toBe('Click the element matching selector "#go" inside frame "iframe".');
    expect(
      t("ja", "intent.clickSelector", {
        selector: '"#go"',
        frame: msg("intent.frameSuffix", { frame: '"iframe"' }),
      }),
    ).toBe('セレクタ "#go" (フレーム "iframe" 内) に一致する要素をクリックします。');
    expect(t("en", "intent.clickSelector", { selector: '"#go"', frame: "" })).toBe(
      'Click the element matching selector "#go".',
    );
  });

  it("leaves a placeholder without a value visible", () => {
    expect(t("en", "approval.expires")).toBe("This request expires in {seconds} seconds.");
  });

  it("chooses English plural forms by count", () => {
    expect(t("en", "overlay.count", { count: 0 })).toBe("0 annotations");
    expect(t("en", "overlay.count", { count: 1 })).toBe("1 annotation");
    expect(t("en", "overlay.count", { count: 2 })).toBe("2 annotations");
    expect(t("ja", "overlay.count", { count: 1 })).toBe("注釈 1 件");
    expect(t("ja", "overlay.count", { count: 2 })).toBe("注釈 2 件");
  });

  it("falls back to English for a message missing from a catalog", () => {
    const catalog = catalogFor("ja") as Record<string, MessageEntry>;
    const saved = catalog["approval.allow"];
    delete catalog["approval.allow"];
    try {
      expect(t("ja", "approval.allow")).toBe("Allow");
      expect(t("ja", "approval.deny")).toBe("拒否");
    } finally {
      catalog["approval.allow"] = saved as MessageEntry;
    }
  });

  it("returns the key for an unknown message instead of throwing", () => {
    expect(t("ja", "no.such.key" as MessageKey)).toBe("no.such.key");
  });

  it("formats deferred messages in the reader's language", () => {
    const text = msg("shortcut.copyFailed", { tabId: 3, error: "denied" });
    expect(formatText("en", text)).toBe("Could not copy tab ID 3: denied");
    expect(formatText("ja", text)).toBe("タブ ID 3 をコピーできませんでした: denied");
  });
});

describe("language resolution", () => {
  it("maps browser locales to a supported language", () => {
    expect(languageForLocale("ja")).toBe("ja");
    expect(languageForLocale("ja-JP")).toBe("ja");
    expect(languageForLocale("JA_jp")).toBe("ja");
    expect(languageForLocale("en-US")).toBe("en");
    expect(languageForLocale("fr")).toBe("en");
    expect(languageForLocale("jav")).toBe("en");
    expect(languageForLocale(undefined)).toBe("en");
  });

  it("uses an explicit setting and follows the browser for auto", () => {
    expect(resolveUiLanguage("en", "ja")).toBe("en");
    expect(resolveUiLanguage("ja", "en-US")).toBe("ja");
    expect(resolveUiLanguage("auto", "ja")).toBe("ja");
    expect(resolveUiLanguage("auto", "de-DE")).toBe("en");
    expect(resolveUiLanguage(undefined, "ja-JP")).toBe("ja");
  });

  it("reads the browser UI language from chrome.i18n, then navigator", () => {
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "ja" } });
    expect(browserUiLocale()).toBe("ja");
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(browserUiLocale()).toBe("en-GB");
  });

  it("reads and validates the stored setting", async () => {
    vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "ja-JP" } });
    const storage = (value: unknown) => ({
      get: async () => (value === undefined ? {} : { uiLanguage: value }),
    });
    await expect(readUiLanguage(storage(undefined))).resolves.toBe("ja");
    await expect(readUiLanguage(storage("en"))).resolves.toBe("en");
    await expect(readUiLanguage(storage("fr"))).resolves.toBe("ja");
    await expect(
      readUiLanguage({
        get: async () => {
          throw new Error("unavailable");
        },
      }),
    ).resolves.toBe("ja");
  });
});

describe("uiLanguage setting validation", () => {
  it("accepts auto, en, and ja only", () => {
    expect(isUiLanguageSetting("auto")).toBe(true);
    expect(isUiLanguageSetting("en")).toBe(true);
    expect(isUiLanguageSetting("ja")).toBe(true);
    expect(isUiLanguageSetting("ja-JP")).toBe(false);
    expect(isUiLanguageSetting("")).toBe(false);
    expect(isUiLanguageSetting(undefined)).toBe(false);
    expect(isUiLanguageSetting(1)).toBe(false);
  });

  it("defaults a missing or invalid stored value to auto and asks to persist it", () => {
    expect(normalizeUiLanguageSetting("ja")).toEqual({ value: "ja", shouldPersist: false });
    expect(normalizeUiLanguageSetting(undefined)).toEqual({ value: "auto", shouldPersist: true });
    expect(normalizeUiLanguageSetting("klingon")).toEqual({
      value: "auto",
      shouldPersist: true,
    });
  });
});

describe("annotation overlay strings", () => {
  it("passes raw templates for the overlay to fill in", () => {
    const english = annotationOverlayStrings("en");
    expect(english.countOne).toBe("{count} annotation");
    expect(english.countOther).toBe("{count} annotations");
    expect(english.annotationLabel).toBe("Annotation {number}");
    const japanese = annotationOverlayStrings("ja");
    expect(japanese.done).toBe("完了");
    expect(japanese.doneToastOther).toBe("注釈 {count} 件をエージェントが読み取れます");
    for (const value of Object.values(japanese)) expect(value.length).toBeGreaterThan(0);
    expect(template("ja", "overlay.count", 1)).toBe(japanese.countOne);
  });
});

describe("static page text", () => {
  for (const [page, html] of Object.entries(pages)) {
    it(`${page} uses known keys whose English default matches the catalog`, () => {
      const textKeys = [...html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)];
      expect(textKeys.length).toBeGreaterThan(0);
      for (const [, key, text] of textKeys) {
        const entry = en[key as MessageKey];
        expect(entry, key).toBeDefined();
        expect((text ?? "").replace(/\s+/g, " ").trim().replaceAll("&amp;", "&"), key).toBe(entry);
      }
      for (const [, attr, key] of html.matchAll(
        /data-i18n-(placeholder|title|aria-label)="([^"]+)"/g,
      )) {
        expect(en[key as MessageKey], `${attr}:${key}`).toBeDefined();
      }
    });
  }

  it("popup.html placeholder default matches the catalog", () => {
    expect(popupHtml).toContain(`placeholder="${en["popup.advanced.profileLabel.placeholder"]}"`);
  });
});

describe("manifest localization", () => {
  type Messages = Record<string, { message: string }>;
  const manifest = manifestJson as Record<string, unknown>;
  const enMessages: Messages = enMessagesJson;
  const jaMessages: Messages = jaMessagesJson;

  it("declares English as the default locale", () => {
    expect(manifest.default_locale).toBe("en");
  });

  it("defines every __MSG_ key used by the manifest and the Firefox build in both locales", () => {
    const manifestKeys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(
      (match) => match[1] ?? "",
    );
    const buildKeys = [...buildScript.matchAll(/__MSG_(\w+)__/g)].map((match) => match[1] ?? "");
    for (const key of [...manifestKeys, ...buildKeys]) {
      expect(enMessages[key]?.message, `en:${key}`).toBeTruthy();
      expect(jaMessages[key]?.message, `ja:${key}`).toBeTruthy();
    }
    expect(Object.keys(jaMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it("keeps store-facing limits", () => {
    for (const messages of [enMessages, jaMessages]) {
      expect(messages.extName?.message.length).toBeLessThanOrEqual(75);
      expect(messages.extDescription?.message.length).toBeLessThanOrEqual(132);
    }
    expect(enMessages.extDescription?.message).toBe(
      "Share Chrome tabs with AI coding agents via explicit local permission.",
    );
  });
});
