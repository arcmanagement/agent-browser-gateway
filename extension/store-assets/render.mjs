#!/usr/bin/env node
// Regenerates the Chrome Web Store screenshots and promo tiles.
//
//   cd extension && pnpm run build && node store-assets/render.mjs
//
// 1. Capture: renders the real built extension pages (dist/popup.html, dist/approval.html) and the
//    real annotation overlay (src/annotationOverlay.ts) with fictional sample data from
//    src/stage/, at 2x, into src/shots/ (git-ignored). The Markdown in screenshot 03 is produced by
//    running plugins/markdown-plugin on the sample page, the same transform `abg read --format
//    markdown` uses.
// 2. Compose: renders each src/*.html layout at its exact store size (device scale 1) and writes
//    an opaque RGB PNG without metadata next to this script.
//
// Needs Node 22+ (global WebSocket), Google Chrome, and the extension's existing esbuild dev
// dependency. Nothing connects to a Gateway: the pages run against a chrome.* stub.
//
// Options: --capture runs only step 1; --compose runs only step 2 with the existing src/shots/;
// ONLY=screenshot-01,small composes a subset; CHROME=/path/to/chrome overrides the browser.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, "..");
const repoRoot = resolve(extRoot, "..");
const shotsDir = join(here, "src", "shots");
const composeOnly = process.argv.includes("--compose");
const captureOnly = process.argv.includes("--capture");
const chromePath =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const outputs = [
  { src: "screenshot-01.html", out: "screenshot-01-1280x800.png", w: 1280, h: 800 },
  { src: "screenshot-02.html", out: "screenshot-02-1280x800.png", w: 1280, h: 800 },
  { src: "screenshot-03.html", out: "screenshot-03-1280x800.png", w: 1280, h: 800 },
  { src: "screenshot-04.html", out: "screenshot-04-1280x800.png", w: 1280, h: 800 },
  { src: "screenshot-05.html", out: "screenshot-05-1280x800.png", w: 1280, h: 800 },
  { src: "small-promo.html", out: "small-promo-440x280.png", w: 440, h: 280 },
  { src: "marquee-promo.html", out: "marquee-promo-1400x560.png", w: 1400, h: 560 },
];

// ---------------------------------------------------------------------------------------------
// Static server rooted at the repository (extension/dist, extension/public/fonts, plugins, ...).

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(repoRoot, path);
  if (!file.startsWith(repoRoot) || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const urlFor = (abs) => `${origin}/${abs.slice(repoRoot.length + 1)}`;

// ---------------------------------------------------------------------------------------------
// Headless Chrome over the DevTools protocol.

const profile = mkdtempSync(join(tmpdir(), "abg-store-assets-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--font-render-hinting=none",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try {
    port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  } catch {}
}
if (!port) throw new Error(`Chrome did not start: ${chromePath}`);
const cdp = `http://127.0.0.1:${port}`;

async function openPage({ width, height, scale, scheme = "dark", init }) {
  const target = await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" }).then((r) =>
    r.json(),
  );
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { ok, fail } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? fail(new Error(JSON.stringify(data.error))) : ok(data.result);
    } else if (data.method === "Runtime.exceptionThrown") {
      errors.push(
        data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text,
      );
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const id = ++seq;
      pending.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails)
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  };
  const resize = (w, h) =>
    send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: scale,
      mobile: false,
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await resize(width, height);
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  if (init) await send("Page.addScriptToEvaluateOnNewDocument", { source: init });
  const goto = async (url) => {
    await send("Page.navigate", { url });
    await sleep(300);
    await evaluate(
      `new Promise((r) => document.readyState === "complete" ? r() : addEventListener("load", r, { once: true }))`,
    );
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate(
      `Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))`,
    );
    await sleep(250);
  };
  const capture = async () => {
    const { data } = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    return Buffer.from(data, "base64");
  };
  const close = () => {
    ws.close();
    return fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
  };
  return { send, evaluate, resize, goto, capture, close, errors };
}

const key = async (page, k, code) => {
  const extra = k === "Enter" ? { text: "\r" } : {};
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: k,
    code: k,
    windowsVirtualKeyCode: code,
    ...extra,
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: k,
    code: k,
    windowsVirtualKeyCode: code,
  });
  await sleep(120);
};
const drag = async (page, x0, y0, x1, y1) => {
  const ev = (type, x, y) =>
    page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
    });
  await ev("mousePressed", x0, y0);
  for (let i = 1; i <= 8; i++)
    await ev("mouseMoved", x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
  await ev("mouseReleased", x1, y1);
  await sleep(250);
};

