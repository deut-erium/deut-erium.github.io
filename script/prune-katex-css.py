#!/usr/bin/env python3
"""Publish KaTeX's WOFF2 faces without changing its layout rules.

Unused faces do not download. Keeping the full set avoids fallback glyphs when
an article uses a different delimiter size or mathematical alphabet.
"""

from pathlib import Path
import re
import shutil

SOURCE = Path("node_modules/katex/dist/katex.min.css")
TARGET = Path("assets/katex/katex.min.css")
css = SOURCE.read_text(encoding="utf-8")
faces = re.findall(r"@font-face\{[^}]+\}", css)
font_names = set(re.findall(r"url\(fonts/([^)]+\.woff2)\)", css))
if len(font_names) != len(faces) or not faces:
    raise SystemExit("expected one WOFF2 file per KaTeX face")

font_dir = TARGET.parent / "fonts"
font_dir.mkdir(exist_ok=True)
for name in sorted(font_names):
    shutil.copyfile(SOURCE.parent / "fonts" / name, font_dir / name)

kept = faces
kept = [
    re.sub(r',url\(fonts/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)', "", face)
    .replace("font-display:block", "font-display:swap")
    for face in kept
]
if any("font-display:block" in face for face in kept):
    raise SystemExit("retained KaTeX faces must not hide equations while loading")

css = re.sub(r"@font-face\{[^}]+\}", "", css)
TARGET.write_text("".join(kept) + css, encoding="utf-8")
print(f"wrote {TARGET}: {len(faces)} font faces -> {len(kept)}")
