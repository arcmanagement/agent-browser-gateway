// Landing page islands: scroll reveals, the hero demo loop, the consent demo,
// the annotation demo, and the live-feeling audit log. Vanilla, no dependencies.

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;
if (!reduced.matches) root.classList.add("motion");

/* ---------- Reveals ---------- */
// A scroll check rather than IntersectionObserver: it runs in the same task that enables
// motion (so above-the-fold content never flashes), and it keeps working in background tabs.
function observeReveals() {
  let pending = [...document.querySelectorAll<HTMLElement>(".reveal, [data-gate-rule], .chart, .flow")];
  const show = (el: HTMLElement) => {
    el.classList.add("is-in");
    if (el.hasAttribute("data-gate-rule")) el.classList.add("is-open");
  };
  if (reduced.matches) {
    pending.forEach(show);
    return;
  }
  let last = 0;
  let trailing = 0;
  const check = () => {
    last = performance.now();
    const limit = (innerHeight || document.documentElement.clientHeight || 100000) * 0.9;
    pending = pending.filter((el) => {
      if (el.getBoundingClientRect().top < limit) {
        show(el);
        return false;
      }
      return true;
    });
    if (pending.length === 0) {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    }
  };
  const onScroll = () => {
    window.clearTimeout(trailing);
    if (performance.now() - last > 60) check();
    trailing = window.setTimeout(check, 80);
  };
  check();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", check);
}
observeReveals();

/* ---------- Hero demo ---------- */
type Demo = { empty: string; tabsLine: string; md: string[]; err: string[] };

class Cancelled extends Error {}

