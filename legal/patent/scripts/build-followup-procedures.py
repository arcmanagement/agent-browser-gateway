#!/usr/bin/env python3
"""Build JPO follow-up procedure HTML files for the ABG patent filing."""

from __future__ import annotations

import argparse
import html
import re
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = BASE_DIR / "out" / "followup"
SOURCE_FILES = [
    ("06-examination-request-reduced.md", "abg-examination-request-reduced.html"),
    ("07-super-early-examination-statement.md", "abg-super-early-examination-statement.html"),
]
ASCII_TO_FULLWIDTH = str.maketrans("0123456789", "０１２３４５６７８９")
SKIP_SECTION_PREFIXES = [
    "## 提出時確認メモ",
    "## 提出前確定事項",
]


def reiwa_date(today: datetime | None = None) -> str:
    today = today or datetime.now()
    year = today.year - 2018
    return f"令和　{year}年　{today.month}月　{today.day}日"


def normalize_jpo_labels(value: str) -> str:
    def full_digits(match: re.Match[str]) -> str:
        return f"【{match.group(1).translate(ASCII_TO_FULLWIDTH)}】"

    value = re.sub(r"【([0-9]{4})】", full_digits, value)
    return value


def strip_markdown(value: str) -> str:
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    return value


def html_line(value: str) -> str:
    value = normalize_jpo_labels(strip_markdown(value.strip()))
    return f"{html.escape(value, quote=False)}<BR>"


def render_source(path: Path, *, filing_date: str, examination_payment_number: str | None) -> list[str]:
    lines: list[str] = []
    skip_rest = False

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if any(line.startswith(prefix) for prefix in SKIP_SECTION_PREFIXES):
            skip_rest = True
        if skip_rest:
            continue
        if line.startswith("#"):
            continue
        if line.startswith("【提出日】"):
            line = f"【提出日】{filing_date}"
        if path.name == "06-examination-request-reduced.md" and line.startswith("【納付番号】") and examination_payment_number:
            line = f"【納付番号】{examination_payment_number}"
        lines.append(html_line(line))

    return lines


def build_html(lines: list[str]) -> bytes:
    html_text = "\r\n".join(
        [
            "<HTML>",
            "<HEAD>",
            '<META http-equiv="Content-Type" content="text/html; charset=Shift_JIS">',
            "</HEAD>",
            "<BODY>",
            *lines,
            "</BODY>",
            "</HTML>",
            "",
        ]
    )
    return html_text.encode("cp932")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build JPO follow-up procedure HTML files.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--date", default=reiwa_date(), help="JPO Japanese submission date text.")
    parser.add_argument("--examination-payment-number", help="Payment number for the examination request.")
    args = parser.parse_args()

    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    for source_name, output_name in SOURCE_FILES:
        source_path = BASE_DIR / source_name
        output_path = out_dir / output_name
        lines = render_source(
            source_path,
            filing_date=args.date,
            examination_payment_number=args.examination_payment_number,
        )
        output_path.write_bytes(build_html(lines))
        print(f"wrote {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
