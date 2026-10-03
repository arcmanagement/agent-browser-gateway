import { type Language, type MessageKey, t } from "./i18n.js";

// Static text in extension pages is marked with data attributes whose value is a message key.
// The English text in the HTML is only what shows before the script runs; a unit test keeps it
// equal to the English catalog.
//   data-i18n               -> textContent
//   data-i18n-placeholder   -> placeholder
//   data-i18n-title         -> title
//   data-i18n-aria-label    -> aria-label
const ATTRIBUTE_TARGETS = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
  ["data-i18n-aria-label", "aria-label"],
] as const;

export function applyTranslations(doc: Document, lang: Language): void {
  doc.documentElement.lang = lang;
  for (const el of doc.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(lang, el.getAttribute("data-i18n") as MessageKey);
  }
  for (const [source, target] of ATTRIBUTE_TARGETS) {
    for (const el of doc.querySelectorAll<HTMLElement>(`[${source}]`)) {
      el.setAttribute(target, t(lang, el.getAttribute(source) as MessageKey));
    }
  }
}
