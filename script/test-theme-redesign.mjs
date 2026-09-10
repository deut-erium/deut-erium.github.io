#!/usr/bin/env node
/**
 * Offline generated-site regression matrix. Never builds or serves the checkout.
 * node script/test-theme-redesign.mjs --site GENERATED --before GENERATED_BASELINE
 *   --out agent_out/theme-redesign/FRESH
 * See --help for subsets. No network, installs, geometry overrides or remote logs.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { families, skinFiles, repo, hash, within, freshOutput } from './test-theme-redesign-static.mjs';

const ORIGIN = 'https://theme-regression.invalid';
const RPN = 'rpn-garden';
const defaults = { themes: [...Object.keys(families), RPN], widths: [320, 390, 768, 1440, 1920], modes: ['light', 'dark'], pages: ['home', 'archive', 'about', 'article'] };
const { values: opt } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' }, site: { type: 'string' }, before: { type: 'string' }, out: { type: 'string' },
  themes: { type: 'string', default: defaults.themes.join(',') }, widths: { type: 'string', default: defaults.widths.join(',') },
  modes: { type: 'string', default: 'light,dark' }, pages: { type: 'string', default: defaults.pages.join(',') },
  article: { type: 'string', default: '/2026/03/03/unfaithful-claims-breaking-6-zkvms.html' }, baseurl: { type: 'string', default: '' },
  chrome: { type: 'string' }, puppeteer: { type: 'string' }, axe: { type: 'string', default: 'auto' },
  concurrency: { type: 'string', default: '3' }, 'no-screenshots': { type: 'boolean' }, 'no-fallback': { type: 'boolean' },
  provisional: { type: 'boolean' },
} });
if (opt.help) {
  console.log(`node script/test-theme-redesign.mjs --site GENERATED --before GENERATED --out agent_out/theme-redesign/FRESH
Default: five redesigned themes plus RPN, 320/390/768/1440/1920, light/dark,
home/archive/About/long article: 240 cases. Each records cold fonts, warms used
optional faces, then reloads for layout, focus and CDP rendered-font checks.
--themes id,id --widths 390,1440 --modes light,dark --pages home,article
--article /route.html --baseurl /prefix --concurrency 1..6
--chrome PATH --puppeteer PATH (cached only); --axe auto|off|LOCAL_JS
--no-screenshots --no-fallback reduce coverage and are recorded.
--provisional labels fixture or baseline-only diagnosis, never integrated.
Screenshots cover all selected themes/pages/modes at mobile and wide widths,
including article and footer views. RPN additionally compares stable regions
against --before using decoded pixels and computed geometry/paint/rendered fonts.
Axe is optional and reports skipped/incomplete/error separately. No WCAG claim.
Generated files only, intercepted at a private .invalid origin. No HTTP server,
external requests, DNS, background network, installs or geometry changes.`);
  process.exit(0);
}
const list = (value, allowed, name, map = s => s) => {
  const result = [...new Set(value.split(',').map(map))];
  assert.ok(result.length && result.every(v => allowed(v)), `Invalid --${name}`); return result;
};
const themes = list(opt.themes, t => defaults.themes.includes(t), 'themes');
const widths = list(opt.widths, w => Number.isInteger(w) && w >= 240 && w <= 2560, 'widths', Number);
const modes = list(opt.modes, m => defaults.modes.includes(m), 'modes');
const pages = list(opt.pages, p => defaults.pages.includes(p), 'pages');
const concurrency = Number(opt.concurrency);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 6, 'Invalid concurrency');
const base = opt.baseurl.replace(/\/$/, '');
assert.ok(!base || /^\/[\w/-]+$/.test(base) && !base.includes('//') && !base.includes('..'), 'Invalid baseurl');
assert.ok(/^\/(?!\/)[^?#\\\0]+$/.test(opt.article) && !opt.article.split('/').includes('..'), 'Invalid article route');
const routes = { home: '/', archive: '/archive.html', about: '/about.html', article: opt.article };
assert.ok(opt.site && opt.out && opt.before, '--site, --before and --out are required');
const out = freshOutput(opt.out);
const write = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));
const bounded = (list, item, cap = 30) => { if (list.length < cap) list.push(item); };
const safeError = e => String(e.message || e).slice(0, 1200);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };

function generatedSite(arg) {
  const root = fs.realpathSync(path.resolve(repo, arg));
  assert.ok(root !== repo && !within(root, repo), 'Never serve the checkout or its parent');
  assert.ok(fs.statSync(root).isDirectory(), 'Generated directory required');
  for (const marker of ['.git', '_config.yml', '_posts', '_layouts', 'Gemfile', 'script']) assert.ok(!fs.existsSync(path.join(root, marker)), `Source tree marker in generated root: ${marker}`);
  assert.ok(!within(root, out), 'Output must not be inside generated input');
  const files = new Map();
  const add = (relative, route = '/' + relative) => {
    assert.ok(!relative.split('/').some(p => p.startsWith('.')), 'Dotfile in allowlist');
    const file = path.join(root, relative), real = fs.realpathSync(file);
    assert.ok(within(root, real) && fs.statSync(real).isFile(), 'Generated file realpath escape');
    files.set(base + route, { file: real, relative, type: mime[path.extname(relative)] });
  };
  for (const route of new Set(['/', ...pages.map(p => routes[p])])) {
    const relative = route.endsWith('/') ? route.slice(1) + 'index.html' : route.slice(1);
    add(relative, route);
    const html = fs.readFileSync(files.get(base + route).file, 'utf8');
    assert.ok(/<!doctype html/i.test(html) && /<html[\s>]/i.test(html) && !/\{%\s*(?:include|layout)\b/.test(html), `Not generated HTML: ${relative}`);
  }
  // Explicit file allowlist: requested page HTML plus browser assets with known
  // types. Never map arbitrary paths, source files, notices or unknown binaries.
  const walk = relative => {
    const dir = path.join(root, relative);
    assert.ok(within(root, fs.realpathSync(dir)), 'Generated asset directory escape');
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = `${relative}/${e.name}`;
      assert.ok(!e.isSymbolicLink(), `No generated asset symlinks: ${rel}`);
      if (e.isDirectory()) walk(rel);
      else if (e.isFile() && mime[path.extname(rel)] && path.extname(rel) !== '.html') add(rel);
    }
  };
  walk('assets');
  for (const f of ['favicon.ico', 'favicon.svg']) if (fs.existsSync(path.join(root, f))) add(f);
  const resolve = raw => {
    const u = new URL(raw);
    if (u.origin !== ORIGIN || u.username || u.password) return null;
    const decoded = decodeURIComponent(u.pathname);
    if (/[\\\0]/.test(decoded) || decoded.split('/').some(p => p === '..' || p === '.' || p.startsWith('.'))) return null;
    const entry = files.get(decoded); if (!entry) return null;
    // Recheck at use time, including a replaced intermediate directory.
    if (!within(root, fs.realpathSync(entry.file)) || fs.realpathSync(path.join(root, entry.relative)) !== entry.file) throw new Error('Allowlisted file changed realpath');
    return entry;
  };
  assert.equal(resolve(ORIGIN + '/%2e%2e/_config.yml'), null);
  assert.equal(resolve(ORIGIN + '/assets/%2e%2e/%2e%2e/.git/config'), null);
  assert.equal(resolve('https://external.invalid/assets/css/main.css'), null);
  return { root, files, resolve };
}

function confinementControls() {
  const root = path.join(out, 'controls/generated'), asset = path.join(root, 'assets/probe.css');
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body>local fixture</body></html>');
  // generatedSite validates each selected route without fetching anything.
  for (const page of pages) if (page !== 'home') {
    const route = routes[page], file = path.join(root, route.endsWith('/') ? route.slice(1) + 'index.html' : route.slice(1));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<!doctype html><html><body>local fixture</body></html>');
  }
  fs.writeFileSync(asset, 'body { color: black; }');
  fs.writeFileSync(path.join(root, 'assets/not-allowlisted.txt'), 'Synthetic sentinel, not private data.');
  const input = generatedSite(root);
  assert.ok(input.resolve(ORIGIN + base + '/assets/probe.css'));
  for (const url of [ORIGIN + base + '/assets/not-allowlisted.txt', ORIGIN + base + '/%2e%2e/_config.yml', ORIGIN + base + '/assets/%5c..%5cindex.html', 'https://outside.invalid/assets/probe.css']) assert.equal(input.resolve(url), null);
  assert.throws(() => generatedSite(repo), /checkout/);
  const outside = path.join(out, 'controls/outside.css'); fs.writeFileSync(outside, '/* local escape sentinel */');
  fs.unlinkSync(asset); fs.symlinkSync(outside, asset);
  assert.throws(() => input.resolve(ORIGIN + base + '/assets/probe.css'), /realpath/);
  assert.throws(() => generatedSite(root), /symlinks/);
  return ['Generated CSS allowed', 'Unknown extension, traversal, backslash and foreign origin rejected', 'Checkout rejected without reading source content', 'Initial and replacement asset symlink escapes rejected'];
}

