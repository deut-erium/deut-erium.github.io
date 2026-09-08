#!/usr/bin/env python3
"""Bundle local assets into a private HTML body; never fetch network resources."""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
import hashlib
import html
from html.parser import HTMLParser
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.parse import unquote, unquote_to_bytes, urlsplit, quote
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]
SPACE = ' \t\r\n\f'
MIME = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.css': 'text/css',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.bin': 'application/octet-stream',
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
    **{ext: 'text/plain' for ext in ('.py', '.sage', '.rs', '.c', '.h', '.cpp', '.js', '.mjs', '.sh')},
}
BLOCKED = {'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base',
           'meta', 'html', 'head', 'body', 'title', 'template', 'noscript', 'foreignobject',
           'xmp', 'plaintext', 'noembed', 'noframes', 'textarea', 'form', 'select',
           'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'annotation-xml'}
VOID = {'area', 'br', 'col', 'hr', 'img', 'input', 'link', 'param', 'source', 'track', 'wbr'}
SVG_URL_ATTRS = {'fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor',
                'marker', 'marker-start', 'marker-mid', 'marker-end'}
UNSUPPORTED_ATTRS = {'srcdoc', 'ping', 'codebase', 'archive', 'classid', 'data', 'lowsrc', 'dynsrc',
                     'data-src', 'data-srcset', 'data-lazy-src', 'data-original', 'xml:base', 'base', 'manifest', 'imagesrcset', 'imagesizes', 'profile', 'action', 'formaction'}

class BundleError(ValueError):
    pass


def private_path(path: Path) -> Path:
    """Reject public checkout paths, including misleading nested agent_out names."""
    real = path.resolve()
    for candidate in (Path(os.path.abspath(path)), path.parent.resolve() / path.name, real):
        if candidate.is_relative_to(REPO) and not candidate.is_relative_to(REPO / 'agent_out'):
            raise BundleError('plaintext and asset roots must be outside the checkout or under its top-level agent_out/')
    return real


def bounded_read(path: Path, limit: int) -> bytes:
    if not path.is_file(): raise BundleError('input/asset must be a regular file')
    with path.open('rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise BundleError('assets must be regular files')
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise BundleError(f'file exceeds the {limit}-byte limit: {path.name}')
    return data


def css_escape(text: str, i: int) -> tuple[str, int]:
    i += 1
    if i == len(text): raise BundleError('unfinished CSS escape')
    if text[i] in '\r\n\f':
        if text[i:i+2] == '\r\n': return '', i + 2
        return '', i + 1
    match = re.match(r'[0-9a-fA-F]{1,6}', text[i:])
    if match:
        value = int(match[0], 16); i += len(match[0])
        if i < len(text) and text[i] in SPACE:
            i += 2 if text[i:i+2] == '\r\n' else 1
        if value == 0 or value > 0x10ffff or 0xd800 <= value <= 0xdfff:
            raise BundleError('invalid CSS character escape')
        return chr(value), i
    return text[i], i + 1


def css_string(text: str, i: int) -> tuple[str, int]:
    quote = text[i]; i += 1; out = []
    while i < len(text):
        if text[i] == quote: return ''.join(out), i + 1
        if text[i] in '\r\n\f': raise BundleError('unescaped newline in CSS string')
        if text[i] == '\\':
            value, i = css_escape(text, i); out.append(value)
        else: out.append(text[i]); i += 1
    raise BundleError('unfinished CSS string')


def css_ident(text: str, i: int) -> tuple[str, int]:
    out = []
    while i < len(text):
        c = text[i]
        if c == '\\':
            value, i = css_escape(text, i); out.append(value)
        elif c.isalnum() or c in '_-' or ord(c) >= 128:
            out.append(c); i += 1
        else: break
    return ''.join(out), i


def css_space(text: str, i: int) -> int:
    while i < len(text):
        if text[i] in SPACE: i += 1
        elif text.startswith('/*', i):
            end = text.find('*/', i + 2)
            if end < 0: raise BundleError('unfinished CSS comment')
            i = end + 2
        else: break
    return i


def css_url(text: str, i: int) -> tuple[str, int]:
    """Read an already recognized url( token; i points just after (."""
    i = css_space(text, i)
    if i < len(text) and text[i] in '\"\'':
        value, i = css_string(text, i); i = css_space(text, i)
    else:
        out = []
        while i < len(text) and text[i] != ')':
            if text[i] in SPACE:
                i = css_space(text, i); break
            if text[i] in '\"\'(' or text.startswith('/*', i):
                raise BundleError('CSS URLs must be literal strings or unquoted URLs')
            if text[i] == '\\':
                value, i = css_escape(text, i); out.append(value)
            else: out.append(text[i]); i += 1
        value = ''.join(out)
    if i >= len(text) or text[i] != ')': raise BundleError('malformed CSS url()')
    return value, i + 1


def srcset_items(value: str) -> list[tuple[str, str]]:
    """Tokenize URL candidates without splitting commas inside data URLs."""
    items = []; i = 0; descriptors = set(); kind = None
    while i < len(value):
        while i < len(value) and value[i] in SPACE + ',': i += 1
        if i == len(value): break
        start = i
        while i < len(value) and value[i] not in SPACE: i += 1
        url = value[start:i]
        if url.endswith(','):
            url = url.rstrip(','); desc = ''
        else:
            start = i
            while i < len(value) and value[i] != ',': i += 1
            desc = value[start:i].strip(SPACE)
            if i < len(value): i += 1
        if not url: raise BundleError('empty srcset candidate')
        if desc:
            if not re.fullmatch(r'(?:[1-9][0-9]*w|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)x)', desc):
                raise BundleError('unsupported srcset descriptor')
            current = desc[-1]; number = float(desc[:-1])
            if number <= 0: raise BundleError('srcset density must be positive')
        else: current = 'x'; number = 1.0
        if kind and kind != current: raise BundleError('mixed width/density srcset descriptors')
        if (current, number) in descriptors: raise BundleError('duplicate srcset descriptor')
        kind = current; descriptors.add((current, number)); items.append((url, desc))
        if len(items) > 128: raise BundleError('too many srcset candidates')
    if not items: raise BundleError('empty srcset')
    return items


@dataclass
class BundleResult:
    html: str
    assets: list[dict]
    retained_links: int


class Bundler:
    def __init__(self, root: Path, *, linked_files=False, max_asset_bytes=8*1024*1024,
                 max_output_bytes=16*1024*1024):
        self.root = private_path(root)
        if not self.root.is_dir(): raise BundleError('asset root is not a directory')
        if max_asset_bytes <= 0 or max_output_bytes <= 0: raise BundleError('byte limits must be positive')
        self.max_asset = max_asset_bytes; self.max_output = max_output_bytes
        self.linked_files = linked_files
        self.cache = {}; self.active = set(); self.assets = []; self.read_bytes = 0; self.asset_reads = 0
        self.retained_links = 0; self.depth = 0

    def limit(self, text: str) -> str:
        if len(text.encode('utf-8')) > self.max_output: raise BundleError('expanded HTML/CSS/SVG exceeds the output byte limit')
        return text

    def resolve(self, ref: str, base: Path) -> Path:
        if '\\' in ref or any(ord(c) < 32 or ord(c) == 127 for c in ref):
            raise BundleError('control characters and backslashes are not allowed in asset URLs')
        parts = urlsplit(ref)
        if parts.scheme or parts.netloc or ref.startswith('//'): raise BundleError('remote/file-scheme assets are not fetched; save them inside the private asset root first')
        name = unquote(parts.path, errors='strict')
        if not name or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise BundleError('invalid local asset path')
        path = Path(os.path.abspath(self.root / name.lstrip('/') if name.startswith('/') else base.parent / name))
        if not path.is_relative_to(self.root) or not path.resolve().is_relative_to(self.root): raise BundleError('asset escapes the configured root (including through a symlink)')
        if not path.is_file(): raise BundleError(f'asset not found: {path.relative_to(self.root)}')
        return path

    def _check_type(self, mime: str, kind: str, data: bytes):
        allowed = (mime in MIME.values() if kind == 'download' else
                   mime.startswith('image/') if kind == 'image' else
                   mime.startswith(('image/', 'font/')) if kind == 'css-url' else
                   mime.startswith(('audio/', 'video/')) if kind == 'media' else
                   mime == 'text/vtt' if kind == 'track' else mime == 'text/css')
        if not allowed: raise BundleError(f'unsupported {mime} asset for {kind}')
        signatures = {'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff',
                      'font/woff': b'wOFF', 'font/woff2': b'wOF2', 'font/ttf': b'\x00\x01\x00\x00',
                      'font/otf': b'OTTO', 'image/x-icon': b'\x00\x00\x01\x00'}
        if mime in signatures and not data.startswith(signatures[mime]): raise BundleError(f'file signature does not match {mime}')
        if mime == 'image/gif' and not data.startswith((b'GIF87a', b'GIF89a')): raise BundleError('invalid GIF signature')
        if mime == 'image/webp' and not (data[:4] == b'RIFF' and data[8:12] == b'WEBP'): raise BundleError('invalid WebP signature')

    def resource(self, ref: str, base: Path, kind: str) -> str:
        ref = ref.strip(SPACE)
        if not ref: raise BundleError('empty asset reference')
        if ref.startswith('#'):
            if kind != 'css-url': raise BundleError('fragment-only image/media source is unsupported')
            return '#' + quote(unquote(ref[1:], errors='strict'), safe='-._~=:,/')
        self.depth += 1
        if self.depth > 16: raise BundleError('asset dependency depth exceeds 16')
        try:
            if ref.lower().startswith('data:'):
                wire, _, fragment = ref.partition('#')
                header, comma, payload = wire[5:].partition(',')
                if not comma: raise BundleError('malformed data URI')
                fields = header.split(';'); mime = fields.pop(0).lower()
                if any(x.lower() not in ('base64', 'charset=utf-8', 'charset=us-ascii') for x in fields):
                    raise BundleError('unsupported data URI parameters')
                if len(payload) > 4 * self.max_asset: raise BundleError('data URI exceeds the asset byte limit')
                try:
                    raw = unquote_to_bytes(payload)
                    data = base64.b64decode(raw, validate=True) if 'base64' in [x.lower() for x in fields] else raw
                except ValueError as error: raise BundleError('malformed base64 data URI') from error
                if len(data) > self.max_asset: raise BundleError('data URI exceeds the asset byte limit')
                return self._encode(data, mime, base, kind, fragment)
            parts = urlsplit(ref)
            path = self.resolve(ref, base)
            mime = MIME.get(path.suffix.lower())
            if not mime: raise BundleError(f'unsupported asset extension: {path.suffix}')
            key = (path, kind)
            canonical = path.resolve()
            if canonical in self.active: raise BundleError('cyclic asset dependency')
            if key not in self.cache:
                if self.asset_reads >= 128: raise BundleError('more than 128 asset reads')
                self.asset_reads += 1  # Reserve the read before following nested imports.
                data = bounded_read(path, self.max_asset)
                self.read_bytes += len(data)
                if self.read_bytes > 2 * self.max_output: raise BundleError('total asset reads exceed the byte budget')
                self.active.add(canonical)
                try: encoded = self._encode(data, mime, path, kind, '')
                finally: self.active.remove(canonical)
                self.cache[key] = encoded
                self.assets.append({'path': path.relative_to(self.root).as_posix(), 'mime': mime,
                                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            return self.limit(self.cache[key] + ('#' + quote(unquote(parts.fragment, errors='strict'), safe='-._~=:,/') if parts.fragment else ''))
        finally: self.depth -= 1

    def _encode(self, data: bytes, mime: str, base: Path, kind: str, fragment: str) -> str:
        self._check_type(mime, kind, data)
        if mime in ('text/css', 'image/svg+xml'):
            try: text = data.decode('utf-8-sig')
            except UnicodeDecodeError as error: raise BundleError('CSS/SVG assets must use UTF-8') from error
            data = (self.css(text, base) if mime == 'text/css' else self.svg(text, base)).encode()
        value = 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')
        return self.limit(value + ('#' + quote(unquote(fragment, errors='strict'), safe='-._~=:,/') if fragment else ''))

    def css(self, text: str, base: Path) -> str:
        out = []; i = 0; size = 0
        def add(value):
            nonlocal size
            size += len(value.encode())
            if size > self.max_output: raise BundleError('expanded CSS exceeds the output byte limit')
            out.append(value)
        while i < len(text):
            start = i
            if text.startswith('/*', i):
                end = text.find('*/', i + 2)
                if end < 0: raise BundleError('unfinished CSS comment')
                i = end + 2; add(text[start:i]); continue
            if text[i] in '\"\'':
                _, i = css_string(text, i); add(text[start:i]); continue
            at = text[i] == '@'
            if at or text[i].isalpha() or text[i] in '_-\\':
                name, end = css_ident(text, i + 1 if at else i)
                if end == i or (at and end == i + 1): add(text[i]); i += 1; continue
                lower = name.lower()
                if at and lower == 'import':
                    pos = css_space(text, end)
                    if pos < len(text) and text[pos] in '\"\'': value, i = css_string(text, pos)
                    else:
                        token, pos = css_ident(text, pos)
                        if token.lower() != 'url' or pos >= len(text) or text[pos] != '(':
                            raise BundleError('CSS @import needs a literal local URL')
                        value, i = css_url(text, pos + 1)
                    add('@import url("' + self.resource(value, base, 'css') + '")'); continue
                if not at and lower == 'url' and end < len(text) and text[end] == '(':
                    value, i = css_url(text, end + 1)
                    add('url("' + self.resource(value, base, 'css-url').replace('"', '%22') + '")'); continue
                if not at and lower in {'image-set', '-webkit-image-set', 'image', 'src', 'paint', 'expression', 'attr'} and end < len(text) and text[end] == '(':
                    raise BundleError(f'unsupported dynamic/implicit CSS asset function: {lower}()')
                add(text[start:end]); i = end; continue
            add(text[i]); i += 1
        return ''.join(out)

    def svg(self, text: str, base: Path) -> str:
        if re.search(r'<!\s*(?:DOCTYPE|ENTITY)', text, re.I) or '<?xml-stylesheet' in text.lower():
            raise BundleError('SVG doctypes/entities/stylesheet instructions are unsupported')
        if text.count('<') > 20000: raise BundleError('SVG has too many elements')
        try: root = ET.fromstring(text)
        except ET.ParseError as error: raise BundleError('invalid SVG XML') from error
        if root.tag != '{http://www.w3.org/2000/svg}svg': raise BundleError('SVG root must declare the SVG namespace')
        todo = [(root, 0)]
        while todo:
            element, depth = todo.pop()
            if depth > 64: raise BundleError('SVG nesting is too deep')
            if not element.tag.startswith('{http://www.w3.org/2000/svg}'):
                raise BundleError('foreign SVG element namespace is unsupported')
            tag = element.tag.split('}', 1)[-1].lower()
            if tag in BLOCKED - {'title'}: raise BundleError(f'unsupported active SVG element: {tag}')
            attrs = [(name.replace('{http://www.w3.org/1999/xlink}', 'xlink:')
                      .replace('{http://www.w3.org/XML/1998/namespace}', 'xml:'), value)
                     for name, value in element.attrib.items()]
            changed = self.attributes(tag, attrs, base, svg=True)
            for old, (_, value) in zip(list(element.attrib), changed): element.attrib[old] = value or ''
            if tag == 'style': element.text = self.css(element.text or '', base)
            todo.extend((child, depth + 1) for child in element)
        return self.limit(ET.tostring(root, encoding='unicode'))

    def link(self, value: str, base: Path, download: bool) -> tuple[str, str | None]:
        clean = value.strip(SPACE); parts = urlsplit(clean)
        if download or (self.linked_files and not parts.scheme and not parts.netloc and not clean.startswith('//') and Path(unquote(parts.path)).suffix.lower() in MIME):
            packed = self.resource(clean, base, 'download')
            name = Path(unquote(parts.path)).name if parts.scheme.lower() != 'data' else 'attachment'
            return packed, name or 'attachment'
        if parts.scheme.lower() not in ('', 'http', 'https', 'mailto', 'tel') or '\\' in clean or any(ord(c) < 32 for c in clean):
            raise BundleError('unsupported active hyperlink URL')
        self.retained_links += 1
        return value, None

    def attributes(self, tag: str, attrs: list[tuple[str, str | None]], base: Path, *, svg=False):
        names = [name.lower() for name, _ in attrs]
        if len(set(names)) != len(names): raise BundleError('duplicate HTML/SVG attributes')
        values = dict(zip(names, (v for _, v in attrs)))
        out = []; download_name = None
        for name, value in attrs:
            key = name.lower()
            if key.startswith('on') or key in UNSUPPORTED_ATTRS:
                raise BundleError(f'unsupported active/resource attribute: {key}')
            if value is None:
                if key in {'src', 'srcset', 'href', 'xlink:href', 'poster', 'background'}:
                    raise BundleError(f'empty resource attribute: {key}')
                out.append((name, value)); continue
            if key == 'style' or (svg and key in SVG_URL_ATTRS): value = self.css(value, base)
            elif key == 'srcset':
                if tag not in {'img', 'source'}: raise BundleError('srcset is only supported on img/source')
                items = []; size = 0
                for url, descriptor in srcset_items(value):
                    candidate = self.resource(url, base, 'image') + (' ' + descriptor if descriptor else '')
                    size += len(candidate.encode()) + 2
                    if size > self.max_output: raise BundleError('expanded srcset exceeds the output byte limit')
                    items.append(candidate)
                value = ', '.join(items)
            elif key == 'src':
                kind = 'image' if tag == 'img' or (tag == 'input' and (values.get('type') or '').lower() == 'image') else 'media' if tag in {'audio', 'video', 'source'} else 'track' if tag == 'track' else None
                if not kind: raise BundleError(f'unsupported src on {tag}')
                value = self.resource(value, base, kind)
            elif key == 'poster' or key == 'background': value = self.resource(value, base, 'image')
            elif key in {'href', 'xlink:href'}:
                if svg and tag in {'image', 'feimage'}: value = self.resource(value, base, 'image')
                elif tag in {'a', 'area'}: value, download_name = self.link(value, base, 'download' in values)
                elif svg and value.startswith('#'): pass
                else: raise BundleError(f'unsupported external reference on {tag}; inline SVG symbols first')
            out.append((name, value))
        if svg and download_name is not None: raise BundleError('SVG attachment links are unsupported; use an HTML download link')
        if download_name is not None:
            if 'download' not in values: out.append(('download', download_name))
            else: out = [(name, download_name if name.lower() == 'download' and not value else value) for name, value in out]
        return out

    def html(self, text: str, base: Path) -> str:
        if re.search(r'<!--(?:>|->)', text) or '--!>' in text:
            raise BundleError('malformed HTML comments are unsupported')
        parser = BodyParser(self, base)
        try:
            parser.feed(text); parser.close()
        except AssertionError as error:
            raise BundleError('malformed HTML declaration') from error
        if parser.style is not None: raise BundleError('unclosed style element')
        return ''.join(parser.output)


class BodyParser(HTMLParser):
    def __init__(self, bundler: Bundler, base: Path):
        super().__init__(convert_charrefs=False)
        self.bundler = bundler; self.base = base; self.output = []; self.size = 0
        self.stack = []; self.style = None

    def add(self, value: str):
        self.size += len(value.encode())
        if self.size > self.bundler.max_output: raise BundleError('expanded HTML exceeds the output byte limit')
        self.output.append(value)

    def handle_starttag(self, tag, attrs): self.start(tag, attrs, False)
    def handle_startendtag(self, tag, attrs): self.start(tag, attrs, True)

    def start(self, tag, attrs, closed):
        if tag == 'style' and any(t in self.stack for t in ('svg', 'math')):
            raise BundleError('inline SVG style / MathML style elements are unsupported; use an outer HTML stylesheet')
        if tag in BLOCKED and not (tag == 'title' and 'svg' in self.stack): raise BundleError(f'unsupported active/document element: {tag}; supply a passive HTML body')
        raw = self.get_starttag_text()
        # Preserve SVG attribute capitalization while checking against HTMLParser's values.
        match = re.match(r'<([A-Za-z][A-Za-z0-9:-]*)', raw)
        if not match: raise BundleError('unsupported element name')
        original_tag = match[1]; pos = match.end(); originals = []
        while pos < len(raw):
            while pos < len(raw) and raw[pos] in SPACE: pos += 1
            if raw[pos:] in ('>', '/>'): break
            token = re.match(r'[A-Za-z_:][A-Za-z0-9_.:-]*', raw[pos:])
            if not token: raise BundleError('unsupported attribute syntax')
            name = token[0]; pos += len(name)
            while pos < len(raw) and raw[pos] in SPACE: pos += 1
            if pos < len(raw) and raw[pos] == '=':
                pos += 1
                while pos < len(raw) and raw[pos] in SPACE: pos += 1
                if pos < len(raw) and raw[pos] in '\"\'':
                    quote = raw[pos]; pos += 1; end = raw.find(quote, pos)
                    if end < 0: raise BundleError('unclosed attribute quote')
                    pos = end + 1
                else:
                    while pos < len(raw) and raw[pos] not in SPACE + '>': pos += 1
            originals.append(name)
        if [n.lower() for n in originals] != [n for n, _ in attrs]: raise BundleError('ambiguous attribute syntax')
        attrs = list(zip(originals, (value for _, value in attrs)))
        if tag == 'link':
            values = {k.lower(): v for k, v in attrs}
            if len(values) != len(attrs) or (values.get('rel') or '').lower().split() != ['stylesheet'] or not values.get('href'):
                raise BundleError('only local stylesheet links are supported in an HTML body')
            if set(values) - {'rel', 'href', 'media', 'type', 'title'}: raise BundleError('unsupported stylesheet link attributes')
            uri = self.bundler.resource(values['href'], self.base, 'css')
            css = base64.b64decode(uri.split(',', 1)[1].split('#', 1)[0]).decode()
            # CSS string content must not terminate the newly inserted HTML style element.
            css = re.sub(r'</style', lambda m: '\\3c ' + m[0][1:], css, flags=re.I)
            extra = ''.join(f' {k}="{html.escape(v, quote=True)}"' for k, v in values.items() if k in {'media', 'title'} and v is not None)
            self.add('<style' + extra + '>' + css + '</style>'); return
        svg = tag == 'svg' or 'svg' in self.stack
        attrs = self.bundler.attributes(tag, attrs, self.base, svg=svg)
        rendered = ''.join(' ' + name + ('' if value is None else '="' + html.escape(value, quote=True) + '"') for name, value in attrs)
        self.add('<' + original_tag + rendered + ('/>' if closed else '>'))
        if tag == 'style':
            if closed: raise BundleError('style elements need explicit closing tags')
            self.style = []
        if tag not in VOID and not closed: self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag == 'style' and self.style is not None:
            self.add(self.bundler.css(''.join(self.style), self.base)); self.style = None
        if tag in self.stack: self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
        self.add('</' + tag + '>')

    def handle_data(self, data):
        if self.style is not None: self.style.append(data)
        else: self.add(data)
    def handle_entityref(self, name): self.add('&' + name + ';')
    def handle_charref(self, name): self.add('&#' + name + ';')
    def handle_comment(self, data): self.add('<!--' + data + '-->')
    def handle_decl(self, decl): raise BundleError('supply an HTML body, not a document/doctype')
    def handle_pi(self, data): raise BundleError('processing instructions are unsupported in the HTML body')
    def unknown_decl(self, data): raise BundleError('unsupported HTML declaration')


def bundle_file(source: Path, *, asset_root: Path | None = None, linked_files=False,
                max_asset_bytes=8*1024*1024, max_output_bytes=16*1024*1024) -> BundleResult:
    source = Path(os.path.abspath(source))
    private_path(source)
    logical_root = Path(os.path.abspath(asset_root if asset_root is not None else source.parent))
    root = private_path(logical_root)
    if not source.is_relative_to(logical_root): raise BundleError('HTML input must be inside the asset root')
    source = root / source.relative_to(logical_root)
    if not source.resolve().is_relative_to(root): raise BundleError('HTML input symlink escapes the asset root')
    bundler = Bundler(root, linked_files=linked_files, max_asset_bytes=max_asset_bytes, max_output_bytes=max_output_bytes)
    try: text = bounded_read(source, max_output_bytes).decode('utf-8-sig')
    except UnicodeDecodeError as error: raise BundleError('HTML input must use UTF-8') from error
    if not text.strip(): raise BundleError('HTML input is empty')
    return BundleResult(bundler.html(text, source), bundler.assets, bundler.retained_links)


def write_private(path: Path, data: bytes, *, force=False):
    if path.is_symlink(): raise BundleError('refusing a symlink output')
    path = private_path(path)
    if path.exists() and not force: raise BundleError('output exists; use --force to replace it')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.embed-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        if force: os.replace(temporary, path)
        else:
            # Atomic no-clobber publication of the private temporary file.
            os.link(temporary, path); os.unlink(temporary)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', required=True, type=Path, help='private UTF-8 HTML body, not Markdown')
    parser.add_argument('--out', required=True, type=Path, help='private bundled HTML output (still plaintext)')
    parser.add_argument('--asset-root', type=Path, help='allowed private asset tree; / URLs map here (default: input directory)')
    parser.add_argument('--embed-linked-files', action='store_true', help='also turn local links to supported files into embedded downloads')
    parser.add_argument('--max-asset-bytes', type=int, default=8*1024*1024)
    parser.add_argument('--max-output-bytes', type=int, default=16*1024*1024)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    try:
        if args.html.resolve() == args.out.resolve(): raise BundleError('input and output must be different files')
        private_path(args.out)
        result = bundle_file(args.html, asset_root=args.asset_root, linked_files=args.embed_linked_files,
                             max_asset_bytes=args.max_asset_bytes, max_output_bytes=args.max_output_bytes)
        data = result.html.encode()
        write_private(args.out, data, force=args.force)
    except (BundleError, OSError, ValueError) as error:
        parser.exit(2, f'error: {error}\n')
    print(f'Embedded {len(result.assets)} local asset reads; {len(data)} HTML bytes. Output is still private plaintext.')
    print(f'Ordinary links retained: {result.retained_links}. Originals are not deleted or made private by this utility.')

if __name__ == '__main__': main()
