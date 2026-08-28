#!/usr/bin/env python3
"""Publish only the KaTeX font faces exercised by this site's math corpus."""

from pathlib import Path
import re

SOURCE = Path("node_modules/katex/dist/katex.min.css")
TARGET = Path("assets/katex/katex.min.css")
KEEP = {
    "KaTeX_Main-Regular.woff2",
    "KaTeX_Main-Bold.woff2",
    "KaTeX_Math-Italic.woff2",
}

css = SOURCE.read_text(encoding="utf-8")
faces = re.findall(r"@font-face\{[^}]+\}", css)
kept = [face for face in faces if any(name in face for name in KEEP)]
kept = [
    re.sub(r',url\(fonts/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)', "", face)
    for face in kept
]
if len(kept) != len(KEEP):
    raise SystemExit(f"expected {len(KEEP)} retained font faces, found {len(kept)}")

css = re.sub(r"@font-face\{[^}]+\}", "", css)
TARGET.write_text("".join(kept) + css, encoding="utf-8")
print(f"wrote {TARGET}: {len(faces)} font faces -> {len(kept)}")