// Decode Chromium's noninterlaced 8-bit RGB/RGBA PNGs. PNG byte equality is not
// used as a pixel claim: filters/compression are removed before comparison.
function pixels(png) {
  assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid screenshot PNG');
  let width, height, bpp; const chunks = [];
  for (let i = 8; i < png.length;) {
    const size = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8), b = png.subarray(i + 8, i + 8 + size); i += size + 12;
    if (type === 'IHDR') { width = b.readUInt32BE(0); height = b.readUInt32BE(4); assert.equal(b[8], 8); assert.ok([2, 6].includes(b[9])); assert.equal(b[12], 0); bpp = b[9] === 2 ? 3 : 4; }
    if (type === 'IDAT') chunks.push(b);
  }
  const data = inflateSync(Buffer.concat(chunks)), stride = width * bpp, decoded = Buffer.alloc(height * stride);
  assert.equal(data.length, height * (stride + 1));
  const paeth = (a, b, c) => { const p = a + b - c, aa = Math.abs(p - a), bb = Math.abs(p - b), cc = Math.abs(p - c); return aa <= bb && aa <= cc ? a : bb <= cc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= bpp ? decoded[i - bpp] : 0, b = y ? decoded[i - stride] : 0, c = y && x >= bpp ? decoded[i - stride - bpp] : 0;
      decoded[i] = (data[y * (stride + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) decoded.copy(rgba, i * 4, i * bpp, i * bpp + bpp);
  return { width, height, rgba, sha256: hash(rgba) };
}
function pixelDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sameDimensions: false, changedPixels: null };
  let changedPixels = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if (!a.rgba.subarray(i, i + 4).equals(b.rgba.subarray(i, i + 4))) changedPixels++;
  return { sameDimensions: true, changedPixels, totalPixels: a.width * a.height };
}

