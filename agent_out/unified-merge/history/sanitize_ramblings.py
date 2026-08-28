#!/usr/bin/env python3
"""Remove concrete comment-provider credentials from a checked-out history tree."""

from pathlib import Path
import re

path = Path("_config.yml")
if not path.is_file():
    raise SystemExit(0)

text = path.read_text(encoding="utf-8")
keys = r"(?:clientID|clientSecret|app_id|app_key)"
text = re.sub(
    rf"^(?P<indent>\s*)(?P<key>{keys})\s*:\s*(?P<value>[^#\r\n]*)(?P<comment>\s*#.*)?$",
    lambda match: f'{match.group("indent")}{match.group("key")}: ""{match.group("comment") or ""}',
    text,
    flags=re.MULTILINE,
)
path.write_text(text, encoding="utf-8")
