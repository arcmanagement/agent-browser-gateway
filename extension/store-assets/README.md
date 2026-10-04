# Chrome Web Store assets

Generated assets for the Chrome Web Store listing. Upload them manually in the Developer
Dashboard; they are not part of the extension ZIP.

| File | Size | Use |
|---|---:|---|
| `store-icon-128.png` | 128x128 | Store icon |
| `screenshot-01-1280x800.png` | 1280x800 | Screenshot 1: share one tab from the popup; the agent lists only that tab |
| `screenshot-02-1280x800.png` | 1280x800 | Screenshot 2: a click waits in the local approval window |
| `screenshot-03-1280x800.png` | 1280x800 | Screenshot 3: `abg read` returns the shared tab as Markdown |
| `screenshot-04-1280x800.png` | 1280x800 | Screenshot 4: annotations on the page, listed by `abg annotate`, restorable after a reload |
| `screenshot-05-1280x800.png` | 1280x800 | Screenshot 5: loopback-only Gateway, menu bar list, and local audit log |
| `small-promo-440x280.png` | 440x280 | Small promotional tile |
| `marquee-promo-1400x560.png` | 1400x560 | Marquee promotional tile |

Upload the screenshots in numeric order. All images are opaque RGB PNGs at the exact store sizes,
with no metadata chunks.

## Screenshots and promo tiles

The layouts are HTML in `src/` (`screenshot-0N.html`, `small-promo.html`, `marquee-promo.html`,
shared styles in `src/store.css`, Geist fonts from `../public/fonts/`). The product UI inside them is
captured from the real extension, not redrawn:

- the popup and approval window from the built `dist/popup.html` and `dist/approval.html`, run
  against a `chrome.*` stub with fictional sample data (`src/stage/mock-chrome.js`);
- the annotation overlay from `src/annotationOverlay.ts` on a fictional shop page
  (`src/stage/checkout.html`);
- the Markdown in screenshot 03 by running `plugins/markdown-plugin` on that page, the transform
  `abg read --format markdown` uses.

The macOS menu in screenshot 05 is redrawn in HTML from `Sources/Gateway/MenuBarUI`. All sample
data uses `example.com` hosts and invented names.

Regenerate after changing the popup, approval window, overlay, or a layout:

```bash
cd extension
pnpm run build
node store-assets/render.mjs
```

`render.mjs` needs Node 22+, Google Chrome (override the path with `CHROME=...`), and the
extension's existing esbuild dev dependency. It never connects to a Gateway. Captures go to
`src/shots/` (git-ignored). `--capture` and `--compose` run one step; `ONLY=screenshot-03,small` composes a subset.

## Icons

The 16 px toolbar icon has its own simplified source, and the 128 px icons keep Chrome's 16 px
transparent padding around a 96 px mark:

```bash
cd extension/store-assets
rsvg-convert -w 16 -h 16 icon-source-16.svg -o ../public/icons/16.png
rsvg-convert -w 48 -h 48 icon-source.svg -o ../public/icons/48.png
rsvg-convert -w 96 -h 96 icon-source.svg -o /tmp/abg-icon-96.png
sips --padToHeightWidth 128 128 /tmp/abg-icon-96.png --out ../public/icons/128.png
cp ../public/icons/128.png store-icon-128.png
```

The macOS app icon is built by `build-app.sh` from `packaging/macos/AppIcon.svg`.