// This function executes in the real page. It neither changes styles nor creates
// synthetic content. Horizontal code/table/math scrollports are checked locally.
async function measure(page) {
  return page.evaluate(() => {
    const round = n => Math.round(n * 100) / 100;
    const visible = e => !!e && !!e.getClientRects().length && !['hidden', 'collapse'].includes(getComputedStyle(e).visibility) && getComputedStyle(e).display !== 'none';
    const name = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    const rect = e => {
      if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { selector: name(e), x: round(r.x), y: round(r.y + scrollY), right: round(r.right), bottom: round(r.bottom + scrollY), width: round(r.width), height: round(r.height), visible: visible(e), position: s.position, order: s.order, transform: s.transform };
    };
    const box = s => rect(document.querySelector(s));
    const link = e => ({ path: new URL(e.href).pathname, label: e.textContent.trim(), ...rect(e), decoration: getComputedStyle(e).textDecorationLine });
    const overlap = (a, b) => a && b && a.visible && b.visible && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
    const visualOrder = elements => elements.map((e, index) => ({ index, ...rect(e) })).filter(e => e.visible).sort((a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1 ? a.x - b.x : a.y - b.y).map(e => e.index);
    const navNodes = [...document.querySelectorAll('.site-nav > a')], nav = navNodes.map(link);
    const navOverlap = nav.some((a, i) => nav.slice(i + 1).some(b => overlap(a, b)));
    const cards = document.querySelector('.section-cards'), records = document.querySelector('#records');
    const labels = [...document.querySelectorAll('.site-brand__name, .site-brand__scope, h1, .section-heading h2, .record-row__title, .site-nav > a, .skin-menu summary, .skin-menu__panel label, #skin-picker')].filter(visible);
    const badLabels = [];
    for (const e of labels) {
      const r = e.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(e);
      const ink = [...range.getClientRects()].filter(r => r.width && r.height);
      const reasons = [];
      if (r.left < -1 || r.right > innerWidth + 1) reasons.push('element-outside-viewport');
      if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).display !== 'inline') reasons.push('content-wider-than-label');
      if (ink.some(i => i.left < r.left - 2 || i.right > r.right + 2)) reasons.push('text-range-outside-label');
      if (reasons.length) badLabels.push({ ...rect(e), reasons, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, font: getComputedStyle(e).font, ink: ink.slice(0, 6).map(i => ({ left: round(i.left), right: round(i.right), width: round(i.width) })) });
    }
    const scroll = [], escaped = [];
    for (const e of document.querySelectorAll('main *, .site-header *, .site-footer *')) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.left >= -1 && r.right <= innerWidth + 1) continue;
      let p = e, local = null, clippedNonvisual = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p), pr = p.getBoundingClientRect();
        // KaTeX's accessible MathML is deliberately clipped to 1px. SVG path
        // geometry can also exceed its clipped SVG viewport without painted spill.
        // Do not excuse arbitrary hidden-overflow HTML containers.
        if (s.position === 'absolute' && pr.width <= 1 && pr.height <= 1 && (s.clip !== 'auto' || s.clipPath !== 'none') || p instanceof SVGSVGElement && ['hidden', 'clip'].includes(s.overflowX) && pr.left >= -1 && pr.right <= innerWidth + 1) { clippedNonvisual = true; break; }
        if (['auto', 'scroll'].includes(s.overflowX) && pr.left >= -1 && pr.right <= innerWidth + 1 && p.closest('#article-body, .page-prose') && (p.matches('pre, table, .katex-display, .code-frame, .table-scroll') || p.querySelector('pre, table, .katex-display'))) { local = p; break; }
        p = p.parentElement;
      }
      if (clippedNonvisual) continue;
      if (!local) { if (escaped.length < 20) escaped.push(rect(e)); }
      else if (local.scrollWidth > local.clientWidth + 1 && !scroll.some(s => s.selector === name(local))) {
        const before = local.scrollLeft; local.scrollLeft = 32; const moved = local.scrollLeft !== before; local.scrollLeft = before;
        scroll.push({ selector: name(local), moved, tabIndex: local.tabIndex });
      }
    }
    const ctx = document.createElement('canvas').getContext('2d');
    const prose = [...document.querySelectorAll('#article-body > p, #article-body > section > p')].filter(e => visible(e) && e.textContent.trim().length >= 80).slice(0, 80).map(e => {
      const s = getComputedStyle(e); ctx.font = s.font;
      const content = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      return { width: round(content), ch: round(content / ctx.measureText('0').width), font: s.fontFamily, fontSize: parseFloat(s.fontSize) };
    });
    const controls = [...document.querySelectorAll('.site-footer__mystery')];
    const groups = [...document.querySelectorAll('.site-footer__inner > *')];
    const cells = controls.map(e => ({ ...rect(e), slot: e.dataset.toySlot, enabled: !e.disabled, ancestorsInFlow: [e, e.parentElement, e.parentElement.parentElement].every(p => !['absolute', 'fixed'].includes(getComputedStyle(p).position)) }));
    const footerLinks = [...document.querySelectorAll('.site-footer__links a')].map(link);
    const footerOverlap = groups.some((a, i) => groups.slice(i + 1).some(b => overlap(rect(a), rect(b)))) || cells.some((a, i) => cells.slice(i + 1).some(b => overlap(a, b)));
    return { skin: document.documentElement.dataset.skin || 'rpn-garden', mode: document.documentElement.dataset.theme, picker: document.querySelector('#skin-picker')?.value,
      viewportOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      header: box('.site-header'), main: box('#content'), footer: box('#site-footer'), headerOverlap: overlap(box('.site-header'), box('#content')),
      nav, navOverlap, navOrder: visualOrder(navNodes), badLabels: badLabels.slice(0, 20), escaped, scroll, prose,
      home: cards && records ? { domOrder: !!(cards.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING), visualOrder: cards.getBoundingClientRect().bottom <= records.getBoundingClientRect().top + 1, cards: [...cards.querySelectorAll('a')].map(e => new URL(e.href).pathname), posts: [...records.querySelectorAll('.record-row__link')].map(e => new URL(e.href).pathname) } : null,
      cells, footerLinks, footerOverlap, footerOrder: visualOrder(groups),
      pseudoCopy: [...document.querySelectorAll('.site-footer, .site-footer *')].flatMap(e => ['::before', '::after'].map(p => ({ selector: name(e) + p, content: getComputedStyle(e, p).content }))).filter(p => !['none', 'normal', '""', "''"].includes(p.content)).slice(0, 12),
    };
  });
}
const fontSelectors = ['.site-brand__name', '.site-nav > a', '.masthead h1', '.index-heading h1', '.page-heading h1', '.record-head h1', '.masthead__lede', '.page-prose p', '#article-body > p', '#article-body pre code', '.site-footer__note'];
async function renderedFonts(page, cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 }); const rows = [];
  for (const selector of fontSelectors) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector }); if (!nodeId) continue;
    const info = await page.$eval(selector, e => { const s = getComputedStyle(e); return { visible: !!e.getClientRects().length, family: s.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), fontSize: s.fontSize }; });
    if (!info.visible) continue;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    rows.push({ selector, ...info, fonts: fonts.filter(f => f.glyphCount > 0).map(({ familyName, postScriptName, isCustomFont, glyphCount }) => ({ familyName, postScriptName, isCustomFont, glyphCount })) });
  }
  return rows;
}
const normalizeFamily = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function usedSelectedFace(row) {
  const expected = normalizeFamily(row.family);
  return row.fonts.some(f => f.isCustomFont && (normalizeFamily(f.familyName) === expected || normalizeFamily(f.postScriptName || '').startsWith(expected)));
}
async function warmOptional(page) {
  return page.evaluate(async selectors => {
    const wanted = [...new Set(selectors.flatMap(selector => {
      const e = document.querySelector(selector); if (!e) return [];
      const s = getComputedStyle(e); return [`${s.fontStyle} ${s.fontWeight} 20px ${s.fontFamily.split(',')[0]}`];
    }))];
    const result = await Promise.race([Promise.all(wanted.map(async font => ({ font, count: (await document.fonts.load(font, 'deuterium Proof 0123 ABC xyz')).length }))), new Promise((_, reject) => setTimeout(() => reject(new Error('Optional font warming timeout')), 12000))]);
    await document.fonts.ready; return result;
  }, fontSelectors);
}
async function focusChecks(page) {
  const rows = [];
  // Keyboard modality before programmatic focus makes :focus-visible meaningful;
  // retain actual keyboard Tab traversal as a separate sample.
  await page.keyboard.press('Tab');
  for (const selector of ['.site-nav > a', '.skin-menu summary', '.site-footer__links a', '.site-footer__mystery']) {
    const before = await page.$eval(selector, e => { const s = getComputedStyle(e); return [s.outline, s.boxShadow, s.backgroundColor, s.color, s.borderColor].join('|'); });
    await page.focus(selector);
    rows.push(await page.$eval(selector, (e, before) => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const paint = [s.outline, s.boxShadow, s.backgroundColor, s.color, s.borderColor].join('|');
      return { selector: e.id || e.className || e.tagName, focused: document.activeElement === e, focusVisible: e.matches(':focus-visible'), visible: r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1, stylePresent: parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none' || paint !== before };
    }, before));
  }
  await page.focus('.site-nav > a'); await page.keyboard.press('Tab');
  rows.push(await page.evaluate(() => ({ selector: 'Tab from Home to Archive', focused: document.activeElement === document.querySelectorAll('.site-nav > a')[1], focusVisible: document.activeElement.matches(':focus-visible'), visible: !!document.activeElement.getClientRects().length, stylePresent: getComputedStyle(document.activeElement).outlineStyle !== 'none' || getComputedStyle(document.activeElement).boxShadow !== 'none' })));
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  return rows;
}
async function pickerCheck(page) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('.skin-menu summary');
  const result = await page.evaluate(() => {
    const details = document.querySelector('.skin-menu'), panel = document.querySelector('.skin-menu__panel'), picker = document.querySelector('#skin-picker');
    const inBounds = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1; };
    const r = picker.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
    return { open: details.open, panelBounds: inBounds(panel), pickerBounds: inBounds(picker), notCovered: hit === picker || picker.contains(hit), options: picker.options.length, selected: picker.value };
  });
  await page.focus('#skin-picker'); result.focus = await page.$eval('#skin-picker', e => e === document.activeElement && e.matches(':focus-visible'));
  await page.click('.skin-menu summary'); await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  return result;
}
function issuesFor(m, job) {
  const issues = [];
  const require = (yes, code) => { if (!yes) issues.push(code); };
  require(m.skin === job.theme && m.mode === job.mode && m.picker === job.theme, 'theme-selection');
  require(m.viewportOverflow <= 1, 'viewport-overflow'); require(!m.escaped.length, 'uncontained-overflow');
  require(m.scroll.every(s => s.moved), 'local-scroll-stuck'); require(!m.badLabels.length, 'title-or-label-bounds');
  require(m.header && m.main && m.footer && !m.headerOverlap, 'header-main-geometry');
  require(m.footer && m.main && m.footer.y >= m.main.bottom - 1, 'footer-before-content-end');
  require(JSON.stringify(m.nav.map(n => n.path)) === JSON.stringify(['/', '/archive.html', '/WriteUps/', '/ctf-tutorials/', '/ramblings/', '/about.html'].map(p => base + p)), 'navigation-destinations-or-order');
  require(m.nav.every(n => n.visible), 'hidden-navigation'); require(!m.navOverlap, 'navigation-overlap'); require(m.navOrder.join(',') === '0,1,2,3,4,5', 'navigation-visual-order');
  if (job.page === 'home') require(m.home?.domOrder && m.home?.visualOrder, 'publications-before-posts');
  if (job.page === 'article') {
    require(m.prose.length > 0, 'missing-long-prose');
    const widths = m.prose.map(p => p.width).sort((a, b) => a - b), median = widths[Math.floor(widths.length / 2)];
    require(m.prose.every(p => Number.isFinite(p.ch) && p.ch <= 100), 'article-over-100ch');
    if (job.width <= 390) require(median >= job.width * .75, 'article-narrow-mobile');
    if (job.width >= 1200) require(median >= 560, 'article-narrow-desktop');
  }
  require(m.footerLinks.map(l => l.label).join(',') === 'GitHub,Twitter,LinkedIn,Discord,Email,Feed' && m.footerLinks.every(l => l.visible), 'footer-six-links');
  require(m.footerLinks.every(l => !l.decoration.includes('underline')), 'forced-footer-underlines');
  require(m.cells.length === 3 && m.cells.map(c => c.slot).join(',') === '0,1,2' && m.cells.every(c => c.visible && c.enabled && c.width >= 44 && c.height >= 44 && c.ancestorsInFlow && !['absolute', 'fixed'].includes(c.position) && c.x >= -1 && c.right <= job.width + 1), 'footer-three-44px-in-flow-cells');
  require(!m.footerOverlap && m.footerOrder.join(',') === '0,1', 'footer-overlap-or-order'); require(!m.pseudoCopy.length, 'footer-pseudo-copy');
  return issues;
}

