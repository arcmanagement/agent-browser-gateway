# Chrome Web Store assets

Generated assets for the Chrome Web Store listing.

| File | Size | Use |
|---|---:|---|
| `store-icon-128.png` | 128x128 | Store icon |
| `small-promo-440x280.png` | 440x280 | Required small promotional tile |
| `screenshot-main-1280x800.png` | 1280x800 | Required screenshot |
| `marquee-promo-1400x560.png` | 1400x560 | Optional marquee promotional tile |

Regenerate after editing SVG sources. The 16 px toolbar icon has its own simplified source, and
the 128 px icons keep Chrome's 16 px transparent padding around a 96 px mark:

```bash
cd extension/store-assets
rsvg-convert -w 16 -h 16 icon-source-16.svg -o ../public/icons/16.png
rsvg-convert -w 48 -h 48 icon-source.svg -o ../public/icons/48.png
rsvg-convert -w 96 -h 96 icon-source.svg -o /tmp/abg-icon-96.png
sips --padToHeightWidth 128 128 /tmp/abg-icon-96.png --out ../public/icons/128.png
cp ../public/icons/128.png store-icon-128.png
rsvg-convert -w 440 -h 280 small-promo-440x280.svg -o small-promo-440x280.png
rsvg-convert -w 1280 -h 800 screenshot-main-1280x800.svg -o screenshot-main-1280x800.png
rsvg-convert -w 1400 -h 560 marquee-promo-1400x560.svg -o marquee-promo-1400x560.png
```

The macOS app icon is built by `build-app.sh` from `packaging/macos/AppIcon.svg`.