function setupStage() {
  const stage = document.querySelector<HTMLElement>("[data-stage]");
  if (!stage) return;
  const term = stage.querySelector<HTMLElement>("[data-term]")!;
  const auditText = stage.querySelector<HTMLElement>("[data-audit-text]")!;
  const toggle = stage.querySelector<HTMLButtonElement>("[data-stage-toggle]")!;
  const demo = JSON.parse(stage.querySelector("[data-demo]")?.textContent ?? "{}") as Demo;

  const set = (attrs: Record<string, string>) => {
    for (const [k, v] of Object.entries(attrs)) stage.setAttribute(`data-${k}`, v);
  };

  const showStatic = () => {
    // Static composition: the moment after a successful read.
    set({ step: "static", lit: "true", pop: "closed", cursor: "away", toast: "", keys: "off", flow: "off", audit: "on" });
  };

  if (reduced.matches) {
    showStatic();
    return;
  }

  let playing = true;
  let inView = true;
  let generation = 0;
  let resume: (() => void) | null = null;

  const gate = () =>
    playing && inView && !document.hidden
      ? Promise.resolve()
      : new Promise<void>((r) => {
          resume = r;
        });

  const wake = () => {
    if (playing && inView && !document.hidden && resume) {
      const r = resume;
      resume = null;
      r();
    }
  };

  async function wait(ms: number, gen: number) {
    let left = ms;
    while (left > 0) {
      await gate();
      if (gen !== generation) throw new Cancelled();
      const step = Math.min(left, 80);
      await new Promise((r) => setTimeout(r, step));
      left -= step;
    }
    if (gen !== generation) throw new Cancelled();
  }

  const line = (cls: string, text = "") => {
    const el = document.createElement("span");
    el.className = `ln ${cls}`;
    el.textContent = text;
    term.append(el);
    while (term.childElementCount > 18) term.firstElementChild?.remove();
    return el;
  };

  async function type(cmd: string, gen: number) {
    term.querySelector(".ln--caret")?.remove();
    const el = line("ln--cmd ln--caret");
    const ps = document.createElement("span");
    ps.className = "ps";
    ps.textContent = "$";
    el.append(ps);
    const text = document.createTextNode("");
    el.append(text);
    await wait(380, gen);
    for (const ch of cmd) {
      text.data += ch;
      await wait(ch === " " ? 55 : 26 + Math.random() * 30, gen);
    }
    await wait(260, gen);
    el.classList.remove("ln--caret");
  }

  async function print(lines: string[], cls: string, gen: number, gap = 70) {
    for (const l of lines) {
      line(cls, l);
      await wait(gap, gen);
    }
  }

  function caret() {
    term.querySelector(".ln--caret")?.remove();
    const el = line("ln--cmd ln--caret");
    const ps = document.createElement("span");
    ps.className = "ps";
    ps.textContent = "$";
    el.append(ps);
  }

  async function run(gen: number) {
    for (;;) {
      term.textContent = "";
      set({ step: "idle", lit: "false", pop: "closed", cursor: "away", toast: "", keys: "off", flow: "off", audit: "off" });
      caret();
      await wait(500, gen);

      // 1. The agent sees nothing.
      await type("abg tabs --format text", gen);
      await print([demo.empty], "ln--dim", gen);
      caret();
      await wait(700, gen);

      // 2. The user shares the tab from the popup.
      set({ cursor: "ext" });
      await wait(700, gen);
      set({ pop: "open" });
      await wait(300, gen);
      set({ cursor: "button" });
      await wait(800, gen);
      set({ cursor: "press" });
      await wait(180, gen);
      set({ cursor: "button", lit: "true", step: "shared", toast: "shared" });
      await wait(1100, gen);
      set({ pop: "closed", cursor: "away" });
      await wait(500, gen);
      set({ toast: "" });

      // 3. The agent lists and reads the shared tab.
      await type("abg tabs --format text", gen);
      await print([demo.tabsLine], "ln--out", gen);
      caret();
      await wait(500, gen);
      await type("abg read t1 --format markdown", gen);
      set({ flow: "on" });
      await wait(450, gen);
      auditText.textContent = "read_dom · tab 418 · cli";
      set({ audit: "on" });
      await print(demo.md, "ln--md", gen, 110);
      set({ flow: "off" });
      caret();
      await wait(1500, gen);

      // 4. Revoke with the shortcut; the light goes out.
      set({ keys: "on", audit: "off" });
      await wait(900, gen);
      set({ keys: "off", lit: "false", step: "revoked", toast: "revoked" });
      auditText.textContent = "revoke · tab 418 · user_revoked";
      set({ audit: "on" });
      await wait(1100, gen);
      set({ toast: "" });

      // 5. The next read is refused.
      await type("abg read 418", gen);
      await print(demo.err, "ln--err", gen, 90);
      caret();
      await wait(2600, gen);
    }
  }

  function start() {
    generation += 1;
    const gen = generation;
    run(gen).catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
  }

  const label = (p: boolean) => (p ? toggle.dataset.labelPause : toggle.dataset.labelPlay) ?? "";
  const setPlaying = (p: boolean) => {
    playing = p;
    stage.dataset.playing = String(p);
    toggle.setAttribute("aria-label", label(p));
    toggle.setAttribute("aria-pressed", String(!p));
    if (p) wake();
  };

  toggle.hidden = false;
  toggle.addEventListener("click", () => setPlaying(!playing));
  setPlaying(true);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        wake();
      },
      { threshold: 0.15 },
    ).observe(stage);
  }
  document.addEventListener("visibilitychange", wake);
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      generation += 1;
      root.classList.remove("motion");
      toggle.hidden = true;
      showStatic();
    }
  });
  start();
}
setupStage();