let browser, site, before, axeSource, fatal;
const results = [], fallbackResults = [], comparisons = [];
const started = new Date().toISOString();
const shotWidths = new Set([widths.includes(390) ? 390 : Math.min(...widths), widths.includes(1440) ? 1440 : Math.max(...widths)]);
const jobs = themes.flatMap(theme => widths.flatMap(width => modes.flatMap(mode => pages.map(page => ({ theme, width, mode, page })))));
const fullMatrix = Object.entries(defaults).every(([k, values]) => JSON.stringify([...({ themes, widths, modes, pages }[k])].sort()) === JSON.stringify([...values].sort()));
const keyOf = job => `${job.theme}-${job.width}-${job.mode}-${job.page}`;
async function open(input, job, failFonts = false) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const network = { requests: 0, externalBlocked: 0, denied: 0, localErrors: [], jsErrors: [], fonts: [], fontRequests: 0, themeLibraryRequests: 0, failedFonts: 0, dismissedCookieNotices: 0 };
  try {
    await page.setViewport({ width: job.width, height: 1000, deviceScaleFactor: 1 });
    await page.emulateTimezone('UTC');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: job.mode }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setBypassServiceWorker(true); await page.setRequestInterception(true);
    page.on('pageerror', e => bounded(network.jsErrors, safeError(e)));
    page.on('request', request => { void (async () => {
      network.requests++;
      const u = new URL(request.url());
      if (u.protocol === 'data:') return request.continue(); // Inline data is not network acquisition.
      if (u.origin !== ORIGIN) { network.externalBlocked++; return request.abort('blockedbyclient'); }
      if (!['GET', 'HEAD'].includes(request.method())) { network.denied++; return request.abort('blockedbyclient'); }
      const entry = input.resolve(request.url());
      if (!entry) { network.denied++; bounded(network.localErrors, u.pathname.slice(0, 180)); return request.respond({ status: 404, body: 'Not allowlisted' }); }
      const font = /\.(woff2?|ttf|otf)$/.test(entry.relative);
      if (font) {
        network.fontRequests++; bounded(network.fonts, entry.relative, 100);
        if (entry.relative.includes('/theme-library/')) network.themeLibraryRequests++;
        if (failFonts && entry.relative.includes('/theme-library/')) { network.failedFonts++; return request.abort('failed'); }
      }
      return request.respond({ status: 200, contentType: entry.type, headers: { 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'self'" }, body: request.method() === 'HEAD' ? '' : fs.readFileSync(entry.file) });
    })().catch(e => { bounded(network.localErrors, safeError(e)); if (!request.isInterceptResolutionHandled()) request.abort('failed').catch(() => {}); }); });
    const cdp = await page.createCDPSession(); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const navigate = async () => {
      const res = await page.goto(ORIGIN + base + routes[job.page] + '?skin=' + job.theme, { waitUntil: 'load', timeout: 45000 });
      assert.equal(res.status(), 200, 'Generated navigation failed');
      await page.waitForNetworkIdle({ idleTime: 100, timeout: 12000 });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Font settling timeout')), 12000))]));
      // Compare the same user-visible state. Leave the 1% draw untouched and
      // dismiss an offered notice through its real Reject button, not a mask.
      if (await page.$('#cookie-banner')) {
        await page.waitForSelector('#cookie-banner:not([hidden])', { timeout: 2000 });
        await page.click('#cookie-banner .cookie-banner__btn:nth-child(2)');
        await page.waitForSelector('#cookie-banner', { hidden: true });
        network.dismissedCookieNotices++;
      }
    };
    await navigate();
    return { context, page, network, cdp, navigate };
  } catch (e) { await context.close(); throw e; }
}
async function axeCheck(page) {
  if (!axeSource) return { status: opt.axe === 'off' ? 'skipped' : 'unavailable', violations: [], incomplete: [] };
  try {
    await page.addScriptTag({ content: axeSource });
    return await page.evaluate(async () => {
      const r = await window.axe.run({ include: ['.site-header', '#content', '#site-footer'] }, { runOnly: ['color-contrast'], resultTypes: ['violations', 'incomplete'], rules: { 'color-contrast': { enabled: true } } });
      const digest = rows => rows.slice(0, 12).map(r => ({ id: r.id, impact: r.impact, nodes: r.nodes.length, targets: r.nodes.slice(0, 5).map(n => n.target), samples: r.nodes.slice(0, 5).map(n => ({ target: n.target, checks: [...n.any, ...n.all, ...n.none].slice(0, 4).map(c => ({ id: c.id, data: Object.fromEntries(['fgColor', 'bgColor', 'contrastRatio', 'expectedContrastRatio', 'fontSize', 'fontWeight'].filter(k => c.data?.[k] !== undefined).map(k => [k, c.data[k]])) })) })) }));
      return { status: r.incomplete.length ? 'incomplete' : r.violations.length ? 'violations' : 'passed-selected-checks', violations: digest(r.violations), incomplete: digest(r.incomplete) };
    });
  } catch (e) { return { status: 'error', error: safeError(e), violations: [], incomplete: [] }; }
}
async function screenshots(page, dir, job, force = false) {
  if (opt['no-screenshots'] || !force && !shotWidths.has(job.width)) return [];
  const names = [];
  for (const region of ['top', ...(job.page === 'article' ? ['article'] : []), 'footer']) {
    await page.evaluate(region => {
      if (region === 'top') scrollTo(0, 0);
      else document.querySelector(region === 'article' ? '#article-body' : '#site-footer').scrollIntoView({ block: region === 'footer' ? 'end' : 'start', behavior: 'instant' });
    }, region);
    const file = `${dir}/${region}.png`; await page.screenshot({ path: path.join(out, file) }); names.push(file);
  }
  await page.evaluate(() => scrollTo(0, 0)); return names;
}
async function stableSignature(page, selector) {
  const rows = await page.$eval(selector, root => {
    const props = ['display', 'position', 'width', 'height', 'padding', 'margin', 'gap', 'gridTemplateColumns', 'gridTemplateRows', 'gridArea', 'flex', 'order', 'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'border', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings', 'fontPalette', 'lineHeight', 'letterSpacing', 'textShadow', 'textDecoration', 'textTransform', 'opacity', 'transform', 'overflow', 'clipPath', 'filter', 'content'];
    return [root, ...root.querySelectorAll('*')].filter(e => e.getClientRects().length && !e.matches('option, script, style')).map(e => {
      const r = e.getBoundingClientRect(), style = pseudo => Object.fromEntries(props.map(p => [p, getComputedStyle(e, pseudo)[p]]));
      return { tag: e.tagName, class: typeof e.className === 'string' ? e.className : '', rect: [r.x, r.y + scrollY, r.width, r.height].map(n => Math.round(n * 100) / 100), style: style(null), before: style('::before'), after: style('::after') };
    });
  });
  return { nodes: rows.length, sha256: hash(JSON.stringify(rows)), rows };
}
async function stableRegions(c, dir, job) {
  const selectors = { header: '.site-header', footer: '#site-footer', ...(job.page === 'home' ? { home: '.masthead', publications: '.section-cards', posts: '#records .record-row' } : job.page === 'article' ? { article: '.record-head', prose: '#article-body > p' } : { heading: job.page === 'about' ? '.page-heading' : '.index-heading' }) };
  const result = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const el = await c.page.$(selector); assert.ok(el, `Missing RPN stable region: ${selector}`);
    await el.evaluate(e => e.scrollIntoView({ behavior: 'instant', block: 'start' }));
    await c.page.waitForNetworkIdle({ idleTime: 100, timeout: 12000 });
    await c.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const a = await stableSignature(c.page, selector);
    const first = opt['no-screenshots'] ? null : pixels(Buffer.from(await el.screenshot({ path: path.join(out, dir, `rpn-${name}-a.png`) })));
    await pause(120);
    const b = await stableSignature(c.page, selector);
    const second = opt['no-screenshots'] ? null : pixels(Buffer.from(await el.screenshot({ path: path.join(out, dir, `rpn-${name}-b.png`) })));
    write(`${dir}/rpn-${name}-styles.json`, { selector, first: a, second: b });
    result[name] = { selector, styleStable: a.sha256 === b.sha256, styleHash: b.sha256, pixelStable: first && first.sha256 === second.sha256 && first.width === second.width && first.height === second.height, pixels: second };
  }
  await c.page.evaluate(() => scrollTo(0, 0));
  return result;
}
async function compareRpn(afterContext, dir, job, afterFonts) {
  const priorDir = dir + '/before'; fs.mkdirSync(path.join(out, priorDir));
  const prior = await open(before, job);
  try {
    await warmOptional(prior.page); await prior.navigate();
    const baselineFonts = await renderedFonts(prior.page, prior.cdp);
    const a = await stableRegions(prior, priorDir, job), b = await stableRegions(afterContext, dir, job);
    const result = { key: keyOf(job), method: 'Exact decoded RGBA pixels and separate computed geometry/paint signatures; CDP actual fonts, not source hashes.', issues: [], regions: [], fontsEqual: JSON.stringify(baselineFonts) === JSON.stringify(afterFonts) };
    if (!result.fontsEqual) result.issues.push('rpn-rendered-fonts-changed');
    for (const name of Object.keys(a)) {
      const left = a[name], right = b[name], styleCompared = left.styleStable && right.styleStable, pixelCompared = !!(left.pixelStable && right.pixelStable);
      const delta = pixelCompared ? pixelDifference(left.pixels, right.pixels) : null;
      const row = { name, selector: left.selector, styleCompared, styleEqual: styleCompared ? left.styleHash === right.styleHash : null, pixelCompared, delta, limitation: !styleCompared || !pixelCompared ? opt['no-screenshots'] ? 'Pixel checks disabled explicitly.' : 'Region changed between repeat captures; unstable channel not compared. Both captures retained; no pixels masked.' : null };
      if (row.styleEqual === false) result.issues.push(`rpn-${name}-style-changed`);
      if (delta && (!delta.sameDimensions || delta.changedPixels)) result.issues.push(`rpn-${name}-pixels-changed`);
      if (!styleCompared && !pixelCompared) result.issues.push(`rpn-${name}-comparison-incomplete`);
      result.regions.push(row);
    }
    result.baselineFontRequests = prior.network.fonts;
    if (prior.network.themeLibraryRequests || afterContext.network.themeLibraryRequests) result.issues.push('rpn-requested-theme-library-font');
    if (prior.network.localErrors.length || prior.network.jsErrors.length) result.issues.push('rpn-baseline-load-error');
    write(`${priorDir}/case.json`, { fonts: baselineFonts, network: prior.network });
    return result;
  } finally { await prior.context.close(); }
}
async function runCase(job, fallback = false) {
  const key = keyOf(job), dir = `${fallback ? 'fallback' : 'cases'}/${key}`;
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  const result = { ...job, key, pass: false, completed: false, issues: [], directory: dir };
  let c;
  const checkpoint = phase => { result.phase = phase; fs.appendFileSync(path.join(out, dir, 'events.jsonl'), JSON.stringify({ phase, time: new Date().toISOString() }) + '\n'); };
  try {
    checkpoint('cold-navigation'); c = await open(site, job, fallback);
    checkpoint('cold-rendered-fonts'); result.coldFonts = await renderedFonts(c.page, c.cdp);
    result.coldFallback = result.coldFonts.filter(r => families[job.theme]?.includes(r.family) && !usedSelectedFace(r)).map(r => r.selector);
    if (!fallback) {
      checkpoint('cold-layout'); const metrics = await measure(c.page), issues = issuesFor(metrics, job);
      result.coldLayout = { issues, viewportOverflow: metrics.viewportOverflow, prose: metrics.prose, cells: metrics.cells };
      result.issues.push(...issues.map(code => 'cold:' + code));
      if (issues.length) {
        write(`${dir}/cold-layout.json`, metrics); fs.mkdirSync(path.join(out, dir, 'cold'));
        result.coldScreenshots = await screenshots(c.page, dir + '/cold', job, true);
      }
    }
    if (!fallback) { checkpoint('optional-font-warming'); result.warming = await warmOptional(c.page); checkpoint('warm-navigation'); await c.navigate(); }
    checkpoint('warm-rendered-fonts'); result.fonts = await renderedFonts(c.page, c.cdp);
    checkpoint('layout'); result.metrics = await measure(c.page); result.issues.push(...issuesFor(result.metrics, job));
    if (fallback) {
      if (!c.network.failedFonts) result.issues.push('failure-control-did-not-block-a-selected-font');
      if (result.fonts.some(r => families[job.theme]?.includes(r.family) && usedSelectedFace(r))) result.issues.push('selected-font-rendered-despite-failure-control');
    } else if (job.theme !== RPN) {
      const selected = result.fonts.filter(r => families[job.theme].includes(r.family));
      if (!selected.length) result.issues.push('no-selected-font-samples');
      for (const row of selected) if (!usedSelectedFace(row)) result.issues.push(`selected-font-not-rendered:${row.selector}:${row.family}`);
      if (!selected.some(r => /h1|brand/.test(r.selector)) || !selected.some(r => /lede|prose|article-body|note/.test(r.selector))) result.issues.push('missing-display-or-body-font-coverage');
      const unexpected = result.fonts.filter(r => !families[job.theme].includes(r.family));
      if (unexpected.length) result.issues.push('sample-inherits-unselected-font-stack');
    }
    checkpoint('screenshots'); result.screenshots = await screenshots(c.page, dir, job);
    if (job.theme === RPN && !fallback) {
      checkpoint('rpn-baseline-comparison'); result.rpn = await compareRpn(c, dir, job, result.fonts); comparisons.push(result.rpn); result.issues.push(...result.rpn.issues);
    }
    checkpoint('opened-picker'); result.picker = await pickerCheck(c.page);
    if (!result.picker.open || !result.picker.panelBounds || !result.picker.pickerBounds || !result.picker.notCovered || !result.picker.focus || result.picker.selected !== job.theme) result.issues.push('opened-picker');
    checkpoint('keyboard-focus'); result.focus = await focusChecks(c.page);
    if (result.focus.some(f => !f.focused || !f.focusVisible || !f.visible || !f.stylePresent)) result.issues.push('focus');
    const stableBefore = (await measure(c.page)).cells;
    await pause(150);
    const stableAfter = (await measure(c.page)).cells;
    if (JSON.stringify(stableBefore) !== JSON.stringify(stableAfter)) result.issues.push('footer-cells-unstable-idle');
    checkpoint('axe-selected-contrast'); result.axe = fallback ? { status: 'not-run-in-failure-control' } : await axeCheck(c.page);
    if (result.axe.violations?.length) result.issues.push('axe-selected-contrast');
    if (result.axe.status === 'error') result.issues.push('axe-execution-error');
    result.network = c.network;
    if (c.network.localErrors.length || c.network.jsErrors.length) result.issues.push('generated-load-errors');
    if (job.theme === RPN && c.network.themeLibraryRequests) result.issues.push('rpn-requested-theme-library-font');
    if (result.issues.length && !result.screenshots.length) result.screenshots = await screenshots(c.page, dir, job, true);
    result.completed = true; result.pass = !result.issues.length; checkpoint('completed');
  } catch (e) { result.error = `${result.phase}: ${safeError(e)}`; result.issues.push('case-execution-error'); if (c) result.network = c.network; }
  finally { if (c) await c.context.close(); write(`${dir}/case.json`, result); }
  return result;
}

