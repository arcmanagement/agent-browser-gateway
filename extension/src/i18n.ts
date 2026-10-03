// Runtime i18n for the human-facing extension UI (popup, approval window, annotation overlay,
// shortcut feedback). Agent-facing output (Gateway responses, error codes and messages,
// audit entries, nextCommand) never goes through this module and stays English.
//
// English is the source of truth: `MessageKey` is derived from the English catalog and every
// other catalog must define exactly the same keys (enforced by its type and a unit test). A
// key that is somehow missing at runtime falls back to English.

import { en, type MessageEntry } from "./locales/en.js";
import { ja } from "./locales/ja.js";

export type { MessageEntry };
export type MessageKey = keyof typeof en;
export type MessageCatalog = { readonly [K in MessageKey]: MessageEntry };

/** Languages with a catalog. */
export const LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Values of the stored `uiLanguage` setting. "auto" follows the browser UI language. */
export const UI_LANGUAGE_SETTINGS = ["auto", ...LANGUAGES] as const;
export type UiLanguageSetting = (typeof UI_LANGUAGE_SETTINGS)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguageSetting = "auto";
export const UI_LANGUAGE_STORAGE_KEY = "uiLanguage";

const catalogs: Record<Language, Partial<MessageCatalog>> = { en, ja };

/**
 * A message that is formatted later, in whichever language the reader uses. Params may nest
 * other messages, for example an approval intent that embeds an optional frame suffix.
 */
export type LocalizedText = { key: MessageKey; params?: MessageParams };
export type MessageParam = string | number | LocalizedText;
export type MessageParams = Readonly<Record<string, MessageParam>>;

export function msg(key: MessageKey, params?: MessageParams): LocalizedText {
  return params ? { key, params } : { key };
}

export function isUiLanguageSetting(value: unknown): value is UiLanguageSetting {
  return typeof value === "string" && (UI_LANGUAGE_SETTINGS as readonly string[]).includes(value);
}

/** Validates a stored setting; anything unknown is replaced by the default and re-persisted. */
export function normalizeUiLanguageSetting(value: unknown): {
  value: UiLanguageSetting;
  shouldPersist: boolean;
} {
  return isUiLanguageSetting(value)
    ? { value, shouldPersist: false }
    : { value: DEFAULT_UI_LANGUAGE, shouldPersist: true };
}

/** Maps a browser UI locale such as "ja", "ja-JP", or "en-US" to a supported language. */
export function languageForLocale(locale: string | undefined): Language {
  const primary = (locale ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return primary === "ja" ? "ja" : "en";
}

export function resolveUiLanguage(
  setting: UiLanguageSetting | undefined,
  browserLocale: string | undefined,
): Language {
  if (setting === "en" || setting === "ja") return setting;
  return languageForLocale(browserLocale);
}

type I18nGlobals = {
  browser?: { i18n?: { getUILanguage?: () => string } };
  chrome?: { i18n?: { getUILanguage?: () => string } };
  navigator?: { language?: string };
};

/** The browser's UI locale: chrome.i18n / browser.i18n first, then navigator.language. */
export function browserUiLocale(): string | undefined {
  const globals = globalThis as unknown as I18nGlobals;
  const api = globals.browser?.i18n ?? globals.chrome?.i18n;
  try {
    const locale = api?.getUILanguage?.();
    if (locale) return locale;
  } catch {
    // Fall through to navigator.language.
  }
  return globals.navigator?.language;
}

/** Reads the stored setting and resolves it. Extension pages and the background share this. */
export async function readUiLanguage(storage: {
  get(keys: string): Promise<Record<string, unknown>>;
}): Promise<Language> {
  let setting: UiLanguageSetting = DEFAULT_UI_LANGUAGE;
  try {
    const stored = await storage.get(UI_LANGUAGE_STORAGE_KEY);
    setting = normalizeUiLanguageSetting(stored[UI_LANGUAGE_STORAGE_KEY]).value;
  } catch {
    // Storage is unavailable; follow the browser.
  }
  return resolveUiLanguage(setting, browserUiLocale());
}

function entryFor(lang: Language, key: MessageKey): MessageEntry {
  return catalogs[lang]?.[key] ?? en[key] ?? key;
}

function pluralForm(lang: Language, count: number): "one" | "other" {
  try {
    return new Intl.PluralRules(lang).select(count) === "one" ? "one" : "other";
  } catch {
    return count === 1 ? "one" : "other";
  }
}

/** The raw template for a key, choosing the plural form for `count` when the entry has one. */
export function template(lang: Language, key: MessageKey, count?: number): string {
  const entry = entryFor(lang, key);
  if (typeof entry === "string") return entry;
  return entry[pluralForm(lang, count ?? 0)];
}

/**
 * Formats a message. `{name}` placeholders are replaced by params (nested messages are
 * formatted in the same language); a numeric `count` param selects the plural form. A
 * placeholder without a param is left as is so a missing value is visible, never silent.
 */
export function t(lang: Language, key: MessageKey, params?: MessageParams): string {
  const count = typeof params?.count === "number" ? params.count : undefined;
  return interpolate(lang, template(lang, key, count), params);
}

export function formatText(lang: Language, text: LocalizedText): string {
  return t(lang, text.key, text.params);
}

function interpolate(lang: Language, raw: string, params: MessageParams | undefined): string {
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    if (typeof value === "object") return formatText(lang, value);
    return String(value);
  });
}