/* ---------- Consent demo ---------- */
function setupConsent() {
  const card = document.querySelector<HTMLElement>("[data-consent]");
  if (!card) return;
  const out = card.querySelector<HTMLElement>("[data-consent-out]")!;
  const count = card.querySelector<HTMLElement>("[data-consent-count]")!;
  const live = card.querySelector<HTMLElement>("[data-consent-live]")!;
  const nav = card.querySelector<HTMLButtonElement>("[data-consent-navigate]")!;
  const reset = card.querySelector<HTMLButtonElement>("[data-consent-reset]")!;
  const chips = [...card.querySelectorAll<HTMLButtonElement>(".tabchip")];
  // Refs are assigned in share order and kept stable while the tab stays shared.
  const shared: { id: string; ref: string }[] = [];
  let nextRef = 1;

  const render = (fresh?: string) => {
    out.textContent = "";
    const cmd = document.createElement("span");
    cmd.className = "ln ln--cmd";
    cmd.innerHTML = '<span class="ps">$</span>';
    cmd.append("abg tabs --format text");
    out.append(cmd);
    if (shared.length === 0) {
      const l = document.createElement("span");
      l.className = "ln ln--dim";
      l.textContent = "No permitted tabs.";
      out.append(l);
    }
    for (const s of shared) {
      const chip = chips.find((c) => c.dataset.tabId === s.id)!;
      const l = document.createElement("span");
      l.className = "ln ln--out";
      if (s.id === fresh) l.classList.add("is-new");
      l.textContent = `${s.ref}  ${s.id}  manual  [${chip.dataset.title}]  ${chip.dataset.url}`;
      out.append(l);
    }
    count.textContent = String(shared.length);
    card.dataset.open = shared.length > 0 ? "true" : "false";
    nav.disabled = shared.length === 0;
  };

  const announce = (msg: string) => {
    live.textContent = msg;
  };

  const summary = () => {
    if (shared.length === 0) return live.dataset.none ?? "";
    const tpl = (shared.length === 1 ? live.dataset.some : live.dataset.many) ?? "";
    return tpl.replace("{n}", String(shared.length));
  };

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.tabId!;
      const idx = shared.findIndex((s) => s.id === id);
      if (idx >= 0) {
        shared.splice(idx, 1);
        chip.setAttribute("aria-pressed", "false");
        render();
      } else {
        shared.push({ id, ref: `t${nextRef++}` });
        chip.setAttribute("aria-pressed", "true");
        render(id);
      }
      announce(summary());
    });
  });

  nav.addEventListener("click", () => {
    const last = shared.pop();
    if (!last) return;
    const chip = chips.find((c) => c.dataset.tabId === last.id)!;
    chip.setAttribute("aria-pressed", "false");
    chip.classList.remove("is-revoked");
    void chip.offsetWidth;
    chip.classList.add("is-revoked");
    render();
    announce((live.dataset.revoked ?? "").replace("{tab}", chip.dataset.title ?? ""));
  });

  reset.addEventListener("click", () => {
    shared.length = 0;
    nextRef = 1;
    chips.forEach((c) => c.setAttribute("aria-pressed", "false"));
    render();
    announce(summary());
  });

  render();
}
setupConsent();

/* ---------- Annotation demo ---------- */
function setupAnno() {
  const anno = document.querySelector<HTMLElement>("[data-anno]");
  if (!anno) return;
  const status = anno.querySelector<HTMLElement>("[data-anno-status]")!;
  const reload = anno.querySelector<HTMLButtonElement>("[data-anno-reload]")!;
  const restore = anno.querySelector<HTMLButtonElement>("[data-anno-restore]")!;
  const again = anno.querySelector<HTMLButtonElement>("[data-anno-again]")!;
  reload.addEventListener("click", () => {
    anno.dataset.state = "reloaded";
    status.textContent = "";
    restore.focus();
  });
  restore.addEventListener("click", () => {
    anno.dataset.state = "restored";
    status.textContent = status.dataset.restored ?? "";
    again.focus();
  });
  again.addEventListener("click", () => {
    anno.dataset.state = "annotated";
    status.textContent = "";
    reload.focus();
  });
}
setupAnno();

/* ---------- Audit log ---------- */
function setupLog() {
  const log = document.querySelector<HTMLElement>("[data-log]");
  const body = log?.querySelector<HTMLTableSectionElement>("[data-log-body]");
  if (!log || !body || reduced.matches) return;
  const template = [...body.rows].map((r) => r.cloneNode(true) as HTMLTableRowElement);
  let i = 0;
  let clock = 9 * 3600 + 41 * 60 + 30;
  let timer = 0;
  let visible = false;
  const fmt = (s: number) =>
    [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const tick = () => {
    const row = template[i % template.length].cloneNode(true) as HTMLTableRowElement;
    clock += 3 + Math.floor(Math.random() * 7);
    row.cells[0].textContent = fmt(clock);
    row.classList.add("is-new");
    body.prepend(row);
    while (body.rows.length > 6) body.deleteRow(body.rows.length - 1);
    i += 1;
  };
  const schedule = () => {
    window.clearInterval(timer);
    if (visible && !document.hidden) timer = window.setInterval(tick, 2200);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    schedule();
  }).observe(log);
  document.addEventListener("visibilitychange", schedule);
}
setupLog();
