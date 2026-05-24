#!/usr/bin/env python3
"""Build a JPO online-filing HTML package for the ABG patent application.

The generated HTML intentionally uses only the small tag set accepted by the
JPO internet filing software: BR plus IMG. The internet filing software remains
the final validator.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
FIGURES_DIR = BASE_DIR / "figures"
DEFAULT_OUT_DIR = BASE_DIR / "out" / "online"
DEFAULT_HTML = "abg-patent-online-application.html"
SOURCE_FILES = [
    "01-petition.md",
    "02-specification.md",
    "03-claims.md",
    "04-abstract.md",
]
SKIP_ONLINE_PREFIXES = [
    "【氏名の英字表記】",
]
FIGURE_FILES = [
    ("図1", "fig-1-system-overview.mmd"),
    ("図2", "fig-2-consent-lifecycle.mmd"),
    ("図3", "fig-3-auto-revoke-flow.mmd"),
    ("図4", "fig-4-message-flow.mmd"),
    ("図5", "fig-5-limited-tab-access.mmd"),
    ("図6", "fig-6-plugin-architecture.mmd"),
    ("図7", "fig-7-token-economy.mmd"),
    ("図8", "fig-8-annotation-overlay.mmd"),
    ("図9", "fig-9-ws-security.mmd"),
]
ASCII_TO_FULLWIDTH = str.maketrans("0123456789", "０１２３４５６７８９")


def reiwa_date(today: datetime | None = None) -> str:
    today = today or datetime.now()
    year = today.year - 2018
    return f"令和　{year}年　{today.month}月　{today.day}日"


def normalize_jpo_labels(value: str) -> str:
    def full_digits(match: re.Match[str]) -> str:
        return f"【{match.group(1).translate(ASCII_TO_FULLWIDTH)}】"

    def full_claim(match: re.Match[str]) -> str:
        return f"【請求項{match.group(1).translate(ASCII_TO_FULLWIDTH)}】"

    def full_figure_label(match: re.Match[str]) -> str:
        return f"【図{match.group(1).translate(ASCII_TO_FULLWIDTH)}】"

    def full_figure_text(match: re.Match[str]) -> str:
        return f"図{match.group(1).translate(ASCII_TO_FULLWIDTH)}"

    value = re.sub(r"【([0-9]{4})】", full_digits, value)
    value = re.sub(r"【請求項([0-9０-９]+)】", full_claim, value)
    value = re.sub(r"【図([0-9０-９]+)】", full_figure_label, value)
    value = re.sub(r"図([0-9])", full_figure_text, value)
    return value


def strip_markdown(value: str) -> str:
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    return value


def normalize_online_petition_line(value: str) -> str:
    if value.startswith("【住所又は居所】"):
        value = re.sub(r"^(【住所又は居所】)〒?[0-9０-９]{3}-[0-9０-９]{4}\s*", r"\1", value)
    return value


def html_line(value: str) -> str:
    value = normalize_jpo_labels(strip_markdown(normalize_online_petition_line(value.strip())))
    return f"{html.escape(value, quote=False)}<BR>"


def render_source(path: Path, *, filing_date: str) -> list[str]:
    lines: list[str] = []
    skip_rest = False

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if any(line.startswith(prefix) for prefix in SKIP_ONLINE_PREFIXES):
            continue
        if path.name == "01-petition.md" and line.startswith("【提出日】"):
            line = f"【提出日】{filing_date}"
        if path.name == "01-petition.md" and line.startswith("【その他】"):
            skip_rest = True
        if skip_rest:
            continue
        lines.append(html_line(line))

    return lines


def chrome_path() -> str | None:
    candidates = [
        os.environ.get("PUPPETEER_EXECUTABLE_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def mermaid_command(out_dir: Path, src: Path, raw_png: Path) -> list[str]:
    mmdc = shutil.which("mmdc")
    if mmdc:
        return [mmdc, "-i", str(src), "-o", str(raw_png), "--backgroundColor", "white", "--scale", "2"]

    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Neither mmdc nor npx is available for Mermaid rendering.")

    config_path = out_dir / "puppeteer-config.json"
    config: dict[str, object] = {"args": ["--no-sandbox"]}
    executable = chrome_path()
    if executable:
        config["executablePath"] = executable
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return [
        npx,
        "-y",
        "@mermaid-js/mermaid-cli",
        "-i",
        str(src),
        "-o",
        str(raw_png),
        "-b",
        "white",
        "--scale",
        "2",
        "-p",
        str(config_path),
    ]


def render_figure(src: Path, dest: Path, out_dir: Path) -> None:
    raw_png = dest.with_suffix(".raw.png")
    subprocess.run(mermaid_command(out_dir, src, raw_png), check=True)

    magick = shutil.which("magick")
    if not magick:
        raw_png.replace(dest)
        return

    subprocess.run(
        [
            magick,
            str(raw_png),
            "-background",
            "white",
            "-alpha",
            "remove",
            "-alpha",
            "off",
            "-colorspace",
            "Gray",
            "-resize",
            "2400x3600>",
            "-threshold",
            "88%",
            str(dest),
        ],
        check=True,
    )
    raw_png.unlink(missing_ok=True)


def ensure_figures(out_dir: Path, *, render: bool) -> list[tuple[str, Path]]:
    target_dir = out_dir / "figures"
    target_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[str, Path]] = []

    for figure_label, mermaid_name in FIGURE_FILES:
        src = FIGURES_DIR / mermaid_name
        if not src.exists():
            raise FileNotFoundError(src)
        dest = target_dir / src.with_suffix(".png").name
        if render or not dest.exists():
            render_figure(src, dest, out_dir)
        rendered.append((figure_label, dest))

    return rendered


def render_drawings(figures: list[tuple[str, Path]], out_dir: Path) -> list[str]:
    lines = [html_line("【書類名】図面")]
    for figure_label, image_path in figures:
        rel = image_path.relative_to(out_dir).as_posix()
        full_label = figure_label.translate(ASCII_TO_FULLWIDTH)
        lines.append(html_line(f"【{full_label}】"))
        lines.append(f'<IMG SRC="{html.escape(rel, quote=True)}"><BR>')
    return lines


def build_html(out_dir: Path, *, filing_date: str, render_figures: bool) -> bytes:
    body_lines: list[str] = []
    for rel in SOURCE_FILES:
        body_lines.extend(render_source(BASE_DIR / rel, filing_date=filing_date))

    figures = ensure_figures(out_dir, render=render_figures)
    body_lines.extend(render_drawings(figures, out_dir))

    html_text = "\r\n".join(
        [
            "<HTML>",
            "<HEAD>",
            '<META http-equiv="Content-Type" content="text/html; charset=Shift_JIS">',
            "</HEAD>",
            "<BODY>",
            *body_lines,
            "</BODY>",
            "</HTML>",
            "",
        ]
    )
    return html_text.encode("cp932")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build JPO online-filing HTML for the ABG patent application.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--output", default=DEFAULT_HTML)
    parser.add_argument("--date", default=reiwa_date(), help="JPO Japanese filing date text.")
    parser.add_argument("--reuse-figures", action="store_true", help="Reuse existing rendered figure PNGs.")
    args = parser.parse_args()

    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    html_path = out_dir / args.output
    html_bytes = build_html(out_dir, filing_date=args.date, render_figures=not args.reuse_figures)
    html_path.write_bytes(html_bytes)
    (out_dir / "puppeteer-config.json").unlink(missing_ok=True)
    print(f"wrote {html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