export function catalogFor(lang: Language): Partial<MessageCatalog> {
  return catalogs[lang];
}

/**
 * The annotation overlay runs as a self-contained function injected into the page, so it
 * cannot import this module. The background resolves this flat table of raw templates and
 * passes it in with each command; `{count}` and `{number}` are filled in by the overlay.
 * Plural pairs are split into One/Other because the overlay has no catalog to choose from.
 */
export type AnnotationOverlayStrings = {
  annotating: string;
  modeGroup: string;
  modeArea: string;
  modeText: string;
  clear: string;
  clearConfirm: string;
  clearConfirmTitle: string;
  done: string;
  doneTitle: string;
  countOne: string;
  countOther: string;
  hintArea: string;
  hintText: string;
  hintSelected: string;
  hintFinish: string;
  annotationLabel: string;
  editorPlaceholder: string;
  editorSave: string;
  editorDelete: string;
  editorKeysPrimary: string;
  editorKeysNewline: string;
  doneToastNone: string;
  doneToastOne: string;
  doneToastOther: string;
};

export function annotationOverlayStrings(lang: Language): AnnotationOverlayStrings {
  return {
    annotating: template(lang, "overlay.annotating"),
    modeGroup: template(lang, "overlay.modeGroup"),
    modeArea: template(lang, "overlay.modeArea"),
    modeText: template(lang, "overlay.modeText"),
    clear: template(lang, "overlay.clear"),
    clearConfirm: template(lang, "overlay.clearConfirm"),
    clearConfirmTitle: template(lang, "overlay.clearConfirmTitle"),
    done: template(lang, "overlay.done"),
    doneTitle: template(lang, "overlay.doneTitle"),
    countOne: template(lang, "overlay.count", 1),
    countOther: template(lang, "overlay.count", 2),
    hintArea: template(lang, "overlay.hintArea"),
    hintText: template(lang, "overlay.hintText"),
    hintSelected: template(lang, "overlay.hintSelected"),
    hintFinish: template(lang, "overlay.hintFinish"),
    annotationLabel: template(lang, "overlay.annotationLabel"),
    editorPlaceholder: template(lang, "overlay.editorPlaceholder"),
    editorSave: template(lang, "overlay.editorSave"),
    editorDelete: template(lang, "overlay.editorDelete"),
    editorKeysPrimary: template(lang, "overlay.editorKeysPrimary"),
    editorKeysNewline: template(lang, "overlay.editorKeysNewline"),
    doneToastNone: template(lang, "overlay.doneToastNone"),
    doneToastOne: template(lang, "overlay.doneToast", 1),
    doneToastOther: template(lang, "overlay.doneToast", 2),
  };
}
