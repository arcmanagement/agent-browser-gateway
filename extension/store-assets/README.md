# Chrome Web Store assets

Generated assets for the Chrome Web Store listing.

| File | Size | Use |
|---|---:|---|
| `store-icon-128.png` | 128x128 | Store icon |
| `small-promo-440x280.png` | 440x280 | Required small promotional tile |
| `screenshot-main-1280x800.png` | 1280x800 | Required screenshot |
| `marquee-promo-1400x560.png` | 1400x560 | Optional marquee promotional tile |

Regenerate after editing SVG sources:

```bash
cd extension/store-assets
rsvg-convert -w 128 -h 128 icon-source.svg -o store-icon-128.png
rsvg-convert -w 16 -h 16 icon-source.svg -o ../public/icons/16.png
rsvg-convert -w 48 -h 48 icon-source.svg -o ../public/icons/48.png
rsvg-convert -w 128 -h 128 icon-source.svg -o ../public/icons/128.png
rsvg-convert -w 440 -h 280 small-promo-440x280.svg -o small-promo-440x280.png
rsvg-convert -w 1280 -h 800 screenshot-main-1280x800.svg -o screenshot-main-1280x800.png
rsvg-convert -w 1400 -h 560 marquee-promo-1400x560.svg -o marquee-promo-1400x560.png
```
