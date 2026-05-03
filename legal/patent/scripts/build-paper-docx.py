#!/usr/bin/env python3
"""Build a Word-check package for the ABG paper patent application.

The Markdown files remain the source of truth. This script emits a conservative
HTML file and, on macOS, converts it to DOCX with the system `textutil` command.
The generated DOCX is for visual checking and final Word cleanup before print.
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile
from xml.etree import ElementTree as ET
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = BASE_DIR / "out"
DEFAULT_HTML = "abg-patent-paper-package.html"
DEFAULT_DOCX = "abg-patent-paper-package.docx"
FIGURES_DIR = BASE_DIR / "figures"

SOURCE_FILES = [
    "01-petition.md",
    "02-specification.md",
    "03-claims.md",
    "04-abstract.md",
    "05-drawings.md",
]

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W_NS)
PAGE_BREAK_TITLES = {"明細書", "特許請求の範囲", "要約書", "図面"}


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def inline_markup(value: str) -> str:
    escaped = esc(value)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", escaped)
    return escaped


def table_block(lines: list[str], start: int) -> tuple[str, int] | None:
    if start + 1 >= len(lines):
        return None
    header = lines[start]
    separator = lines[start + 1]
    if "|" not in header or not re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", separator):
        return None

    rows: list[list[str]] = []
    i = start
    while i < len(lines) and "|" in lines[i].strip():
        if i != start + 1:
            row = [cell.strip() for cell in lines[i].strip().strip("|").split("|")]
            rows.append(row)
        i += 1

    if not rows:
        return None

    head, body = rows[0], rows[1:]
    out = ["<table>", "<thead><tr>"]
    out.extend(f"<th>{inline_markup(cell)}</th>" for cell in head)
    out.append("</tr></thead>")
    if body:
        out.append("<tbody>")
        for row in body:
            out.append("<tr>")
            out.extend(f"<td>{inline_markup(cell)}</td>" for cell in row)
            out.append("</tr>")
        out.append("</tbody>")
    out.append("</table>")
    return "\n".join(out), i


def render_markdown(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    in_pre = False
    in_ul = False
    in_ol = False
    i = 0

    def close_lists() -> None:
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_pre:
                out.append("</pre>")
                in_pre = False
            else:
                close_lists()
                out.append("<pre>")
                in_pre = True
            i += 1
            continue

        if in_pre:
            out.append(esc(line))
            i += 1
            continue

        if not stripped:
            close_lists()
            out.append("")
            i += 1
            continue

        table = table_block(lines, i)
        if table:
            close_lists()
            html_table, next_i = table
            out.append(html_table)
            i = next_i
            continue

        if stripped.startswith("# "):
            close_lists()
            out.append(f"<h1>{inline_markup(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            close_lists()
            out.append(f"<h2>{inline_markup(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            close_lists()
            out.append(f"<h3>{inline_markup(stripped[4:])}</h3>")
        elif stripped.startswith("- "):
            if not in_ul:
                close_lists()
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline_markup(stripped[2:])}</li>")
        elif re.match(r"^\d+\.\s+", stripped):
            if not in_ol:
                close_lists()
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{inline_markup(re.sub(r'^\d+\.\s+', '', stripped))}</li>")
        elif stripped.startswith("【"):
            close_lists()
            cls = "jpo-label"
            if stripped.startswith("【書類名】"):
                cls = "jpo-doc-name"
            out.append(f'<p class="{cls}">{inline_markup(stripped)}</p>')
        else:
            close_lists()
            out.append(f"<p>{inline_markup(stripped)}</p>")
        i += 1

    close_lists()
    if in_pre:
        out.append("</pre>")
    return "\n".join(out)


def figure_preview_html() -> str:
    figures = sorted(FIGURES_DIR.glob("fig-*.mmd"))
    if not figures:
        return ""

    out = [
        '<section class="figure-preview">',
        "<h2>図面プレビュー</h2>",
        "<p>Mermaid CLI により生成済みの画像がある場合は画像を表示し、未生成の場合は Mermaid 原稿を表示する。</p>",
    ]

    for src in figures:
        title = src.stem.replace("-", " ")
        png = src.with_suffix(".png")
        svg = src.with_suffix(".svg")
        out.append(f"<h3>{inline_markup(title)}</h3>")
        if png.exists():
            out.append(f'<p><img src="{png.resolve().as_uri()}" alt="{esc(src.stem)}"></p>')
        elif svg.exists():
            out.append(f'<p><img src="{svg.resolve().as_uri()}" alt="{esc(src.stem)}"></p>')
        else:
            source = src.read_text(encoding="utf-8")
            out.append(f'<div class="mermaid">{esc(source)}</div>')
            out.append("<details><summary>Mermaid source</summary>")
            out.append(f"<pre>{esc(source)}</pre>")
            out.append("</details>")

    out.append("</section>")
    return "\n".join(out)


def maybe_render_mermaid() -> None:
    if not shutil.which("mmdc"):
        return
    subprocess.run(["bash", "build.sh"], cwd=FIGURES_DIR, check=True)


def build_html() -> str:
    sections: list[str] = []
    for index, rel in enumerate(SOURCE_FILES):
        path = BASE_DIR / rel
        if not path.exists():
            raise FileNotFoundError(path)
        cls = "document-section" if index == 0 else "document-section page-break"
        rendered = render_markdown(path.read_text(encoding="utf-8"))
        if rel == "05-drawings.md":
            rendered = f"{rendered}\n{figure_preview_html()}"
        sections.append(f'<section class="{cls}">\n{rendered}\n</section>')

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>ABG Patent Paper Package</title>
  <style>
    @page {{
      size: A4;
      margin: 22mm 20mm 24mm;
    }}
    body {{
      color: #111;
      font-family: "Yu Mincho", "Hiragino Mincho ProN", "Times New Roman", serif;
      font-size: 10.5pt;
      line-height: 1.72;
    }}
    h1 {{
      font-size: 15pt;
      text-align: center;
      margin: 0 0 14pt;
    }}
    h2 {{
      font-size: 12pt;
      margin: 18pt 0 8pt;
    }}
    h3 {{
      font-size: 10.5pt;
      margin: 14pt 0 6pt;
    }}
    p {{
      margin: 0 0 7pt;
      text-align: justify;
    }}
    .jpo-doc-name {{
      font-weight: bold;
      margin-bottom: 14pt;
    }}
    .jpo-label {{
      margin-bottom: 7pt;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
      margin: 8pt 0 12pt;
      font-size: 9.3pt;
    }}
    th, td {{
      border: 1px solid #333;
      padding: 4pt 5pt;
      vertical-align: top;
    }}
    th {{
      font-weight: bold;
      background: #f2f2f2;
    }}
    ul, ol {{
      margin-top: 0;
      margin-bottom: 8pt;
      padding-left: 20pt;
    }}
    pre {{
      white-space: pre-wrap;
      border: 1px solid #bbb;
      padding: 8pt;
      font-family: Menlo, Consolas, monospace;
      font-size: 8.5pt;
    }}
    details {{
      margin: 0 0 12pt;
    }}
    summary {{
      cursor: pointer;
      font-weight: bold;
      margin: 4pt 0;
    }}
    .mermaid {{
      border: 1px solid #bbb;
      margin: 8pt 0 10pt;
      padding: 8pt;
      text-align: center;
      page-break-inside: avoid;
      background: #fff;
    }}
    .mermaid svg {{
      max-width: 100%;
      height: auto;
    }}
    img {{
      display: block;
      max-width: 100%;
      height: auto;
      margin: 6pt 0 14pt;
      page-break-inside: avoid;
    }}
    .figure-preview h3 {{
      page-break-after: avoid;
    }}
    code {{
      font-family: Menlo, Consolas, monospace;
      font-size: 0.92em;
    }}
    .page-break {{
      page-break-before: always;
      break-before: page;
    }}
  </style>
</head>
<body>
{chr(10).join(sections)}
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({{
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {{
      background: "#ffffff",
      primaryColor: "#ffffff",
      primaryTextColor: "#111111",
      primaryBorderColor: "#222222",
      lineColor: "#222222",
      fontFamily: "Arial, sans-serif"
    }}
  }});
  await mermaid.run({{ querySelector: ".mermaid" }});
</script>
</body>
</html>
"""