try {
  write('confinement-controls.json', confinementControls());
  site = generatedSite(opt.site); before = generatedSite(opt.before);
  if (site.root === before.root && !opt.provisional) throw new Error('Identical site and baseline require --provisional; this is not integration');
  const require = createRequire(import.meta.url);
  const modulePath = path.resolve(repo, opt.puppeteer || '.toolchain/verify/lighthouse-node_modules/puppeteer-core');
  const imported = await import(pathToFileURL(require.resolve(modulePath)).href), puppeteer = imported.default || imported;
  const chrome = path.resolve(repo, opt.chrome || '.toolchain/verify/browser/chrome-linux64/chrome');
  assert.ok(fs.existsSync(chrome), 'Cached Chromium missing; no installs permitted');
  const libs = ['agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu', 'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu', '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'].map(p => path.join(repo, p)).filter(p => fs.existsSync(p));
  const runtime = path.join(out, 'runtime'); fs.mkdirSync(runtime);
  const cwd = process.cwd(); process.chdir(runtime);
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, protocolTimeout: 60000, userDataDir: path.join(runtime, 'profile'),
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC', HOME: runtime, TMPDIR: '.', XDG_CACHE_HOME: path.join(runtime, 'cache'), XDG_CONFIG_HOME: path.join(runtime, 'config'), LD_LIBRARY_PATH: libs.join(':') },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--dns-prefetch-disable', '--disable-client-side-phishing-detection', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--no-first-run', '--disable-default-apps', '--disable-quic', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--lang=en-US'] });
  } finally { process.chdir(cwd); }
  const axePaths = opt.axe === 'off' ? [] : opt.axe === 'auto' ? ['.toolchain/verify/lighthouse-node_modules/axe-core/axe.min.js', '.toolchain/node_modules/axe-core/axe.min.js'].map(p => path.join(repo, p)) : [path.resolve(repo, opt.axe)];
  const axePath = axePaths.find(p => fs.existsSync(p)); if (axePath) axeSource = fs.readFileSync(axePath, 'utf8');
  if (!axePath && !['off', 'auto'].includes(opt.axe)) throw new Error('Requested local axe script missing');
  const inventory = input => [...input.files.values()].filter(e => e.relative.endsWith('.html') || e.relative === 'assets/css/main.css' || Object.values(skinFiles).includes(e.relative)).map(e => ({ path: e.relative, sha256: hash(fs.readFileSync(e.file)) }));
  write('run.json', { started, provisional: !!opt.provisional, options: opt, planned: jobs.length, fullMatrix, origin: ORIGIN, browser: await browser.version(), modulePath, chrome, libs, axe: axePath || null, site: site.root, before: before.root, allowlistFiles: site.files.size, inventory: inventory(site), beforeInventory: inventory(before), limitations: ['Blocked external embeds and analytics are not validated.', 'Article measure budgets: <=100 measured zero-glyph units; >=75% viewport on mobile; >=560px at desktop. These are regression budgets, not aesthetic scores.', 'Focus samples and optional axe color-contrast are not a complete accessibility audit.', 'Reduced motion only; random draws are not mocked. An offered cookie notice is dismissed via its real Reject button and recorded; no overlay masking. RPN unstable channels are disclosed with repeat captures.', 'Toy activation, no-JS and print are covered separately by test-article-layout.mjs.', 'Font hashes identify inputs only. RPN parity uses actual CDP fonts, style signatures and decoded pixels.'] });
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < jobs.length) {
      const result = await runCase(jobs[cursor++]); results.push(result);
      fs.appendFileSync(path.join(out, 'cases.jsonl'), JSON.stringify({ key: result.key, pass: result.pass, completed: result.completed, issues: result.issues, directory: result.directory }) + '\n');
      if (results.length % 12 === 0 || results.length === jobs.length) console.log(`${results.length}/${jobs.length} cases; ${results.filter(r => !r.pass).length} failing`);
    }
  }));
  if (!opt['no-fallback']) {
    // One mobile and one wide home/article per selected skin and mode. Separate
    // font-failure scenarios do not inflate the 240 generated-page matrix count.
    const faultJobs = jobs.filter(j => j.theme !== RPN && ['home', 'article'].includes(j.page) && shotWidths.has(j.width));
    cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < faultJobs.length) fallbackResults.push(await runCase(faultJobs[cursor++], true)); }));
  }
} catch (e) { fatal = safeError(e); write('ERROR.md', `# Browser execution error\n\n${fatal}\n`); }
finally {
  if (browser) await browser.close().catch(e => { fatal ||= safeError(e); });
  fs.rmSync(path.join(out, 'runtime'), { recursive: true, force: true });
  const failures = [...results, ...fallbackResults].filter(r => !r.pass);
  const counts = {};
  for (const r of failures) for (const code of r.issues) counts[code] = (counts[code] || 0) + 1;
  const status = fatal || failures.length || results.length !== jobs.length ? 'failed' : 'passed';
  const summary = { status, provisional: !!opt.provisional, started, ended: new Date().toISOString(), planned: jobs.length, completed: results.filter(r => r.completed).length, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, fullMatrix, integrationClaim: !opt.provisional && fullMatrix && !opt['no-screenshots'] && !opt['no-fallback'] && status === 'passed', fatal,
    failureCounts: counts, failures: failures.slice(0, 30).map(r => ({ key: r.key, directory: r.directory, issues: r.issues, error: r.error })), omittedFailures: Math.max(0, failures.length - 30),
    fallback: { status: opt['no-fallback'] ? 'skipped' : fallbackResults.length ? fallbackResults.every(r => r.pass) ? 'passed' : 'failed' : 'not-applicable-or-incomplete', cases: fallbackResults.length, failed: fallbackResults.filter(r => !r.pass).length },
    coldFonts: { casesWithFallback: results.filter(r => r.coldFallback?.length).length, casesWithLayoutIssues: results.filter(r => r.coldLayout?.issues.length).length, policy: 'Cold optional fallback is not a warmed-font failure. Cold layout failures are recorded separately with a cold: prefix.' },
    rpn: { cases: comparisons.length, changed: comparisons.filter(c => c.issues.length).length, styleRegionsCompared: comparisons.reduce((n, c) => n + c.regions.filter(r => r.styleCompared).length, 0), pixelRegionsCompared: comparisons.reduce((n, c) => n + c.regions.filter(r => r.pixelCompared).length, 0), limitedRegions: comparisons.reduce((n, c) => n + c.regions.filter(r => r.limitation).length, 0), method: 'Decoded RGBA exact pixel comparison, separate computed style/geometry and CDP font comparisons. Unstable channels are not masked or called pixel passes.' },
    screenshots: { disabled: !!opt['no-screenshots'], widths: [...shotWidths], files: [...results, ...fallbackResults].reduce((n, r) => n + (r.screenshots?.length || 0) + (r.coldScreenshots?.length || 0), 0), rpnRepeatRegions: 'Stored in per-case folders; not included in viewport screenshot count.' },
    axe: Object.fromEntries([...new Set(results.map(r => r.axe?.status || 'not-reached'))].map(s => [s, results.filter(r => (r.axe?.status || 'not-reached') === s).length])),
    coverageLimits: [!fullMatrix && 'Subset selected; not full redesign coverage.', opt.provisional && 'Provisional input; integrated output not tested.', opt['no-screenshots'] && 'Pixel checks and actual screenshots disabled.', opt['no-fallback'] && 'Failure fallback scenarios disabled.', !axeSource && 'Axe unavailable or explicitly disabled; no accessibility pass.', results.some(r => r.axe?.incomplete?.length) && 'Axe has incomplete contrast results; these are not accessibility passes.', !themes.includes(RPN) && 'RPN baseline comparison not selected.'].filter(Boolean),
  };
  write('summary.json', summary); console.log(JSON.stringify({ status, planned: jobs.length, passed: summary.passed, failed: summary.failed, out: path.relative(repo, out) }));
  if (status === 'failed') process.exitCode = 1;
}
