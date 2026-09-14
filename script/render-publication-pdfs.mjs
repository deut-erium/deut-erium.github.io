#!/usr/bin/env node
/** Offline, manifest-only publication PDFs. No builds, installs or downloads.
 * PDFs are installed at the manifest's pdf_url in the generated site, without
 * replacing existing files. Logs and browser scratch files stay under agent_out.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedOut = path.join(repo, 'agent_out/publications');
const hash = data => createHash('sha256').update(data).digest('hex');
export const within = (root, file) => file === root || file.startsWith(root + path.sep);
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Check the original spelling BEFORE WHATWG URL normalization discards dot segments.
export function validateRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\s\\?#\x00-\x1f\x7f]/u.test(route)) throw new Error('Invalid site route');
  if (/%(?:2f|5c)/i.test(route)) throw new Error('Encoded path separator');
  let decoded;
  try { decoded = decodeURIComponent(route); } catch { throw new Error('Malformed route encoding'); }
  if (/[\\%?#\x00-\x1f\x7f]/u.test(decoded) || decoded.includes('//') || decoded.split('/').some(s => s === '.' || s === '..' || s.startsWith('.'))) throw new Error('Unsafe route segment');
  return decoded;
}

export function normalizeBaseurl(value) {
  if (value === '' || value === '/') return '';
  if (typeof value !== 'string') throw new Error('baseurl must be a path');
  validateRoute(value);
  return value.replace(/\/$/, '');
}

export function routeToRelative(route, baseurl = '', html = false) {
  const base = normalizeBaseurl(baseurl);
  const decodedBase = base ? validateRoute(base) : '';
  const decoded = validateRoute(route);
  if (decodedBase && !decoded.startsWith(decodedBase + '/')) throw new Error('Route is outside baseurl');
  let relative = decoded.slice(decodedBase.length + 1);
  if (html && (!relative || relative.endsWith('/'))) relative += 'index.html';
  if (!relative) throw new Error('Route has no file');
  return relative;
}

export function validateManifest(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.posts) || typeof input.baseurl !== 'string') throw new Error('Expected publications.json version 1 with baseurl and posts');
  const baseurl = normalizeBaseurl(input.baseurl);
  const seen = new Set();
  const posts = input.posts.map((post, index) => {
    if (!post || typeof post !== 'object') throw new Error(`Invalid post ${index}`);
    for (const field of ['url', 'pdf_url', 'bib_url', 'canonical_url', 'title', 'author', 'date', 'description']) {
      if (typeof post[field] !== 'string' || (field !== 'description' && !post[field].trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(post[field])) throw new Error(`Invalid ${field} in post ${index}`);
    }
    for (const field of ['publication_date', 'date_note']) {
      // Older manifests omit both fields; unknown publication dates are null.
      if (post[field] != null && (typeof post[field] !== 'string' || !post[field].trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(post[field]))) throw new Error(`Invalid ${field} in post ${index}`);
    }
    for (const field of ['hidden', 'noindex', 'unlisted', 'locked', 'argon']) {
      if (post[field] != null && post[field] !== false) throw new Error(`Excluded ${field} post in manifest`);
    }
    // Manifest routes are Jekyll destination URLs (without baseurl). Only the
    // canonical URL and browser mount include the deployment prefix.
    const htmlPath = routeToRelative(post.url, '', true);
    const pdfPath = routeToRelative(post.pdf_url);
    const bibPath = routeToRelative(post.bib_url);
    if (!/\.html$/i.test(htmlPath) || !/\.pdf$/i.test(pdfPath) || !/\.bib$/i.test(bibPath)) throw new Error('Wrong publication route extension');
    for (const file of [htmlPath, pdfPath, bibPath]) {
      if (seen.has(file)) throw new Error('Duplicate publication destination');
      seen.add(file);
    }
    let canonical;
    try { canonical = new URL(post.canonical_url); } catch { throw new Error('Invalid canonical URL'); }
    const rawPath = post.canonical_url.match(/^https?:\/\/[^/]+(\/[^?#]*)?$/)?.[1] || '/';
    if (!/^https?:\/\//.test(post.canonical_url) || canonical.username || canonical.password || canonical.search || canonical.hash || validateRoute(rawPath) !== validateRoute(baseurl + post.url)) throw new Error('Canonical URL must match the public HTML route');
    return { ...post, htmlPath, pdfPath, bibPath };
  });
  return { version: 1, baseurl, posts };
}

export function resolveNavigation(value, canonicalURL) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f\\]/.test(value)) return null;
  try {
    const url = new URL(value, canonicalURL);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function resolveLocalResource(value, canonicalURL, origin, baseurl = '') {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x20\x7f\\]/.test(value)) throw new Error('Missing or invalid resource URL');
  // Relative ./ is conventional; parent traversal and encoded separators are not accepted.
  const rawPath = value.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0];
  if (/%(?:2f|5c|25)/i.test(rawPath) || decodeURIComponent(rawPath).split('/').some(s => s === '..')) throw new Error('Resource path traversal');
  const url = new URL(value, canonicalURL);
  const canonical = new URL(canonicalURL);
  if (!['https:', 'http:'].includes(url.protocol) || ![canonical.origin, origin].includes(url.origin) || url.username || url.password) throw new Error('External or non-HTTP resource refused');
  routeToRelative(url.pathname, baseurl);
  // Anchors pointing at PDFs are navigation only, never resource downloads.
  if (/\.(?:pdf|bib|html?)$/i.test(validateRoute(url.pathname))) throw new Error('Document used as a resource');
  return origin + url.pathname + url.search + url.hash;
}

export function isAllowedRequest(raw, origin, baseurl, type, documentURL, method = 'GET') {
  try {
    const url = new URL(raw);
    const originalPath = raw.match(/^https?:\/\/[^/]+(\/[^?#]*)/)?.[1];
    if (!originalPath || validateRoute(originalPath) !== validateRoute(url.pathname)) return false;
    if (method !== 'GET' || url.origin !== origin || url.username || url.password) return false;
    routeToRelative(url.pathname, baseurl);
    if (type === 'document') return raw === documentURL;
    if (type === 'other') return raw === documentURL.replace(/\.html$/, '.svg'); // Inert local favicon only.
    if (!['stylesheet', 'image', 'font'].includes(type) || /\.(?:pdf|bib|html?)$/i.test(validateRoute(url.pathname))) return false;
    return true;
  } catch { return false; }
}

// Runs in Chromium via evaluate, with site JavaScript disabled. Rebuild an
// allowlisted DOM instead of editing the live page or executing site scripts.
export function extractAcademicDocument(source, post, tokenPrefix) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const title = doc.querySelector('h1');
  const articles = doc.querySelectorAll('article#article-body');
  const article = articles[0];
  if (!title || articles.length !== 1 || !title.textContent.trim() || !article.textContent.trim()) throw new Error('Missing or empty h1/article#article-body');
  for (const meta of doc.querySelectorAll('meta')) {
    const name = (meta.getAttribute('name') || '').toLowerCase();
    const content = (meta.getAttribute('content') || '').toLowerCase();
    if ((/^(robots|googlebot|bingbot)$/.test(name) && /\b(noindex|none)\b/.test(content)) || (/^(hidden|unlisted|locked|argon)$/.test(name) && !/^(false|0)$/.test(content))) throw new Error('Excluded metadata in HTML');
    if ((meta.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') throw new Error('Redirect HTML refused');
  }
  const excluded = /^(?:argon(?:-.+)?|locked|unlisted|noindex|layout-(?:locked|hidden|unlisted))$/i;
  for (const el of doc.querySelectorAll('*')) {
    if ([...el.classList].some(c => excluded.test(c)) || excluded.test(el.id) || /^(locked|hidden|unlisted)$/i.test(el.getAttribute('data-layout') || '')) throw new Error('Locked/argon/unlisted HTML refused');
    if ([...el.attributes].some(a => /^data-(argon(?:-.+)?|locked|unlisted|noindex|hidden)$/i.test(a.name) && !/^(false|0)$/i.test(a.value))) throw new Error('Excluded data marker in HTML');
    if (el.localName === 'script' && /(?:\bdata-argon\b|\bargon\.js\b)/i.test(el.textContent + ' ' + el.getAttribute('src'))) throw new Error('Argon loader in HTML');
  }
  // Inspect embedded hiding rules without attaching source stylesheets or
  // allowing their imports to fetch. Any matching hide rule is conservative:
  // an override in a later rule does not make withheld prose publishable.
  const cssHidden = new Set();
  const hidingStyle = style => style?.display === 'none' || /^(hidden|collapse)$/.test(style?.visibility || '') || style?.opacity === '0';
  const inspectRules = rules => {
    for (const rule of rules) {
      if (rule.selectorText && hidingStyle(rule.style)) {
        try { for (const el of doc.querySelectorAll(rule.selectorText)) cssHidden.add(el); } catch {}
      }
      if (rule.cssRules) inspectRules(rule.cssRules);
    }
  };
  for (const style of doc.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(style.textContent); inspectRules(sheet.cssRules);
  }
  const hidden = el => el.hasAttribute('hidden') || el.hasAttribute('inert') || el.classList.contains('hidden') || hidingStyle(el.style) || cssHidden.has(el);
  for (const root of [title, article]) for (let el = root; el; el = el.parentElement) {
    if (hidden(el) || (el.getAttribute('aria-hidden') || '').toLowerCase() === 'true' || el.classList.contains('unlisted')) throw new Error('Hidden publication content');
  }
  const output = doc.implementation.createHTMLDocument('');
  const resources = [], links = [], notes = [], geometry = [];
  const text = value => output.createTextNode(value);
  const token = (list, value, extra = {}) => {
    const marker = `${tokenPrefix}${list === resources ? 'R' : 'L'}${list.length}__`;
    list.push({ marker, value, ...extra });
    return marker;
  };
  const htmlTags = new Set('article section div span p h1 h2 h3 h4 h5 h6 a abbr b strong i em u s del ins small sub sup br wbr hr pre code kbd samp var blockquote q cite ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col figure figcaption img picture details summary noscript form fieldset legend'.split(' '));
  const svgTags = new Set('svg a g defs path rect circle ellipse line polyline polygon text tspan textPath title desc use image symbol marker clipPath mask pattern linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject'.split(' '));
  const mathTags = new Set('math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabeledtr'.split(' '));
  const drop = new Set('script style link meta base template input button select option optgroup textarea datalist output progress meter source track'.split(' '));
  const interactive = new Set('iframe object embed canvas video audio'.split(' '));
  const commonAttrs = new Set('id class title lang dir role aria-label aria-hidden alt width height colspan rowspan scope start reversed value datetime cite open'.split(' '));
  const svgAttrs = new Set('viewBox preserveAspectRatio d x y x1 x2 y1 y2 dx dy cx cy r rx ry points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity clip-path clip-rule mask filter offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform markerWidth markerHeight markerUnits refX refY orient marker-start marker-mid marker-end text-anchor dominant-baseline font-family font-size font-weight font-style textLength lengthAdjust rotate pathLength xmlns version color-interpolation-filters in in2 result type values mode operator k1 k2 k3 k4 stdDeviation flood-color flood-opacity scale xChannelSelector yChannelSelector numOctaves seed baseFrequency'.split(' '));
  const mathAttrs = new Set('display mathvariant mathsize mathcolor stretchy fence separator accent accentunder form lspace rspace minsize maxsize movablelimits symmetric columnalign rowalign columnspacing rowspacing columnspan rowlines columnlines encoding'.split(' '));
  const lengths = /^(?:-?(?:\d*\.)?\d+(?:em|ex|px|pt|%|mm)?|auto)(?:\s+-?(?:\d*\.)?\d+(?:em|ex|px|pt|%|mm)?){0,3}$/;
  const geometryProps = /^(?:width|height|min-width|max-width|min-height|max-height|top|left|right|bottom|vertical-align|margin(?:-(?:top|left|bottom|right))?|padding(?:-(?:top|left|bottom|right))?|font-size|border-(?:top|left|bottom|right)-width)$/;
  const color = /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i;
  let removedControls = 0;
  function copy(node) {
    if (node.nodeType === 3) return text(node.textContent);
    if (node.nodeType !== 1) return null;
    const tag = node.localName;
    if (drop.has(tag)) { if (/^(input|button|select|textarea)$/.test(tag)) removedControls++; return null; }
    // KaTeX deliberately hides its accessibility MathML copy; preserve that.
    if (hidden(node) && !node.closest('.katex') && !node.classList.contains('widget-fallback') && !node.closest('noscript')) return null;
    if (interactive.has(tag)) {
      const wrap = output.createElement('div');
      const poster = tag === 'video' ? node.getAttribute('poster') : tag === 'object' && /^image\//.test(node.getAttribute('type') || '') ? node.getAttribute('data') : null;
      if (poster) {
        const img = output.createElement('img'); img.setAttribute('src', token(resources, poster, { tag }));
        img.setAttribute('alt', tag === 'video' ? 'Video poster' : 'Embedded figure'); wrap.append(img);
      }
      for (const child of node.childNodes) { const clean = copy(child); if (clean) wrap.append(clean); }
      const note = output.createElement('p'); note.className = 'publication-note';
      note.textContent = `${tag === 'canvas' ? 'Interactive figure' : 'Embedded media'} omitted. See the canonical HTML version.`;
      wrap.append(note); notes.push(note.textContent);
      return wrap;
    }
    const svg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    const math = node.namespaceURI === 'http://www.w3.org/1998/Math/MathML';
    const widget = !svg && !math && tag.includes('-');
    if (!(svg ? svgTags.has(tag) : math ? mathTags.has(tag) : htmlTags.has(tag)) && !widget) {
      // Unknown containers lose their behavior but retain readable children.
      const fragment = output.createDocumentFragment();
      for (const child of node.childNodes) { const clean = copy(child); if (clean) fragment.append(clean); }
      return fragment;
    }
    const mapped = widget || ['noscript', 'form', 'fieldset', 'details'].includes(tag) ? 'div' : tag === 'summary' || tag === 'legend' ? 'p' : tag;
    const el = svg || math ? output.createElementNS(node.namespaceURI, mapped) : output.createElement(mapped);
    for (const attr of node.attributes) {
      const name = attr.name;
      if (commonAttrs.has(name) || (svg && svgAttrs.has(name)) || (math && mathAttrs.has(name))) {
        // SVG paint servers can reference local fragments, never remote URLs.
        if (/url\s*\(/i.test(attr.value) && !/^url\(#[\w:.-]+\)$/.test(attr.value)) throw new Error('Non-fragment SVG paint resource refused');
        el.setAttribute(name, attr.value);
      }
    }
    el.removeAttribute('hidden'); el.removeAttribute('open');
    if (tag === 'noscript') el.classList.add('publication-noscript');
    // Page styles are discarded. Keep only numeric KaTeX geometry and SVG
    // presentation, emitted as renderer CSS rather than inline style attributes.
    const rules = [];
    if (node.closest('.katex') || svg) for (const prop of node.style) {
      const value = node.style.getPropertyValue(prop).trim();
      if ((geometryProps.test(prop) && lengths.test(value)) || (/^(color|fill|stroke|background-color|border-color)$/.test(prop) && color.test(value)) || (prop === 'position' && /^(relative|absolute)$/.test(value)) || (prop === 'text-align' && /^(left|right|center)$/.test(value)) || (svg && /^(font-weight|font-style|text-anchor|dominant-baseline|stroke-width|opacity|fill-opacity|stroke-opacity)$/.test(prop) && /^[\w. -]+$/.test(value))) rules.push(`${prop}:${value}`);
    }
    if (rules.length) { const cls = `publication-geometry-${geometry.length}`; el.classList.add(cls); geometry.push(`.${cls}{${rules.join(';')}}`); }
    if (tag === 'a') {
      const href = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (href != null) el.setAttribute('href', token(links, href));
    } else if (svg && ['use', 'textPath'].includes(tag)) {
      const href = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (href?.startsWith('#')) el.setAttribute('href', href);
      else if (href) throw new Error('Non-fragment SVG symbol reference refused');
    }
    if (tag === 'img' || (svg && ['image', 'feImage'].includes(tag))) {
      let src = node.getAttribute(tag === 'img' ? 'src' : 'href') || node.getAttribute('xlink:href') || node.getAttribute('data-src');
      if (!src && tag === 'img') src = (node.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
      el.setAttribute(tag === 'img' ? 'src' : 'href', token(resources, src, { tag }));
      if (tag === 'img') { el.setAttribute('loading', 'eager'); el.setAttribute('decoding', 'sync'); }
    }
    for (const child of node.childNodes) { const clean = copy(child); if (clean) el.append(clean); }
    if (widget) {
      const note = output.createElement('p'); note.className = 'publication-note';
      note.textContent = 'Interactive widget: the static fallback is shown where available. See the canonical HTML version for interaction.';
      el.append(note); notes.push(`Static widget: ${tag}`);
    }
    return el;
  }
  const main = output.createElement('main');
  const header = output.createElement('header'); header.className = 'publication-header';
  const h1 = copy(title); header.append(h1);
  const byline = output.createElement('p'); byline.className = 'publication-byline';
  byline.textContent = `${post.author} | ${post.date_note ? `Event date: ${post.date}` : (post.publication_date || post.date)}`;
  header.append(byline);
  if (post.date_note) {
    const note = output.createElement('p'); note.className = 'publication-date-note'; note.textContent = post.date_note; header.append(note);
  }
  const canonical = output.createElement('p'); canonical.className = 'publication-canonical';
  const anchor = output.createElement('a'); anchor.setAttribute('href', post.canonical_url); anchor.textContent = post.canonical_url;
  canonical.append(text('Canonical HTML: '), anchor); header.append(canonical);
  if (post.description.trim()) {
    const abstract = output.createElement('section'); abstract.className = 'publication-abstract';
    const heading = output.createElement('h2'); heading.textContent = 'Abstract';
    const p = output.createElement('p'); p.textContent = post.description; abstract.append(heading, p); header.append(abstract);
  }
  main.append(header, copy(article));
  if (!main.querySelector('article')?.textContent.trim()) throw new Error('Article is empty after sanitization');
  if (removedControls) {
    const note = output.createElement('p'); note.className = 'publication-note';
    note.textContent = 'Interactive controls are omitted from this PDF. See the canonical HTML version.';
    main.append(note); notes.push(`Removed ${removedControls} interactive controls.`);
  }
  if (!h1.textContent.trim()) throw new Error('Title is empty after sanitization');
  if (h1.textContent.trim() !== post.title.trim()) notes.push('Current page h1 differs from manifest title; the current h1 is used.');
  return { body: main.outerHTML, title: h1.textContent, geometry: geometry.join('\n'), resources, links, notes, hasMath: Boolean(main.querySelector('.katex')), figures: main.querySelectorAll('figure').length };
}

// SVGs loaded through <img> cannot reliably load their own external images or
// fonts. A successful img.decode() would otherwise conceal blank subresources.
export function checkSVGImage(source) {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (svg.querySelector('parsererror') || svg.documentElement.localName !== 'svg') throw new Error('Invalid SVG image');
  const localPaint = value => !/url\s*\(/i.test(value.replace(/url\(\s*["']?#[\w:.-]+["']?\s*\)/gi, ''));
  for (const el of svg.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if ((attr.localName === 'href' && el.localName !== 'a') || attr.localName === 'src') {
        if (attr.value && !attr.value.startsWith('#')) throw new Error('SVG image is not self-contained: nested image, font or symbol reference');
      }
      if (!localPaint(attr.value)) throw new Error('SVG image contains a non-fragment paint resource');
    }
    if (el.localName === 'style' && (!localPaint(el.textContent) || /@import/i.test(el.textContent))) throw new Error('SVG image contains stylesheet resources');
  }
  return true;
}

export async function safeInputFile(site, relative) {
  const file = await fsp.realpath(path.resolve(site, relative));
  if (!within(site, file) || !(await fsp.stat(file)).isFile()) throw new Error('Input file escapes generated site');
  return file;
}

// mkdir one component at a time, rejecting symlinks even when they point inward.
export async function safeOutputPath(root, relative) {
  const target = path.resolve(root, relative);
  if (!within(root, target) || target === root) throw new Error('Output escapes root');
  let parent = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    try { await fsp.mkdir(parent); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const stat = await fsp.lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe output ancestor');
  }
  try { await fsp.lstat(target); throw new Error('Refusing to overwrite existing output'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return target;
}

export async function installPDF(root, relative, bytes) {
  const data = Buffer.from(bytes);
  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !data.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error('Invalid PDF bytes');
  const target = await safeOutputPath(root, relative);
  const temp = path.join(path.dirname(target), `.publication-pdf-${randomUUID()}.tmp`);
  try {
    const handle = await fsp.open(temp, 'wx', 0o644);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    // link is an atomic, no-clobber install on the same filesystem. rename
    // would silently replace an existing authored PDF or a concurrent result.
    await fsp.link(temp, target);
  } finally { await fsp.unlink(temp).catch(() => {}); }
  return { bytes: data.length, sha256: hash(data) };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const csp = "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; frame-ancestors 'none'";
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });

export async function loadBrowserTools(options = {}) {
  const require = createRequire(import.meta.url);
  const choices = options.puppeteer ? [path.resolve(repo, options.puppeteer)] : ['.toolchain/verify/lighthouse-node_modules/puppeteer-core', '.toolchain/node_modules/puppeteer-core'].map(p => path.join(repo, p));
  let puppeteer, modulePath;
  for (const candidate of choices) {
    try { const module = await import(pathToFileURL(require.resolve(candidate)).href); puppeteer = module.default || module; modulePath = candidate; break; } catch {}
  }
  if (!puppeteer) throw new Error('No cached Puppeteer; downloads are forbidden');
  const chrome = path.resolve(repo, options.chrome || process.env.CHROME_BIN || '.toolchain/verify/browser/chrome-linux64/chrome');
  await fsp.access(chrome, fs.constants.X_OK);
  const libs = ['agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu', 'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu', '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'].map(p => path.join(repo, p)).filter(p => fs.existsSync(p));
  return { puppeteer, modulePath, chrome, libs };
}

async function inspectRendering(page) {
  return page.evaluate(async () => {
    const timeout = (promise, name) => {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out`)), 15000); })]).finally(() => clearTimeout(timer));
    };
    const missingImages = [];
    const images = [...document.images];
    for (const el of document.querySelectorAll('svg image, svg feImage')) {
      const image = new Image(); image.src = el.getAttribute('href'); images.push(image);
    }
    await Promise.all(images.map(async img => {
      try { await timeout(img.decode(), 'Image decode'); if (!img.naturalWidth || !img.naturalHeight) throw new Error('Empty image'); }
      catch { missingImages.push(img.src); }
    }));
    let fontError = null;
    try { await timeout(document.fonts.ready, 'Font load'); } catch (e) { fontError = e.message; }
    const fonts = [...document.fonts].map(f => ({ family: f.family, style: f.style, weight: f.weight, status: f.status }));
    const missingStylesheets = [...document.querySelectorAll('link[rel=stylesheet]')].filter(el => !el.sheet).map(el => el.href);
    const main = document.querySelector('main'), bounds = main.getBoundingClientRect();
    const overflow = [];
    const record = value => { if (overflow.length < 100) overflow.push(value); };
    for (const el of main.querySelectorAll('*')) {
      if (el.closest('.katex') && !el.classList.contains('katex')) continue;
      if (el.closest('svg') && el.localName !== 'svg') continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = el.localName + (el.id ? '#' + el.id : '');
      if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || (el.clientWidth && el.scrollWidth > el.clientWidth + 2)) record({ element: label, kind: 'horizontal', width: rect.width, scrollWidth: el.scrollWidth });
      // Replaced content, rows and equations cannot split; other containers
      // must fit a page when their actual print style forbids fragmentation.
      // In particular, a multi-page code figure is safe only with break-inside:
      // auto, not merely because it carries a code-frame class.
      const unbreakable = el.matches('img, svg, tr, .katex-display') || /^avoid(?:-page|-column)?$/.test(getComputedStyle(el).breakInside);
      if (unbreakable && rect.height > 257 * 96 / 25.4 + 2) record({ element: label, kind: 'taller-than-page', height: rect.height });
    }
    const visible = el => Boolean(el.getBoundingClientRect().height && getComputedStyle(el).display !== 'none');
    return { missingImages, missingStylesheets, fonts, fontError, overflow, imageCount: images.length, figureCount: main.querySelectorAll('figure').length,
      svgFigureCount: [...main.querySelectorAll('svg')].filter(el => !el.closest('.katex')).length,
      mathCount: main.querySelectorAll('.katex').length, bodyFont: getComputedStyle(document.body).font, width: bounds.width,
      byline: main.querySelector('.publication-byline').textContent, dateNote: main.querySelector('.publication-date-note')?.textContent || null,
      codeFrames: [...main.querySelectorAll('figure.code-frame')].map(el => ({ height: el.getBoundingClientRect().height, breakInside: getComputedStyle(el).breakInside })),
      mathScriptRatios: [...main.querySelectorAll('.katex .katex-sizing.size3')].slice(0, 20).map(el => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.closest('.katex')).fontSize)),
      fractions: [...main.querySelectorAll('.katex .frac-line')].slice(0, 20).map(el => ({ width: el.getBoundingClientRect().width, border: parseFloat(getComputedStyle(el).borderBottomWidth) })),
      visibleWidgetFallbacks: [...main.querySelectorAll('.widget-fallback')].filter(visible).length,
      visibleNoscriptFallbacks: [...main.querySelectorAll('.publication-noscript')].filter(visible).length,
      inlineStyles: main.querySelectorAll('[style]').length, controls: main.querySelectorAll('form,input,button,textarea,select').length,
      scripts: document.scripts.length, eventHandlers: [...main.querySelectorAll('*')].filter(el => [...el.attributes].some(a => /^on/i.test(a.name))).length };
  });
}

async function makeRunDirectory(out) {
  const target = path.resolve(repo, out || allowedOut);
  if (!within(allowedOut, target)) throw new Error('--out must be under agent_out/publications');
  // Reject symlinks in all existing ancestors, before any writes.
  let current = repo;
  for (const segment of path.relative(repo, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe log directory');
    } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.mkdir(current); }
  }
  return fsp.mkdtemp(path.join(target, 'run-'));
}

export async function renderPublications(options) {
  const out = await makeRunDirectory(options.out);
  const report = { version: 1, started: new Date().toISOString(), status: 'failed', partial: options.limit != null, planned: 0, selected: 0, rendered: 0, failed: 0, results: [], reportPath: path.join(out, 'report.json'),
    byteReproducible: false, limitations: [
      'Chrome timestamps, PDF IDs and font subsetting are not normalized. PDFs are not byte reproducible.',
      'Only manifest posts are considered. --limit is always partial coverage, even when it exceeds the post count.',
      'Site JavaScript and external resources are disabled. Widgets use static fallbacks; media receives an omission note.',
      'Page styles are removed. Numeric KaTeX geometry and safe SVG presentation are retained as renderer CSS.',
      'SVG image files must be self-contained. Nested file/data references fail instead of silently printing blank image regions.',
      'Overflow checks use the A4 content width and unbreakable element height, not a per-page visual proof.',
      'The generated site must remain unchanged during rendering. This is not a sandbox for a hostile browser binary or concurrent filesystem writer.',
    ] };
  let server, proxy, browser;
  try {
    if (!options.site) throw new Error('--site is required');
    const site = await fsp.realpath(path.resolve(repo, options.site));
    if (within(site, repo) || within(site, out) || ['.git', '_config.yml', '_posts', '_layouts'].some(p => fs.existsSync(path.join(site, p)))) throw new Error('Expected a separate generated site, not source or logs');
    const manifestFile = await safeInputFile(site, 'publications.json');
    const manifestBytes = await fsp.readFile(manifestFile);
    const manifest = validateManifest(JSON.parse(manifestBytes));
    report.manifestSha256 = hash(manifestBytes); report.site = site; report.baseurl = manifest.baseurl;
    if (options.limit != null && (!Number.isSafeInteger(Number(options.limit)) || Number(options.limit) < 1)) throw new Error('--limit must be a positive integer');
    const posts = options.limit == null ? manifest.posts : manifest.posts.slice(0, Number(options.limit));
    report.planned = manifest.posts.length; report.selected = posts.length;
    if (!posts.length) throw new Error('Manifest has no publications; no coverage');
    const academicCSS = await fsp.readFile(path.join(repo, 'assets/css/academic-pdf.css'));
    report.cssSha256 = hash(academicCSS);
    const virtualRoute = `${manifest.baseurl}/publication-renderer-${randomUUID()}.html`;
    const cssRoute = `${manifest.baseurl}/assets/css/academic-pdf.css`;
    const faviconRoute = virtualRoute.replace(/\.html$/, '.svg');
    const iconLink = `<link rel="icon" href="${escapeHTML(faviconRoute)}">`;
    const primer = `<!doctype html><html><head><meta charset="utf-8">${iconLink}</head><body></body></html>`;
    let documentHTML = primer;
    let origin;
    report.server = { rejected: 0, served: 0, proxyRejected: 0 };
    server = http.createServer(async (req, res) => {
      const deny = status => { report.server.rejected++; res.writeHead(status).end(); };
      try {
        if (!['GET', 'HEAD'].includes(req.method) || req.headers.host !== new URL(origin).host || !req.url.startsWith('/') || req.url.startsWith('//')) return deny(403);
        const route = req.url.split('?')[0];
        const relative = routeToRelative(route, manifest.baseurl);
        let data, contentType;
        if (route === virtualRoute) { data = Buffer.from(documentHTML); contentType = mime['.html']; }
        else if (route === cssRoute) { data = academicCSS; contentType = mime['.css']; }
        else if (route === faviconRoute) { data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); contentType = mime['.svg']; }
        else {
          const ext = path.extname(relative).toLowerCase();
          if (!mime[ext] || ext === '.html') return deny(403);
          const file = await safeInputFile(site, relative);
          data = await fsp.readFile(file); contentType = mime[ext];
        }
        report.server.served++;
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer' });
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch (e) { deny(e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 404 : 403); }
    });
    server.on('connection', socket => socket.on('error', () => {}));
    proxy = http.createServer((_req, res) => { report.server.proxyRejected++; res.writeHead(403).end(); });
    proxy.on('connection', socket => socket.on('error', () => {}));
    proxy.on('connect', (_req, socket) => { report.server.proxyRejected++; socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
    await listen(server); await listen(proxy);
    origin = `http://127.0.0.1:${server.address().port}`;
    const tools = await loadBrowserTools(options);
    const runtime = path.join(out, 'runtime'); await fsp.mkdir(runtime);
    const previousCwd = process.cwd();
    process.chdir(runtime);
    try {
      browser = await tools.puppeteer.launch({ executablePath: tools.chrome, headless: true, pipe: true, protocolTimeout: 60000, userDataDir: path.join(runtime, 'profile'),
        env: { ...process.env, LD_LIBRARY_PATH: [...tools.libs, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':'), TMPDIR: '.', XDG_CACHE_HOME: path.join(runtime, 'cache'), XDG_CONFIG_HOME: path.join(runtime, 'config') },
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--no-first-run', '--disable-default-apps', '--disable-quic', '--disable-extensions', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', `--proxy-server=http://127.0.0.1:${proxy.address().port}`, `--proxy-bypass-list=<-loopback>;127.0.0.1:${server.address().port}`, '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    } finally { process.chdir(previousCwd); }
    report.browser = await browser.version(); report.chrome = tools.chrome; report.puppeteer = tools.modulePath;
    for (const post of posts) {
      const result = { url: post.url, pdf_url: post.pdf_url, status: 'failed', blockedRequests: [], failedRequests: [], resourceErrors: [], notes: [] };
      report.results.push(result);
      let context;
      try {
        await safeOutputPath(site, post.pdfPath);
        const sourceFile = await safeInputFile(site, post.htmlPath);
        const sourceBytes = await fsp.readFile(sourceFile); result.sourceSha256 = hash(sourceBytes);
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setJavaScriptEnabled(false);
        await page.setBypassServiceWorker(true);
        await page.setCacheEnabled(false);
        await page.setViewport({ width: 643, height: 972, deviceScaleFactor: 1 });
        await page.emulateMediaType('print');
        const documentURL = origin + virtualRoute;
        const localLabel = raw => { try { const u = new URL(raw); return [origin, new URL(post.canonical_url).origin].includes(u.origin) ? u.pathname : `${u.protocol}//${u.host}/[path omitted]`; } catch { return '[invalid URL]'; } };
        await page.setRequestInterception(true);
        page.on('request', request => {
          const allowed = isAllowedRequest(request.url(), origin, manifest.baseurl, request.resourceType(), documentURL, request.method());
          if (!allowed) result.blockedRequests.push({ url: localLabel(request.url()), type: request.resourceType() });
          (allowed ? request.continue() : request.abort('blockedbyclient')).catch(() => {});
        });
        page.on('requestfailed', request => result.failedRequests.push({ url: localLabel(request.url()), type: request.resourceType(), error: request.failure()?.errorText }));
        page.on('response', response => { if (response.status() >= 400) result.failedRequests.push({ url: localLabel(response.url()), type: response.request().resourceType(), status: response.status() }); });
        // Never navigate to the raw page: its preloads, PDF alternate links and
        // refresh directives must not trigger requests before sanitization.
        documentHTML = primer;
        await page.goto(documentURL, { waitUntil: 'load', timeout: 30000 });
        const clean = await page.evaluate(extractAcademicDocument, sourceBytes.toString('utf8'), post, `PUBLICATION_${randomUUID().replaceAll('-', '')}_`);
        result.notes = clean.notes;
        let body = clean.body;
        for (const ref of clean.links) {
          const href = resolveNavigation(ref.value, post.canonical_url);
          if (!href) result.notes.push('Removed unsafe navigation target.');
          body = body.replace(ref.marker, escapeHTML(href || '#'));
        }
        for (const ref of clean.resources) {
          try {
            const url = resolveLocalResource(ref.value, post.canonical_url, origin, manifest.baseurl);
            const imageFile = await safeInputFile(site, routeToRelative(new URL(url).pathname, manifest.baseurl));
            if (/\.svg$/i.test(imageFile)) await page.evaluate(checkSVGImage, await fsp.readFile(imageFile, 'utf8'));
            body = body.replace(ref.marker, escapeHTML(url));
          } catch (e) {
            let label = '[missing or invalid source]';
            try { label = localLabel(new URL(ref.value, post.canonical_url).href); } catch {}
            result.resourceErrors.push({ tag: ref.tag, error: e.message, resource: label });
          }
        }
        if (result.resourceErrors.length) throw new Error('Missing or refused image resources');
        const sheets = [cssRoute, ...(clean.hasMath ? [`${manifest.baseurl}/assets/katex/katex.min.css`] : [])];
        documentHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">${iconLink}<title>${escapeHTML(clean.title)}</title><meta name="author" content="${escapeHTML(post.author)}">${sheets.map(s => `<link rel="stylesheet" href="${escapeHTML(s)}">`).join('')}<style>${clean.geometry}</style></head><body>${body}</body></html>`;
        await page.goto(documentURL, { waitUntil: 'networkidle0', timeout: 30000 });
        result.rendering = await inspectRendering(page);
        const metrics = result.rendering;
        metrics.missingImages = metrics.missingImages.map(localLabel);
        metrics.missingStylesheets = metrics.missingStylesheets.map(localLabel);
        if (metrics.missingImages.length || metrics.missingStylesheets.length || metrics.fontError || metrics.fonts.some(f => f.status === 'error') || !metrics.fonts.some(f => f.family.replaceAll('"', '') === 'Publication Serif' && f.status === 'loaded')) throw new Error('Image, stylesheet or font load failed');
        if (result.failedRequests.length || result.blockedRequests.length) throw new Error('Rendering requested missing or forbidden resources');
        if (metrics.overflow.length) throw new Error('Academic layout overflow');
        if (metrics.scripts || metrics.eventHandlers || metrics.inlineStyles || metrics.controls) throw new Error('Sanitizer left active content');
        result.siteJavaScriptEnabled = page.isJavaScriptEnabled();
        const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
          margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }, headerTemplate: '<span></span>',
          footerTemplate: '<div style="width:100%;text-align:center;font:9pt serif;color:#333"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', timeout: 60000 });
        if (result.failedRequests.length || result.blockedRequests.length) throw new Error('Resource failure during PDF generation');
        result.pdf = await installPDF(site, post.pdfPath, pdf);
        result.status = 'rendered'; report.rendered++;
      } catch (e) { result.error = e.message; report.failed++; }
      finally { await context?.close().catch(() => {}); }
      await fsp.writeFile(report.reportPath, JSON.stringify(report, null, 2) + '\n');
    }
    report.status = report.failed ? 'failed' : report.partial ? 'partial' : 'complete';
  } catch (e) {
    report.error = e.message;
    await fsp.writeFile(path.join(out, 'ERROR.md'), `# Publication renderer stopped\n\n${e.message}\n\nNo network acquisition or dependency changes were attempted.\n`);
  } finally {
    await browser?.close().catch(() => {});
    if (server) await close(server);
    if (proxy) await close(proxy);
    report.finished = new Date().toISOString();
    await fsp.writeFile(report.reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { site: { type: 'string' }, out: { type: 'string' }, limit: { type: 'string' }, chrome: { type: 'string' }, puppeteer: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('Offline academic PDFs (Node 18+).\n--site PATH       Generated site with publications.json version 1.\n--out PATH        Log parent under agent_out/publications (default).\n--limit N         Development subset; always reported as partial.\n--chrome PATH     Cached Chrome executable (or CHROME_BIN).\n--puppeteer PATH  Cached local Puppeteer module.\nPDFs go to manifest pdf_url paths inside --site. Existing files are never replaced.\nEach run gets a fresh log directory. Missing resources and overflow fail the run.\nNo builds, downloads or dependency changes. PDFs are not byte reproducible.');
    return 0;
  }
  const report = await renderPublications(values);
  console.log(`${report.status}: ${report.rendered}/${report.selected} selected publications rendered; ${report.reportPath}`);
  return report.status === 'failed' ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