def convert_to_docx(html_path: Path, docx_path: Path) -> None:
    textutil = shutil.which("textutil")
    if not textutil:
        raise RuntimeError("textutil not found. HTML was generated, but DOCX conversion requires macOS textutil.")
    subprocess.run(
        [textutil, "-convert", "docx", "-output", str(docx_path), str(html_path)],
        check=True,
    )
    inject_page_breaks(docx_path)


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.findall(f".//{{{W_NS}}}t"))


def page_break_paragraph() -> ET.Element:
    paragraph = ET.Element(f"{{{W_NS}}}p")
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    br = ET.SubElement(run, f"{{{W_NS}}}br")
    br.set(f"{{{W_NS}}}type", "page")
    return paragraph


def inject_page_breaks(docx_path: Path) -> None:
    """Ensure each JPO document starts on a new page in textutil output."""
    tmp_path = docx_path.with_suffix(".tmp.docx")
    with ZipFile(docx_path, "r") as zin, ZipFile(tmp_path, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = ET.fromstring(data)
                body = root.find(f".//{{{W_NS}}}body")
                if body is None:
                    raise RuntimeError("word/document.xml has no w:body")
                next_children = []
                for child in list(body):
                    if child.tag == f"{{{W_NS}}}p" and paragraph_text(child) in PAGE_BREAK_TITLES:
                        next_children.append(page_break_paragraph())
                    next_children.append(child)
                for child in list(body):
                    body.remove(child)
                for child in next_children:
                    body.append(child)
                data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(item, data)
    tmp_path.replace(docx_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build ABG patent HTML/DOCX for paper filing checks.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--html-only", action="store_true", help="Only write HTML; skip DOCX conversion.")
    parser.add_argument("--skip-mermaid", action="store_true", help="Do not run figures/build.sh even when mmdc exists.")
    args = parser.parse_args()

    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    html_path = out_dir / DEFAULT_HTML
    docx_path = out_dir / DEFAULT_DOCX

    if not args.skip_mermaid:
        maybe_render_mermaid()

    html_path.write_text(build_html(), encoding="utf-8")
    print(f"wrote {html_path}")

    if not args.html_only:
        convert_to_docx(html_path, docx_path)
        print(f"wrote {docx_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