// ---------------------------------------------------------------------------------------------
// 1. Capture product shots.

async function captureShots() {
  const dist = join(extRoot, "dist");
  if (!existsSync(join(dist, "popup.html")))
    throw new Error("extension/dist is missing. Run `pnpm run build` in extension/ first.");
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  const mock = readFileSync(join(here, "src", "stage", "mock-chrome.js"), "utf8");
  const withScenario = (scenario, lang = "en") =>
    `window.__ABG_SCENARIO = ${JSON.stringify(scenario)}; window.__ABG_LANG = ${JSON.stringify(lang)};\n${mock}`;
  const save = (name, buf) => writeFileSync(join(shotsDir, name), buf);

  // Popup: Chrome sizes the popup to its content, up to 800x600.
  for (const scenario of ["shared", "restore"]) {
    const page = await openPage({
      width: 800,
      height: 600,
      scale: 2,
      init: withScenario(scenario),
    });
    await page.goto(urlFor(join(dist, "popup.html")));
    const w = await page.evaluate(
      `(() => { const r = document.body.getBoundingClientRect(); const cs = getComputedStyle(document.body); return Math.ceil(r.width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight)); })()`,
    );
    await page.resize(Math.min(w, 800), 600);
    await sleep(250);
    save(`popup-${scenario}.png`, await page.capture());
    report(`popup-${scenario}`, page.errors);
    await page.close();
  }

  // Approval window: opens at 400 px wide and fits its own height.
  {
    const page = await openPage({
      width: 400,
      height: 272,
      scale: 2,
      init: withScenario("approval"),
    });
    await page.goto(`${urlFor(join(dist, "approval.html"))}?id=req-1`);
    // Headless windows have no frame, so use the smallest height without vertical overflow.
    for (let h = 240; h <= 600; h += 2) {
      await page.resize(400, h);
      if (await page.evaluate("document.documentElement.scrollHeight <= innerHeight")) break;
    }
    await sleep(250);
    save("approval.png", await page.capture());
    report("approval", page.errors);
    await page.close();
  }

  // Sample page, plain and with the real annotation overlay.
  const esbuild = join(extRoot, "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(here, "src", "stage", "overlay-entry.ts"),
    "--bundle",
    "--format=esm",
    "--target=es2022",
    `--outfile=${join(shotsDir, "overlay.js")}`,
    "--log-level=warning",
  ]);
  const pageUrl = urlFor(join(here, "src", "stage", "checkout.html"));
  const view = { width: 960, height: 560, scale: 2, scheme: "light" };
  {
    const page = await openPage(view);
    await page.goto(pageUrl);
    save("page-checkout.png", await page.capture());
    // Screenshot 03: the same transform `abg read t1 --selector aside --format markdown` runs.
    const html = await page.evaluate(`document.querySelector("aside").outerHTML`);
    const transforms = {};
    const abg = { registerTransform: (n, f) => (transforms[n] = f), log: () => {} };
    new Function(
      "abg",
      readFileSync(join(repoRoot, "plugins", "markdown-plugin", "index.js"), "utf8"),
    )(abg);
    writeFileSync(join(shotsDir, "read-aside.md"), transforms["html-to-markdown"](html));
    await page.close();
  }
  {
    // Narrower viewport so the overlay stays legible when scaled into the browser frame.
    const page = await openPage({ ...view, width: 800, height: 620 });
    await page.goto(pageUrl);
    await page.evaluate(
      `import(${JSON.stringify(urlFor(join(shotsDir, "overlay.js")))}).then(() => true)`,
    );
    await page.evaluate(`(async () => {
      await abgAnnotate({ action: "start" });
      await abgAnnotate({ action: "add_selector", selector: "#total", comment: "Add a tax line" });
      const host = document.getElementById("__abg_annotation_mode");
      host.shadowRoot.querySelector('[data-action="mode-text"]').click();
      const node = document.getElementById("returns").firstChild;
      const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, node.textContent.length - 1);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    await page.send("Input.insertText", { text: "Should be 60 days" });
    await key(page, "Enter", 13);
    await page.evaluate(`(() => {
      getSelection().removeAllRanges();
      document.getElementById("__abg_annotation_mode").shadowRoot.querySelector('[data-action="mode-area"]').click();
      return true;
    })()`);
    await sleep(150);
    const r = await page.evaluate(
      `(() => { const r = document.getElementById("shipping").getBoundingClientRect(); return { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }; })()`,
    );
    await drag(page, r.x, r.y, r.x + r.w, r.y + r.h);
    await page.send("Input.insertText", { text: "Add delivery date" });
    await sleep(200);
    save("page-annotated.png", await page.capture());
    // Save the third note, reload, and restore the saved notes the way the extension does
    // (it passes its session-storage snapshot as `saved`). Both results are kept for reference;
    // screenshot 04 prints the list in the format `abg annotate --format text` uses.
    await key(page, "Enter", 13);
    const listed = await page.evaluate(`abgAnnotate({ action: "list" })`);
    writeFileSync(join(shotsDir, "annotate-list.json"), JSON.stringify(listed, null, 2));
    await page.goto(pageUrl);
    await page.evaluate(
      `import(${JSON.stringify(urlFor(join(shotsDir, "overlay.js")))}).then(() => true)`,
    );
    const restored = await page.evaluate(
      `abgAnnotate({ action: "restore", saved: ${JSON.stringify(listed.annotations)} })`,
    );
    writeFileSync(join(shotsDir, "annotate-restore.json"), JSON.stringify(restored, null, 2));
    report("overlay", page.errors);
    await page.close();
  }
}

function report(name, errors) {
  if (errors.length) console.warn(`${name}: page errors: ${JSON.stringify(errors)}`);
  else console.log(`captured ${name}`);
}

// ---------------------------------------------------------------------------------------------
// 2. Compose store images.

async function compose() {
  const only = process.env.ONLY?.split(",");
  for (const o of outputs) {
    if (only && !only.some((n) => o.src.includes(n))) continue;
    const page = await openPage({ width: o.w, height: o.h, scale: 1 });
    await page.goto(urlFor(join(here, "src", o.src)));
    await page.evaluate(`window.__ready ?? true`);
    const png = toOpaquePng(await page.capture(), o.w, o.h);
    writeFileSync(join(here, o.out), png);
    console.log(`wrote ${o.out} (${o.w}x${o.h}, ${(png.length / 1024).toFixed(0)} KB)`);
    if (page.errors.length) console.warn(`${o.src}: page errors: ${JSON.stringify(page.errors)}`);
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------
// PNG: decode Chrome's 8-bit RGB(A) output and re-encode as RGB (color type 2) with only
// IHDR/IDAT/IEND, so the store images have no alpha channel and no metadata chunks.

function toOpaquePng(buf, w, h) {
  let off = 8;
  let ihdr;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = body;
    else if (type === "IDAT") idat.push(body);
    off += 12 + len;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  if (width !== w || height !== h)
    throw new Error(`unexpected capture size ${width}x${height}, want ${w}x${h}`);
  if (depth !== 8 || ihdr[12] !== 0 || (colorType !== 6 && colorType !== 2))
    throw new Error(`unsupported PNG (depth ${depth}, color ${colorType}, interlace ${ihdr[12]})`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      out[i] = v & 255;
    }
  }
  // Flatten onto black (the layouts are opaque, so alpha is 255 everywhere in practice).
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0, q = 0; p < pixels.length; p += bpp, q += 3) {
    const alpha = bpp === 4 ? pixels[p + 3] / 255 : 1;
    rgb[q] = Math.round(pixels[p] * alpha);
    rgb[q + 1] = Math.round(pixels[p + 1] * alpha);
    rgb[q + 2] = Math.round(pixels[p + 2] * alpha);
  }
  // Re-filter each row with the cheapest of the five filters (minimum sum of absolute values).
  const rs = width * 3;
  const filtered = Buffer.alloc(height * (rs + 1));
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(rs));
  for (let y = 0; y < height; y++) {
    const cur = rgb.subarray(y * rs, (y + 1) * rs);
    const prev = y ? rgb.subarray((y - 1) * rs, y * rs) : Buffer.alloc(rs);
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < rs; i++) {
        const a = i >= 3 ? cur[i - 3] : 0;
        const b = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        const pred =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[i] - pred) & 255;
        cand[f][i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    filtered[y * (rs + 1)] = best;
    cand[best].copy(filtered, y * (rs + 1) + 1);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
  let c = 0xffffffff;
  for (const byte of tb) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, tb, crc]);
}

// ---------------------------------------------------------------------------------------------

try {
  if (!composeOnly) await captureShots();
  else if (!existsSync(join(shotsDir, "popup-shared.png")))
    throw new Error("src/shots/ is empty; run without --compose first.");
  if (!captureOnly) await compose();
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
