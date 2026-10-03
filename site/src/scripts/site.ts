// Shared site chrome: theme preference (shared with Starlight's "starlight-theme" key),
// mobile menu, and copy buttons.

type Pref = "auto" | "dark" | "light";
const KEY = "starlight-theme";
const root = document.documentElement;
const media = matchMedia("(prefers-color-scheme: light)");

const parsePref = (v: unknown): Pref => (v === "dark" || v === "light" ? v : "auto");

function loadPref(): Pref {
  try {
    return parsePref(localStorage.getItem(KEY));
  } catch {
    return "auto";
  }
}

function resolve(pref: Pref): "dark" | "light" {
  return pref === "auto" ? (media.matches ? "light" : "dark") : pref;
}

function syncControls(pref: Pref) {
  const theme = resolve(pref);
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((btn) => {
    const label = theme === "dark" ? btn.dataset.labelLight : btn.dataset.labelDark;
    if (label) btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label ?? "");
  });
  document
    .querySelectorAll<HTMLInputElement>("[data-theme-picker] input[name='theme-pref']")
    .forEach((input) => {
      input.checked = input.value === pref;
    });
}

function applyPref(pref: Pref, persist: boolean) {
  root.dataset.themePref = pref;
  root.dataset.theme = resolve(pref);
  if (persist) {
    try {
      localStorage.setItem(KEY, pref === "auto" ? "" : pref);
    } catch {
      /* storage unavailable: keep the in-page choice only */
    }
  }
  syncControls(pref);
}

applyPref(loadPref(), false);
media.addEventListener("change", () => {
  if (loadPref() === "auto") applyPref("auto", false);
});

document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    applyPref(next, true);
  });
});

document
  .querySelectorAll<HTMLInputElement>("[data-theme-picker] input[name='theme-pref']")
  .forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) applyPref(parsePref(input.value), true);
    });
  });

// Mobile menu disclosure.
const menuBtn = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
const nav = document.querySelector<HTMLElement>("[data-nav]");
if (menuBtn && nav) {
  const setOpen = (open: boolean) => {
    nav.dataset.open = open ? "true" : "false";
    menuBtn.setAttribute("aria-expanded", String(open));
    const label = open ? menuBtn.dataset.labelClose : menuBtn.dataset.labelOpen;
    if (label) menuBtn.setAttribute("aria-label", label);
  };
  menuBtn.addEventListener("click", () => setOpen(nav.dataset.open !== "true"));
  nav.querySelectorAll("#site-menu a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.dataset.open === "true") {
      setOpen(false);
      menuBtn.focus();
    }
  });
}

// Nav background once the page scrolls.
if (nav) {
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

// Table of contents: mark the section in view (privacy page).
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>(".toc a[href^='#']")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = byId.get(entry.target.id);
        if (!link) continue;
        tocLinks.forEach((a) => {
          a.classList.toggle("is-current", a === link);
          if (a === link) a.setAttribute("aria-current", "location");
          else a.removeAttribute("aria-current");
        });
      }
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  byId.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

// Copy buttons: <button data-copy="text" data-copied-label="Copied">.
document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
  const label = btn.querySelector<HTMLElement>("[data-copy-label]");
  const original = label?.textContent ?? "";
  let timer = 0;
  btn.addEventListener("click", async () => {
    const text = btn.dataset.copy ?? "";
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
    }
    if (!ok) return;
    btn.dataset.state = "copied";
    if (label) label.textContent = btn.dataset.copiedLabel ?? original;
    const live = document.querySelector<HTMLElement>("[data-copy-live]");
    if (live) live.textContent = btn.dataset.copiedLabel ?? "";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      btn.dataset.state = "";
      if (label) label.textContent = original;
      if (live) live.textContent = "";
    }, 1800);
  });
});
