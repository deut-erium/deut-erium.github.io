#!/usr/bin/env python3
"""Port osec.io blog markdown into Jekyll posts for the WriteUps theme.

Transforms:
  - image / link paths  /posts/<slug>/<file>  ->  <file>  (jekyll-postfiles)
  - Vue widget tags     <ArithmeticCircuitWidget> -> <arithmetic-circuit-widget>
  - inline math         $...$  ->  $$...$$   (kramdown GFM span math)
    money amounts (inner text like "60M ...") are left literal
  - skips fenced code blocks
"""
import re
import sys

WIDGET_TAGS = {
    'ArithmeticCircuitWidget': 'arithmetic-circuit-widget',
    'PolynomialInterpolationPanel': 'poly-interpolation-panel',
    'DuskVerifierDependenceGraph': 'dusk-verifier-graph',
    'DuskKzgBatchOpeningWidget': 'dusk-kzg-batch-opening-widget',
}

MONEY = re.compile(r'\s*\d+(?:\.\d+)?[MBK]\b')


def convert_inline_math(line: str) -> str:
    # Mask display math $$...$$ so its dollars are never re-paired.
    masked = re.sub(r'\$\$(.+?)\$\$', lambda m: '\x00' + m.group(1) + '\x00', line)
    out = []
    i = 0
    n = len(masked)
    while i < n:
        ch = masked[i]
        if ch != '$':
            out.append(ch)
            i += 1
            continue
        j = masked.find('$', i + 1)
        if j == -1:
            out.append('$')  # unpaired (e.g. ~$60M): leave literal
            i += 1
            continue
        inner = masked[i + 1:j]
        if MONEY.match(inner):
            out.append('$')  # money pair: advance past the opening $ only
            i += 1
            continue
        out.append('$$' + inner + '$$')
        i = j + 1
    return ''.join(out).replace('\x00', '$$')


def transform(text: str, slug: str) -> str:
    out_lines = []
    in_fence = False
    for ln in text.split('\n'):
        # Only a pure fence line (``` or ```lang) toggles code-block state.
        # Commented fences like "<!--```mermaid" or "```-->" must not.
        if re.match(r'^\s*```[A-Za-z0-9_+.-]*\s*$', ln):
            in_fence = not in_fence
            out_lines.append(ln)
            continue
        if in_fence:
            out_lines.append(ln)
            continue
        # asset paths (markdown links and raw href attributes)
        ln = re.sub(r'\(/posts/' + re.escape(slug) + r'/([^)\s]+)\)', r'(\1)', ln)
        ln = re.sub(r'href="/posts/' + re.escape(slug) + r'/([^"]+)"', r'href="\1"', ln)
        # widget tags (self-closing or paired on one line)
        for vue, kebab in WIDGET_TAGS.items():
            ln = re.sub(r'<' + vue + r'\s*/>', f'<{kebab}></{kebab}>', ln)
            ln = re.sub(r'<' + vue + r'>', f'<{kebab}>', ln)
            ln = re.sub(r'</' + vue + r'>', f'</{kebab}>', ln)
        ln = convert_inline_math(ln)
        out_lines.append(ln)
    return '\n'.join(out_lines)


if __name__ == '__main__':
    src, slug = sys.argv[1], sys.argv[2]
    text = open(src, encoding='utf-8').read()
    sys.stdout.write(transform(text, slug))
