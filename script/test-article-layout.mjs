#!/usr/bin/env node
/**
 * Offline article/footer browser regression runner. No builds or source edits.
 *
 * BEFORE (observations do not make the process fail; infrastructure errors do):
 *   node script/test-article-layout.mjs --site agent_out/article-layout-rework/before \
 *     --out agent_out/article-layout-rework/browser/before --mode baseline
 * AFTER (assertions fail the process; use the before summary for home parity):
 *   BLOG_SITE=agent_out/article-layout-rework/after node script/test-article-layout.mjs \
 *     --out agent_out/article-layout-rework/browser/after --mode assert-after \
 *     --reference agent_out/article-layout-rework/browser/before/summary.json
 * Use --help for subsets, baseurl, browser paths, budgets and coverage limits.
 * The server mounts the supplied generated tree at --baseurl without rewriting
 * HTML. A site built for /prefix must be tested with --baseurl /prefix.
 * Outputs are confined to agent_out/article-layout-rework/browser. No cookies,
 * storage contents, article prose, response bodies or external URL queries are logged.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedOut = path.join(repo, 'agent_out/article-layout-rework/browser');
const LONG = '/2026/03/03/unfaithful-claims-breaking-6-zkvms.html';
const SHORT = '/challenges/google-ctf-2024/idea/';
const { values: opt } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' }, site: { type: 'string' }, out: { type: 'string' },
  mode: { type: 'string', default: 'baseline' }, baseurl: { type: 'string', default: '' },
  concurrency: { type: 'string', default: '5' }, widths: { type: 'string', default: '320,390,768,1440' },
  themes: { type: 'string', default: 'all' }, schemes: { type: 'string', default: 'light,dark' },
  article: { type: 'string', default: LONG }, short: { type: 'string', default: SHORT },
  'print-primer': { type: 'string', default: '/robots.txt' },
  reference: { type: 'string' }, chrome: { type: 'string' }, puppeteer: { type: 'string' },
  axe: { type: 'string', default: 'auto' }, extras: { type: 'boolean', default: true },
  'no-extras': { type: 'boolean', default: false }, screenshots: { type: 'boolean', default: true },
  'no-screenshots': { type: 'boolean', default: false },
  'min-mobile-ratio': { type: 'string', default: '0.75' },
  'min-desktop-prose': { type: 'string', default: '560' },
  'max-prose-ch': { type: 'string', default: '100' }, 'max-font-bytes': { type: 'string', default: '0' },
  'toy-wait-ms': { type: 'string', default: '15000' },
} });
if (opt.help) {
  console.log(`Offline article/footer browser checks (Node 18+).
--site PATH / BLOG_SITE          Required generated output; never builds.
--out PATH / BLOG_RESULT_DIR     Required result directory under agent_out/article-layout-rework/browser.
--mode baseline|assert-after     Explore before; assert the documented budgets after.
--reference PATH                Before summary.json, required for home-order parity in assert-after extras.
--baseurl /prefix               Mount point; does not repair incorrectly generated asset URLs.
--concurrency 5                 1..6 isolated contexts (cold HTTP cache for each case).
--themes all|id,id --schemes light,dark --widths 320,390,768,1440
--article PATH --short PATH      Long article and short authored challenge routes.
--print-primer /robots.txt       Route intercepted as an inert, local origin primer; no fonts.
--chrome PATH / CHROME_BIN --puppeteer PATH --axe auto|off|PATH
--no-extras --no-screenshots      Explicit reduced coverage, always reported.
--min-mobile-ratio .75           Prose content box / viewport at widths <=390.
--min-desktop-prose 560          Minimum desktop prose content box at widths >=1200.
--max-prose-ch 100               Maximum prose content width in measured font zero-glyph units.
--max-font-bytes 0              Optional per-cold-load font body-byte cap (0 records only).
--toy-wait-ms 15000             Real elapsed stability check without reduced motion.

Default matrix: 5 generated picker themes x 2 schemes x 4 widths = 40.
Each case checks nonempty prose, content/ink widths, footer siblings and visual
order, overflow/scroll containers, selected keyboard focus styles and font bytes.
Axe color-contrast only: article opening paragraph, contents, footer; incomplete
results are not passes. Gradient/pseudo-element contrast needs manual review.
Extras: short article in four viewports; home navigation/order; no-JS contents
and footer; saved/query themes; stable lazy toy controls and activation; cold
print media before article navigation with JS and without JS, plus a one-page
PDF. An inert HTML origin primer avoids Chrome losing print emulation on its first
cross-origin navigation; its data favicon prevents a root-favicon probe. No article
assets or fonts are warmed.
No header-height or small-header budget. This is not a whole-site accessibility
audit. Width/focus heuristics are regression budgets, not WCAG certifications.
The local server accepts GET/HEAD only and confines realpaths (including symlinks)
to the site. External HTTP is aborted, browser egress is sent to a local rejecting
proxy, DNS resolution is disabled, and CSP blocks external connections/frames.
All artifacts stay local. Subsets and zero-case runs never imply full coverage.`);
  process.exit(0);
}
const absolute = p => path.resolve(repo, p);
const within = (root, file) => file === root || file.startsWith(root + path.sep);
const hash = b => createHash('sha256').update(b).digest('hex');
const pause = ms => new Promise(r => setTimeout(r, ms));
const bounded = (a, item, max = 24) => { if (a.length < max) a.push(item); };
const number = (key, min, max) => {
  const n = Number(opt[key]);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid --${key}`);
  return n;
};
const siteArg = opt.site || process.env.BLOG_SITE;
const outArg = opt.out || process.env.BLOG_RESULT_DIR;
if (!siteArg || !outArg) throw new Error('--site/BLOG_SITE and --out/BLOG_RESULT_DIR are required; see --help');
if (!['baseline', 'assert-after'].includes(opt.mode)) throw new Error('Invalid --mode');
const site = fs.realpathSync(absolute(siteArg));
if (!fs.statSync(site).isDirectory() || !fs.existsSync(path.join(site, 'index.html'))) throw new Error('Site must be generated output with index.html');
const indexFile = fs.realpathSync(path.join(site, 'index.html'));
if (!within(site, indexFile) || !/<html[\s>]/i.test(fs.readFileSync(indexFile, 'utf8').slice(0, 4000))) throw new Error('Expected generated HTML, not a source tree');
// Resolve existing ancestors before mkdir: a symlink in the output path must not escape.
const out = absolute(outArg);
let ancestor = out;
while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
const resolvedOut = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, out));
if (!within(allowedOut, out) || !within(allowedOut, resolvedOut) || within(site, out)) throw new Error('Unsafe output directory');
fs.mkdirSync(out, { recursive: true });
if (fs.existsSync(path.join(out, 'summary.json'))) throw new Error('Refusing to overwrite a completed run; use a fresh --out');
const write = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const budget = { minMobileRatio: number('min-mobile-ratio', .1, 1), minDesktop: number('min-desktop-prose', 1, 2000), maxCh: number('max-prose-ch', 1, 300), fontBytes: number('max-font-bytes', 0, 1e9) };
const concurrency = number('concurrency', 1, 6);
if (!Number.isInteger(concurrency)) throw new Error('Concurrency must be an integer');
const toyWait = number('toy-wait-ms', 0, 60000);
const widths = [...new Set(opt.widths.split(',').map(Number))];
if (!widths.length || widths.some(n => !Number.isInteger(n) || n < 240 || n > 2560)) throw new Error('Invalid widths');
const schemes = [...new Set(opt.schemes.split(','))];
if (!schemes.length || schemes.some(s => !['light', 'dark'].includes(s))) throw new Error('Invalid schemes');
const base = opt.baseurl === '/' ? '' : opt.baseurl.replace(/\/$/, '');
if (base && (!/^\/[a-zA-Z0-9/_-]+$/.test(base) || base.includes('//'))) throw new Error('Invalid baseurl');
for (const route of [opt.article, opt.short, opt['print-primer']]) if (!route.startsWith('/') || route.startsWith('//') || /[?#\\]/.test(route)) throw new Error('Use site-relative article routes without queries');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.xml': 'application/xml', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
let origin;
const serverStats = { requests: 0, rejected: 0, errors: 0 };
const server = http.createServer(async (req, res) => {
  serverStats.requests++;
  const deny = status => { serverStats.rejected++; res.writeHead(status).end(); };
  try {
    if (!['GET', 'HEAD'].includes(req.method) || !req.url.startsWith('/') || req.url.startsWith('//') || req.headers.host !== new URL(origin).host) return deny(403);
    const raw = req.url.split('?')[0];
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(p => p === '..' || p === '.')) return deny(403);
    if (base && decoded !== base && !decoded.startsWith(base + '/')) return deny(404);
    const suffix = decoded.slice(base.length) || '/';
    let file = path.resolve(site, '.' + suffix);
    if (!within(site, file)) return deny(403);
    file = await fsp.realpath(file);
    if (!within(site, file)) return deny(403);
    let stat = await fsp.stat(file);
    if (stat.isDirectory()) { file = await fsp.realpath(path.join(file, 'index.html')); stat = await fsp.stat(file); }
    if (!within(site, file) || !stat.isFile()) return deny(403);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "connect-src 'self'; frame-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'self'; worker-src 'none'" });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return deny(404);
    serverStats.errors++; res.writeHead(400).end();
  }
});
const proxyStats = { rejected: 0, resets: 0 };
const proxy = http.createServer((_req, res) => { proxyStats.rejected++; res.writeHead(403).end(); });
// Chromium may reset a denied CONNECT while its context is being destroyed.
// A reset is expected egress denial, not an uncaught Node socket error.
proxy.on('connection', socket => socket.on('error', () => { proxyStats.resets++; }));
server.on('connection', socket => socket.on('error', () => { serverStats.errors++; }));
proxy.on('connect', (_req, socket) => { proxyStats.rejected++; socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
const closeServer = s => new Promise(resolve => { s.closeAllConnections?.(); s.close(resolve); });
const localLabel = raw => {
  try { const u = new URL(raw); return u.origin === origin ? u.pathname : `${u.protocol}//${u.host}/[path omitted]`; } catch { return '[unparseable URL]'; }
};
let browser;
const results = [], extras = [], shots = [];
let themes = [], allThemes = [], axeSource, homeSignature, fatal;
const started = new Date().toISOString();
const screenshots = opt.screenshots && !opt['no-screenshots'];
const runExtras = opt.extras && !opt['no-extras'];
const reference = opt.reference ? JSON.parse(fs.readFileSync(absolute(opt.reference), 'utf8')) : null;

// Runs inside Chromium. Rectangles are document-relative; no article prose is saved.
async function measure(page) {
  return page.evaluate(() => {
    const round = n => Math.round(n * 100) / 100;
    const label = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    const visible = e => Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
    const rect = e => {
      if (!e) return null;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight), border = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
      return { selector: label(e), x: round(r.x + scrollX), y: round(r.y + scrollY), width: round(r.width), height: round(r.height), right: round(r.right + scrollX), bottom: round(r.bottom + scrollY), contentWidth: round(r.width - border - pad), paddingX: round(pad), borderX: round(border), display: s.display, position: s.position, columns: s.gridTemplateColumns, areas: s.gridTemplateAreas, gridArea: s.gridArea, order: s.order, overflowX: s.overflowX, overflowY: s.overflowY, maxWidth: s.maxWidth, font: s.font, fontSize: s.fontSize, color: s.color, background: s.backgroundColor, transform: s.transform, visible: visible(e) };
    };
    const box = s => rect(document.querySelector(s));
    const article = document.querySelector('#article-body');
    const paras = article ? [...article.querySelectorAll(':scope > p, :scope > section > p, :scope > [data-challenge-archive] > p')].filter(e => e.textContent.trim().length >= 80 && visible(e)) : [];
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    const prose = paras.slice(0, 80).map(e => {
      const s = getComputedStyle(e), b = rect(e); ctx.font = s.font;
      const range = document.createRange(); range.selectNodeContents(e);
      const lines = [...range.getClientRects()].filter(r => r.width > 0);
      return { x: b.x, width: b.width, contentWidth: b.contentWidth, inkWidth: round(Math.max(0, ...lines.map(r => r.width))), fontSize: s.fontSize, fontFamily: s.fontFamily, zeroGlyph: round(ctx.measureText('0').width), ch: round(b.contentWidth / ctx.measureText('0').width) };
    });
    const widths = prose.map(p => p.contentWidth).sort((a, b) => a - b);
    const inner = document.querySelector('.site-footer__inner');
    const children = inner ? [...inner.children].map(rect) : [];
    const overlaps = [];
    for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
      const a = children[i], b = children[j];
      const x = Math.min(a.right, b.right) - Math.max(a.x, b.x), y = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (a.visible && b.visible && x > 1 && y > 1) overlaps.push({ a: a.selector, b: b.selector, width: round(x), height: round(y) });
    }
    const footerElements = [...document.querySelectorAll('.site-footer a, .site-footer__mystery')].filter(visible);
    const footer = { outer: box('.site-footer'), inner: rect(inner), children, overlaps,
      visualOrder: children.filter(b => b.visible).sort((a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1 ? a.x - b.x : a.y - b.y).map(b => b.selector),
      controlOrder: [...document.querySelectorAll('.site-footer__mystery')].map(e => e.dataset.toySlot),
      controls: [...document.querySelectorAll('.site-footer__mystery')].map(rect),
      links: [...document.querySelectorAll('.site-footer__links a')].map(e => ({ text: e.textContent.trim(), visible: visible(e), scheme: new URL(e.href).protocol })),
      outside: footerElements.map(rect).filter(r => r.x < -1 || r.right > innerWidth + 1).map(r => r.selector) };
    const overflow = [], containers = new Set();
    for (const e of document.querySelectorAll('#article-body pre, #article-body table, #article-body .katex-display, #article-body img, #article-body svg')) {
      const r = e.getBoundingClientRect();
      if (e.scrollWidth <= e.clientWidth + 1 && r.left >= -1 && r.right <= innerWidth + 1) continue;
      let p = e, containment = null;
      while (p && p !== document.body) {
        const s = getComputedStyle(p), pr = p.getBoundingClientRect();
        if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX) && pr.left >= -1 && pr.right <= innerWidth + 1) {
          containment = { selector: label(p), mode: s.overflowX, tabIndex: p.tabIndex, width: round(pr.width), scrollWidth: p.scrollWidth };
          if (['auto', 'scroll'].includes(s.overflowX) && p.scrollWidth > p.clientWidth + 1) containers.add(p);
          break;
        }
        p = p.parentElement;
      }
      overflow.push({ selector: label(e), width: round(r.width), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, containment });
    }
    const scrollTests = [...containers].slice(0, 8).map(e => { const before = e.scrollLeft; e.scrollLeft = 40; const moved = e.scrollLeft; e.scrollLeft = before; return { selector: label(e), moved, tabIndex: e.tabIndex }; });
    const links = [...document.querySelectorAll('.js-toc-root a[href^="#"]')];
    const headings = [...document.querySelectorAll('#article-body h2[id], #article-body h3[id], #article-body h4[id]')];
    const badLinks = links.filter(e => { try { return !document.getElementById(decodeURIComponent(e.hash.slice(1))); } catch { return true; } });
    const pageOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
    const escaped = [...document.querySelectorAll('main *, .site-footer *, .site-header *')].filter(e => {
      if (!visible(e)) return false; const r = e.getBoundingClientRect();
      if (r.left >= -1 && r.right <= innerWidth + 1) return false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return false;
      return true;
    }).slice(0, 12).map(rect);
    return { activeSkin: document.documentElement.dataset.skin || 'rpn-garden', activeScheme: document.documentElement.dataset.theme || null,
      viewport: { width: innerWidth, height: innerHeight }, pageOverflow, escaped,
      header: box('.site-header'), main: box('.record-page'), grid: box('.record-grid'), article: rect(article), sidebar: box('.record-index'), toc: box('.record-toc'),
      prose: { totalParagraphs: paras.length, measured: prose.length, min: widths[0] ?? null, median: widths[Math.floor(widths.length / 2)] ?? null, max: widths.at(-1) ?? null, maxCh: Math.max(0, ...prose.map(p => p.ch)), maxInk: Math.max(0, ...prose.map(p => p.inkWidth)), samples: prose.slice(0, 3) },
      footer, scroll: { total: overflow.length, uncontained: overflow.filter(x => !x.containment).length, clippedOnly: overflow.filter(x => ['hidden', 'clip'].includes(x.containment?.mode)).length, samples: overflow.slice(0, 12), tests: scrollTests },
      contents: { headings: headings.length, links: links.length, broken: badLinks.length, open: document.querySelector('.record-toc')?.open ?? null, fallback: Boolean(document.querySelector('.toc-fallback')) },
      cookieBannerVisible: visible(document.getElementById('cookie-banner')) };
  });
}

async function focusChecks(page) {
  const selectors = ['.site-nav > a[data-route="home"]', '.skin-menu > summary', '.record-toc > summary', '#article-body a:not(.heading-anchor)', '.site-footer__mystery', '.site-footer__links a'];
  const data = [];
  // A real keypress sets keyboard modality; focusing each sample avoids thousands of Tabs.
  await page.keyboard.press('Tab');
  for (const selector of selectors) {
    if (!await page.$(selector)) continue;
    const result = await page.evaluate(selector => {
      const e = document.querySelector(selector); if (!e.getClientRects().length) return { selector, hidden: true };
      const props = ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'boxShadow', 'borderColor', 'color', 'backgroundColor', 'textDecorationLine'];
      e.blur(); const before = Object.fromEntries(props.map(p => [p, getComputedStyle(e)[p]]));
      e.focus(); const after = Object.fromEntries(props.map(p => [p, getComputedStyle(e)[p]]));
      const focusVisible = e.matches(':focus-visible');
      const outline = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0 && after.outlineColor !== 'rgba(0, 0, 0, 0)';
      const changed = props.filter(p => before[p] !== after[p]);
      const r = e.getBoundingClientRect(), clipped = [];
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p), pr = p.getBoundingClientRect(), ring = parseFloat(after.outlineWidth) + Math.max(0, parseFloat(after.outlineOffset));
        if (s.display !== 'contents' && p.getClientRects().length && ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX) && (r.left - ring < pr.left || r.right + ring > pr.right)) clipped.push(p.className);
      }
      return { selector, focused: document.activeElement === e, focusVisible, before, after, changed, stylePresent: outline || changed.some(p => ['boxShadow', 'borderColor', 'color', 'backgroundColor', 'textDecorationLine'].includes(p)), clipped };
    }, selector);
    data.push(result);
  }
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  return data;
}

async function contrastChecks(page) {
  if (!axeSource) return { status: 'not-run', reason: opt.axe === 'off' ? 'disabled explicitly' : 'local axe-core unavailable' };
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const selectors = ['#article-body > p:first-of-type', '#article-body [data-challenge-archive] > p:first-of-type', '.record-index', '.site-footer'];
    const include = selectors.filter(s => document.querySelector(s)).map(s => [s]);
    if (!include.length) return { status: 'not-run', reason: 'no selected elements' };
    const data = await axe.run({ include }, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations', 'incomplete', 'passes'], rules: { 'color-contrast': { enabled: true } } });
    const compact = list => list.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, nodes: v.nodes.slice(0, 8).map(n => ({ target: n.target, checks: [...n.any, ...n.all, ...n.none].map(c => ({ id: c.id, message: c.message, data: c.data })) })) }));
    return { status: 'run', version: axe.version, violations: compact(data.violations), incomplete: compact(data.incomplete), passedNodes: data.passes.reduce((n, v) => n + v.nodes.length, 0) };
  });
}

async function open(job, config = {}) {
  const context = await browser.createBrowserContext();
  let phase = 'new page';
  try {
    const page = await context.newPage();
    const network = { requests: 0, externalCount: 0, external: [], failures: [], httpErrors: [], errors: [], fonts: [], toyRequests: [], requestsByPath: {}, cdpEncodedFontBytes: 0 };
    await page.setViewport({ width: job.width, height: job.width === 768 ? 1024 : job.width < 768 ? 844 : 900, deviceScaleFactor: 1 });
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    await page.setJavaScriptEnabled(config.js !== false);
    // Print is set after the inert origin primer below. Cached Chromium
    // loses media type on its first cross-origin navigation from about:blank.
    if (!config.print) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: job.scheme }, { name: 'prefers-reduced-motion', value: config.motion || 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', r => {
      network.requests++;
      const u = new URL(r.url());
      if (u.origin !== origin && !['data:', 'blob:', 'about:'].includes(u.protocol)) {
        network.externalCount++; bounded(network.external, { type: r.resourceType(), url: localLabel(r.url()) });
        r.abort('blockedbyclient').catch(() => {}); return;
      }
      if (u.origin === origin && !['GET', 'HEAD'].includes(r.method())) { bounded(network.failures, { url: u.pathname, reason: 'blocked non-read method' }); r.abort().catch(() => {}); return; }
      if (u.origin === origin) {
        if (Object.keys(network.requestsByPath).length < 200) network.requestsByPath[u.pathname] = (network.requestsByPath[u.pathname] || 0) + 1;
        if (/toybox|footer-toy/.test(u.pathname)) bounded(network.toyRequests, u.pathname);
      }
      if (config.print && phase === 'print primer' && r.resourceType() === 'document' && r.url() === origin + base + opt['print-primer']) {
        r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><link rel="icon" href="data:,"><title>Print test origin</title>' }).catch(() => {});
        return;
      }
      r.continue().catch(() => {});
    });
    page.on('response', r => {
      if (r.url().startsWith(origin) && r.status() >= 400) bounded(network.httpErrors, { url: localLabel(r.url()), status: r.status() });
      if (r.request().resourceType() === 'font' && r.url().startsWith(origin)) bounded(network.fonts, { path: localLabel(r.url()), status: r.status(), bodyBytes: Number(r.headers()['content-length'] || 0), fromCache: r.fromCache() }, 64);
    });
    page.on('requestfailed', r => { if (r.url().startsWith(origin)) bounded(network.failures, { url: localLabel(r.url()), error: r.failure()?.errorText }); });
    page.on('pageerror', e => bounded(network.errors, String(e).slice(0, 500)));
    const cdp = await page.createCDPSession();
    const fontIds = new Set();
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', e => { if (e.type === 'Font') fontIds.add(e.requestId); });
    cdp.on('Network.loadingFinished', e => { if (fontIds.has(e.requestId)) network.cdpEncodedFontBytes += e.encodedDataLength; });
    // Do not remove page UI or patch time/randomness. Deterministic baseline uses reduced motion only.
    const storageScript = config.storage ? await page.evaluateOnNewDocument(storage => { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); }, config.storage) : null;
    const query = config.query === false ? '' : '?skin=' + encodeURIComponent(job.skin);
    if (config.print) {
      phase = 'print primer';
      const primer = await page.goto(origin + base + opt['print-primer'], { waitUntil: 'load', timeout: 30000 });
      if (primer?.status() !== 200 || !primer.headers()['content-type']?.startsWith('text/html') || network.fonts.length) throw new Error('Print primer must be inert HTML without font requests');
      await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    }
    phase = 'navigation';
    const response = await page.goto(origin + base + job.route + query, { waitUntil: 'load', timeout: 60000 });
    if (response?.status() !== 200) throw new Error(`Navigation ${response?.status()} ${job.route}`);
    if (storageScript) await page.removeScriptToEvaluateOnNewDocument(storageScript.identifier);
    if (config.print && !await page.evaluate(() => matchMedia('print').matches)) throw new Error('Print emulation was lost during navigation; no print assertions were made');
    phase = 'post-navigation evaluation';
    const readyState = await page.evaluate(() => document.readyState);
    fs.appendFileSync(path.join(out, 'loading.jsonl'), JSON.stringify({ route: job.route, skin: job.skin, width: job.width, readyState, requests: network.requests, fontRequests: network.fonts.length }) + '\n');
    phase = 'fonts';
    const fontsReady = await page.evaluate(() => Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 10000))]));
    if (!fontsReady) bounded(network.errors, 'Font loading did not settle in 10 seconds');
    phase = 'network idle';
    await page.waitForNetworkIdle({ idleTime: 150, timeout: 15000 }).catch(() => {});
    return { context, page, network, cdp };
  } catch (e) { await context.close(); throw new Error(`${phase}: ${String(e)}`); }
}

function observations(m, focus, axe, network, job) {
  const a = [], add = (code, detail) => a.push({ code, detail });
  if (!m.article || !m.prose.measured) add('missing-prose', 'No qualifying real prose paragraphs were measured');
  if (m.activeSkin !== job.skin || m.activeScheme !== job.scheme) add('theme-selection', `${m.activeSkin}/${m.activeScheme}`);
  if (m.prose.median && job.width <= 390 && m.prose.median < job.width * budget.minMobileRatio) add('narrow-mobile-prose', m.prose.median);
  if (m.prose.median && job.width >= 1200 && m.prose.median < budget.minDesktop) add('narrow-desktop-prose', m.prose.median);
  if (m.prose.maxCh > budget.maxCh) add('wide-prose', m.prose.maxCh);
  if (m.pageOverflow > 1) add('page-overflow', m.pageOverflow);
  if (m.escaped.length) add('uncontained-rects', m.escaped.map(e => e.selector));
  const expectedFooterGroups = ['div.site-footer__contact', 'div.site-footer__toys'];
  if (!m.footer.inner || (opt.mode === 'assert-after'
    ? JSON.stringify(m.footer.children.map(c => c.selector)) !== JSON.stringify(expectedFooterGroups)
    : m.footer.children.length < 2)) add('footer-structure', m.footer.children.map(c => c.selector));
  if (m.footer.overlaps.length) add('footer-overlap', m.footer.overlaps);
  if (m.footer.outside.length) add('footer-outside', m.footer.outside);
  if (m.footer.controls.length !== 3 || m.footer.controls.some(c => !c.visible || c.width < 1)) add('footer-controls', m.footer.controls.length);
  if (m.footer.controlOrder.join(',') !== '0,1,2') add('footer-control-order', m.footer.controlOrder);
  if (m.footer.links.length !== 6 || m.footer.links.some(l => !l.visible)) add('footer-social-links', m.footer.links);
  const domOrder = m.footer.children.filter(c => c.visible).map(c => c.selector);
  if (JSON.stringify(domOrder) !== JSON.stringify(m.footer.visualOrder)) add('footer-visual-order', m.footer.visualOrder);
  if (m.scroll.uncontained) add('scroll-uncontained', m.scroll.uncontained);
  if (m.scroll.tests.some(t => t.moved === 0)) add('scroll-stuck', m.scroll.tests.filter(t => !t.moved));
  if (m.contents.headings && (!m.contents.links || m.contents.broken)) add('contents-links', m.contents);
  if (!focus.length) add('focus-not-measured', 'No samples');
  if (focus.some(f => !f.hidden && (!f.focused || !f.focusVisible || !f.stylePresent))) add('focus-style', focus.filter(f => !f.hidden && (!f.focused || !f.focusVisible || !f.stylePresent)).map(f => f.selector));
  if (axe.status === 'run' && axe.violations.length) add('selected-contrast', axe.violations.reduce((n, v) => n + v.count, 0));
  if (network.httpErrors.length || network.failures.length || network.errors.length) add('local-load-errors', { http: network.httpErrors.length, failed: network.failures.length, js: network.errors.length });
  if (network.toyRequests.length) add('early-toy-download', network.toyRequests);
  const fontBytes = network.fonts.reduce((n, f) => n + f.bodyBytes, 0);
  if (budget.fontBytes && fontBytes > budget.fontBytes) add('font-budget', fontBytes);
  return a;
}

async function screenshotSet(page, job, suffix = '') {
  const key = `${job.skin}-${job.scheme}-${job.width}${suffix}`;
  for (const region of ['top', 'prose', 'footer']) {
    await page.evaluate(region => {
      if (region === 'top') scrollTo(0, 0);
      else document.querySelector(region === 'prose' ? '#article-body' : '.site-footer')?.scrollIntoView({ block: region === 'footer' ? 'end' : 'start', behavior: 'instant' });
    }, region);
    const filename = `${key}-${region}.png`;
    await page.screenshot({ path: path.join(out, filename) });
    shots.push(filename);
  }
}

async function matrixCase(job) {
  const c = await open(job);
  try {
    const metrics = await measure(c.page);
    try {
      await c.cdp.send('DOM.enable'); await c.cdp.send('CSS.enable');
      const { root } = await c.cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await c.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#article-body p' });
      metrics.prose.platformFonts = nodeId ? (await c.cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts : [];
    } catch (e) { metrics.prose.platformFontError = String(e).slice(0, 200); }
    const focus = await focusChecks(c.page);
    const contrast = await contrastChecks(c.page);
    const issues = observations(metrics, focus, contrast, c.network, job);
    const result = { ...job, completed: true, metrics, focus, contrast, network: c.network, observations: issues, pass: !issues.length };
    // Eight viewport sets, bounded to 24 screenshots; worst cases are added after the matrix.
    if (screenshots && job.route === opt.article && ((job.skin === 'rpn-garden' && [320, 1440].includes(job.width)) || (job.skin === 'the-exploit-grimoire' && [390, 1440].includes(job.width)))) await screenshotSet(c.page, job);
    return result;
  } finally { await c.context.close(); }
}

async function homeMetrics(page) {
  return page.evaluate(() => {
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const cards = document.querySelector('.section-cards'), records = document.querySelector('#records');
    return { links: [...document.querySelectorAll('.site-nav > a')].map(e => ({ path: new URL(e.href).pathname, visible: visible(e), disclosure: Boolean(e.closest('details:not([open])')) })),
      order: cards && records ? Boolean(cards.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
      separated: cards && records ? cards.getBoundingClientRect().bottom <= records.getBoundingClientRect().top + 1 : false,
      sectionCards: [...document.querySelectorAll('.section-cards a')].map(e => new URL(e.href).pathname),
      latestPosts: [...document.querySelectorAll('#records .record-row__link')].map(e => new URL(e.href).pathname),
      heroActions: Boolean(document.querySelector('.masthead__actions')), preview: Boolean(document.querySelector('.post-preview')),
      themeCount: document.querySelectorAll('#skin-picker option').length,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth };
  });
}
const extra = async (name, fn) => {
  try { const value = await fn(); extras.push({ name, completed: true, ...value, pass: !value.observations?.length }); }
  catch (e) { extras.push({ name, completed: false, pass: false, error: String(e).slice(0, 800) }); }
};
const defaultJob = (route = opt.article, width = 390, skin = 'rpn-garden', scheme = 'light') => ({ route, width, skin, scheme });
async function doExtras() {
  for (const width of [320, 390, 768, 1440]) await extra(`short-article-${width}`, () => matrixCase(defaultJob(opt.short, width)));
  for (const [width, js] of [[320, true], [390, true], [1440, true], [390, false]]) await extra(`home-${width}-${js ? 'js' : 'nojs'}`, async () => {
    const c = await open(defaultJob('/', width), { js });
    try {
      const m = await homeMetrics(c.page), a = [];
      const expected = ['/', '/archive.html', '/WriteUps/', '/ctf-tutorials/', '/ramblings/', '/about.html'].map(p => base + p).sort();
      if (JSON.stringify(m.links.map(l => l.path).sort()) !== JSON.stringify(expected) || m.links.some(l => !l.visible || l.disclosure)) a.push('visible-navigation');
      if (!m.order || !m.separated || m.preview || !m.heroActions) a.push('home-order-or-controls');
      if (m.themeCount !== 5) a.push('theme-count');
      if (m.overflow > 1) a.push('home-overflow');
      const signature = { links: m.links.map(l => l.path.replace(base, '') || '/'), sectionCards: m.sectionCards.map(p => p.slice(base.length)), latestPosts: m.latestPosts.map(p => p.slice(base.length)) };
      if (!homeSignature) homeSignature = signature;
      if (reference?.homeSignature && JSON.stringify(signature) !== JSON.stringify(reference.homeSignature)) a.push('home-reference-order');
      if (opt.mode === 'assert-after' && !reference?.homeSignature) a.push('missing-home-reference');
      if (c.network.httpErrors.length || c.network.errors.length) a.push('local-load-errors');
      return { metrics: m, observations: a, network: c.network };
    } finally { await c.context.close(); }
  });
  for (const route of [opt.article, opt.short]) await extra(`nojs-${route === opt.article ? 'long' : 'short'}`, async () => {
    const c = await open(defaultJob(route), { js: false });
    try {
      const m = await measure(c.page), a = [];
      if (!m.article || !m.prose.measured) a.push('missing-prose');
      if (m.contents.headings && (m.contents.links < m.contents.headings || m.contents.broken || m.contents.fallback)) a.push('nojs-contents');
      if (m.footer.links.length !== 6 || m.footer.links.some(l => !l.visible)) a.push('nojs-footer-links');
      if (m.footer.overlaps.length || m.footer.outside.length || m.pageOverflow > 1) a.push('nojs-geometry');
      if (c.network.toyRequests.length) a.push('nojs-toy-download');
      if (screenshots && route === opt.article) await screenshotSet(c.page, defaultJob(route), '-nojs');
      return { metrics: m, network: c.network, observations: a };
    } finally { await c.context.close(); }
  });
  await extra('saved-query-theme', async () => {
    const savedSkin = allThemes.includes('cryptographic-blockbuster') ? 'cryptographic-blockbuster' : allThemes[1];
    const c = await open(defaultJob('/'), { query: false, storage: { 'deuterium-skin': savedSkin, 'deuterium-theme': 'dark' } });
    try {
      const states = [], a = [];
      const state = () => c.page.evaluate(() => ({ skin: document.documentElement.dataset.skin || 'rpn-garden', scheme: document.documentElement.dataset.theme, picker: document.querySelector('#skin-picker')?.value }));
      states.push(await state());
      if (states[0].skin !== savedSkin || states[0].scheme !== 'dark') a.push('saved-theme');
      await c.page.goto(origin + base + '/?skin=rpn-garden', { waitUntil: 'networkidle0' }); states.push(await state());
      if (states[1].skin !== 'rpn-garden' || states[1].picker !== 'rpn-garden') a.push('query-overrides-saved');
      await c.page.goto(origin + base + '/', { waitUntil: 'networkidle0' }); states.push(await state());
      if (states[2].skin !== 'rpn-garden') a.push('query-persists');
      await c.page.click('.skin-menu > summary'); await c.page.select('#skin-picker', savedSkin);
      await c.page.waitForNetworkIdle({ idleTime: 150 }); states.push(await state());
      await c.page.click('.theme-toggle'); states.push(await state());
      if (states[3].skin !== savedSkin || states[4].scheme !== 'light') a.push('theme-controls');
      if (c.network.httpErrors.length || c.network.errors.length) a.push('local-load-errors');
      return { states, network: c.network, observations: a };
    } finally { await c.context.close(); }
  });
  await extra('toy-stable-lazy-activation', async () => {
    const c = await open(defaultJob(opt.short), { motion: 'no-preference' });
    try {
      await c.page.evaluate(() => {
        document.querySelector('.site-footer').scrollIntoView({ block: 'end', behavior: 'instant' });
        window.__articleLayoutToyMutations = { children: 0, wink: 0 };
        new MutationObserver(records => records.forEach(r => {
          if (r.type === 'childList') window.__articleLayoutToyMutations.children++;
          if (r.type === 'attributes' && r.target.classList.contains('is-winking')) window.__articleLayoutToyMutations.wink++;
        })).observe(document.querySelector('.site-footer__mysteries'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      const getControls = () => c.page.evaluate(() => [...document.querySelectorAll('.site-footer__mystery')].map(e => { const r = e.getBoundingClientRect(); return { slot: e.dataset.toySlot, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }));
      const before = await getControls();
      await pause(toyWait);
      const after = await getControls(), a = [];
      const idleMutations = await c.page.evaluate(() => window.__articleLayoutToyMutations);
      if (idleMutations.children || idleMutations.wink) a.push('toy-idle-dom-mutations');
      if (before.length !== 3 || JSON.stringify(before.map(x => x.slot)) !== JSON.stringify(after.map(x => x.slot))) a.push('toy-order-changed');
      if (before.some((x, i) => !after[i] || Math.abs(x.x - after[i].x) > 1 || Math.abs(x.y - after[i].y) > 1)) a.push('toy-position-changed');
      const early = [...c.network.toyRequests];
      if (early.length) a.push('early-toy-download');
      if (toyWait < 14500) a.push('insufficient-real-time-stability-window');
      await c.page.click('.site-footer__mystery[data-toy-slot="0"]');
      await c.page.waitForFunction(() => window.__dtToy || document.querySelector('.site-footer__mystery[aria-pressed="true"]'), { timeout: 10000 });
      await c.page.waitForNetworkIdle({ idleTime: 150 });
      const activated = await c.page.evaluate(() => ({ runtime: Boolean(window.__dtToy), pressed: [...document.querySelectorAll('.site-footer__mystery')].map(e => e.getAttribute('aria-pressed')), restoreVisible: Boolean(document.querySelector('.site-footer__restore')?.getClientRects().length) }));
      if (!c.network.toyRequests.length || !activated.pressed.includes('true')) a.push('toy-activation');
      if (activated.restoreVisible) { await c.page.focus('.site-footer__restore'); await c.page.keyboard.press('Enter'); }
      await c.page.waitForFunction(() => [...document.querySelectorAll('.site-footer__mystery')].every(e => e.getAttribute('aria-pressed') === 'false'), { timeout: 2000 }).catch(() => {});
      const restored = await c.page.evaluate(() => [...document.querySelectorAll('.site-footer__mystery')].every(e => e.getAttribute('aria-pressed') === 'false'));
      if (!restored) a.push('toy-restore');
      if (c.network.httpErrors.length || c.network.errors.length) a.push('local-load-errors');
      return { before, after, idleMutations, elapsedWaitMs: toyWait, earlyRequests: early, activated, restored, network: c.network, observations: a };
    } finally { await c.context.close(); }
  });
  for (const js of [true, false]) for (const skin of ['rpn-garden', 'the-exploit-grimoire']) await extra(`print-cold-${skin}-${js ? 'js' : 'nojs'}`, async () => {
    const job = defaultJob(opt.article, 794, skin);
    const c = await open(job, { js, print: true });
    try {
      const m = await measure(c.page), a = [];
      const print = await c.page.evaluate(() => ({ media: matchMedia('print').matches, stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(e => /print/.test(e.href)).map(e => ({ loaded: Boolean(e.sheet), media: e.media })),
        headerHidden: getComputedStyle(document.querySelector('.site-header')).display === 'none', footerHidden: getComputedStyle(document.querySelector('.site-footer')).display === 'none',
        articleFont: getComputedStyle(document.querySelector('#article-body')).fontFamily,
        visibleScreenControls: [...document.querySelectorAll('.theme-toggle, .skin-dice, .skin-menu, .site-share, .site-footer__mystery, .code-frame__actions')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => e.className).slice(0, 12) }));
      if (!m.article?.visible || !m.prose.measured) a.push('print-missing-prose');
      if (!print.headerHidden || !print.footerHidden || print.visibleScreenControls.length) a.push('print-chrome-visible');
      if (m.sidebar?.visible) a.push('print-sidebar-visible');
      if (c.network.httpErrors.length || c.network.errors.length) a.push('print-load-errors');
      if (screenshots) {
        const filename = `print-cold-${skin}-${js ? 'js' : 'nojs'}.png`; await c.page.screenshot({ path: path.join(out, filename) }); shots.push(filename);
        // Only the first printed page: useful cold-print evidence without huge PDFs.
        await c.page.pdf({ path: path.join(out, `print-cold-${skin}-${js ? 'js' : 'nojs'}.pdf`), format: 'A4', pageRanges: '1', printBackground: true, preferCSSPageSize: true });
      }
      return { metrics: m, print, network: c.network, observations: a, coverage: js ? 'query-selected skin, cold print' : 'noJS uses generated default skin; query intentionally cannot execute' };
    } finally { await c.context.close(); }
  });
}

try {
  await listen(server); origin = `http://127.0.0.1:${server.address().port}`;
  await listen(proxy);
  const require = createRequire(import.meta.url);
  const modulePaths = opt.puppeteer ? [absolute(opt.puppeteer)] : [path.join(repo, '.toolchain/verify/lighthouse-node_modules/puppeteer-core'), path.join(repo, '.toolchain/node_modules/puppeteer-core')];
  let puppeteer, modulePath;
  for (const p of modulePaths) { try { const imported = await import(pathToFileURL(require.resolve(p)).href); puppeteer = imported.default || imported; modulePath = p; break; } catch {} }
  if (!puppeteer) throw new Error('No local Puppeteer installation; downloads are forbidden');
  const chrome = absolute(opt.chrome || process.env.CHROME_BIN || '.toolchain/verify/browser/chrome-linux64/chrome');
  if (!fs.existsSync(chrome)) throw new Error('No cached Chromium at selected path');
  const libs = ['agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu', 'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu', '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'].map(absolute).filter(p => fs.existsSync(p));
  const runtime = path.join(out, 'runtime'); fs.mkdirSync(runtime, { recursive: true });
  // Relative TMPDIR keeps Unix-domain socket names below 108 bytes and leaves
  // scratch data inside ownership. Chromium inherits this cwd; Node restores it.
  const previousCwd = process.cwd();
  process.chdir(runtime);
  try { browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, protocolTimeout: 60000, userDataDir: path.join(runtime, 'profile'),
    env: { ...process.env, LD_LIBRARY_PATH: [...libs, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':'), TMPDIR: '.', XDG_CACHE_HOME: path.join(runtime, 'cache'), XDG_CONFIG_HOME: path.join(runtime, 'config') },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--no-first-run', '--disable-default-apps', '--disable-quic', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', `--proxy-server=http://127.0.0.1:${proxy.address().port}`, `--proxy-bypass-list=<-loopback>;127.0.0.1:${server.address().port}`, '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
  } finally { process.chdir(previousCwd); }
  const axePaths = opt.axe === 'auto' ? ['.toolchain/verify/lighthouse-node_modules/axe-core/axe.min.js', '.toolchain/node_modules/axe-core/axe.min.js', 'node_modules/axe-core/axe.min.js'].map(absolute) : opt.axe === 'off' ? [] : [absolute(opt.axe)];
  const axePath = axePaths.find(p => fs.existsSync(p)); if (axePath) axeSource = fs.readFileSync(axePath, 'utf8');
  // Read theme choices from stable supplied output, never from concurrently edited source.
  const c = await open(defaultJob('/'));
  try { allThemes = await c.page.$$eval('#skin-picker option', nodes => nodes.map(n => n.value)); } finally { await c.context.close(); }
  if (allThemes.length !== 5 || new Set(allThemes).size !== 5) throw new Error(`Expected 5 unique generated themes, got ${allThemes.length}`);
  themes = opt.themes === 'all' ? allThemes : [...new Set(opt.themes.split(','))];
  if (!themes.length || themes.some(t => !allThemes.includes(t))) throw new Error('Unknown or empty theme subset');
  const jobs = themes.flatMap(skin => schemes.flatMap(scheme => widths.map(width => ({ skin, scheme, width, route: opt.article }))));
  const inventory = ['index.html', opt.article.slice(1), 'assets/css/main.css', 'assets/css/theme-remediation.css', 'assets/css/print.css', ...fs.readdirSync(path.join(site, 'assets/css/skins')).filter(f => f.endsWith('.css')).map(f => 'assets/css/skins/' + f)].map(p => {
    const file = fs.realpathSync(path.join(site, p)); if (!within(site, file)) throw new Error('Inventory path escaped site');
    const bytes = fs.readFileSync(file); return { path: p, bytes: bytes.length, sha256: hash(bytes), geometryRules: (bytes.toString().match(/(?:record-grid|article__content|record-index|site-footer__inner)/g) || []).length };
  });
  write('run.json', { started, mode: opt.mode, site, baseurl: base, options: opt, budget, planned: jobs.length, themes: allThemes, browser: await browser.version(), chrome, puppeteer: modulePath, axe: axePath || null, axeHash: axeSource ? hash(axeSource) : null, libraryPaths: libs, inventory,
    limitations: ['Local-only HTTP; third-party embeds/analytics are blocked, not validated.', 'Reduced motion in matrix; real-time toy stability is a separate check.', 'Only selected contrast and focus samples; no whole-site accessibility certification.', 'Prose budgets are explicit heuristics; font zero-glyph measurement is not a reading-speed test.', 'No header-height budget; no production edits or builds.'] });
  // Server confinement smoke tests use a local client, not external acquisition.
  const requestStatus = requestPath => new Promise((resolve, reject) => {
    const r = http.get({ hostname: '127.0.0.1', port: server.address().port, path: requestPath }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); r.on('error', reject);
  });
  const traversal = await requestStatus(base + '/%2e%2e/%2e%2e/_config.yml');
  if (traversal !== 403) throw new Error(`Confinement smoke test returned ${traversal}`);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      let result;
      try { result = await matrixCase(job); } catch (e) { result = { ...job, completed: false, pass: false, error: String(e).slice(0, 800) }; }
      results.push(result);
      fs.appendFileSync(path.join(out, 'matrix.jsonl'), JSON.stringify(result) + '\n');
      if (results.length % 24 === 0 || results.length === jobs.length) console.log(`${results.length}/${jobs.length} matrix cases; ${results.filter(r => !r.completed).length} execution errors`);
    }
  }));
  if (screenshots) {
    const narrow = results.filter(r => r.completed && r.width === 1440 && r.metrics.prose.median).sort((a, b) => a.metrics.prose.median - b.metrics.prose.median)[0];
    const footer = results.filter(r => r.completed).sort((a, b) => b.metrics.footer.overlaps.length - a.metrics.footer.overlaps.length || b.metrics.footer.outer.height - a.metrics.footer.outer.height)[0];
    const spill = results.find(r => r.completed && r.observations.some(o => o.code === 'footer-outside'));
    const contrast = results.find(r => r.completed && r.width === 320 && r.skin === 'form-follows-failure' && r.scheme === 'dark');
    for (const [label, r] of [['worst-prose', narrow], ['worst-footer', footer], ['footer-spill', spill], ['contrast-sample', contrast]]) if (r) {
      const c = await open(r); try { await screenshotSet(c.page, r, '-' + label); } finally { await c.context.close(); }
    }
  }
  if (runExtras) await doExtras();
} catch (e) {
  fatal = String(e.stack || e); write('ERROR.md', `# Browser run failed\n\n${fatal}\n`);
} finally {
  if (browser) await browser.close();
  await closeServer(server); await closeServer(proxy);
  // Chromium profiles are scratch state, not evidence. Remove them to bound output.
  fs.rmSync(path.join(out, 'runtime'), { recursive: true, force: true });
}
results.sort((a, b) => allThemes.indexOf(a.skin) - allThemes.indexOf(b.skin) || a.scheme.localeCompare(b.scheme) || a.width - b.width);
write('matrix.json', results); write('extras.json', extras);
if (shots.length) {
  // ImageMagick is optional and local. It never opens a remote image URL.
  const montage = spawnSync('montage', [...shots.slice(0, 40).flatMap(f => ['-label', f.replace('.png', ''), path.join(out, f)]), '-font', 'DejaVu-Sans', '-pointsize', '10', '-background', '#ddd', '-fill', '#111', '-geometry', '240x240+6+14', '-tile', '5x', path.join(out, 'contact-sheet.jpg')], { encoding: 'utf8', timeout: 60000, env: { ...process.env, MAGICK_TMPDIR: out } });
  if (montage.status !== 0) write('contact-sheet-error.txt', String(montage.error || montage.stderr).slice(0, 1500));
}
const completed = results.filter(r => r.completed);
const groups = {};
for (const r of completed) for (const o of r.observations) { const g = groups[o.code] ||= { cases: 0, examples: [] }; g.cases++; bounded(g.examples, { skin: r.skin, scheme: r.scheme, width: r.width, detail: o.detail }, 8); }
const byWidth = Object.fromEntries(widths.map(w => { const rs = completed.filter(r => r.width === w && r.metrics.prose.median).sort((a, b) => a.metrics.prose.median - b.metrics.prose.median); return [w, { cases: rs.length, min: rs[0]?.metrics.prose.median ?? null, max: rs.at(-1)?.metrics.prose.median ?? null, narrowest: rs.slice(0, 4).map(r => ({ skin: r.skin, scheme: r.scheme, prose: r.metrics.prose.median, articleOuter: r.metrics.article.width, sidebar: r.metrics.sidebar?.width })) }]; }));
const fonts = completed.map(r => ({ skin: r.skin, scheme: r.scheme, width: r.width, requests: r.network.fonts.length, bytes: r.network.fonts.reduce((n, f) => n + f.bodyBytes, 0), encodedBytes: r.network.cdpEncodedFontBytes })).sort((a, b) => b.bytes - a.bytes);
const planned = themes.length * schemes.length * widths.length;
const fullMatrix = completed.length === 40 && planned === 40 && allThemes.every(t => themes.includes(t)) && [320, 390, 768, 1440].every(w => widths.includes(w)) && schemes.length === 2;
const summary = { mode: opt.mode, started, ended: new Date().toISOString(), site, baseurl: base, planned, completed: completed.length, executionErrors: results.length - completed.length, fullMatrix,
  exploratory: opt.mode === 'baseline', observationCases: completed.filter(r => r.observations.length).length, groups, byWidth,
  extras: { enabled: runExtras, attempted: extras.length, completed: extras.filter(r => r.completed).length, failed: extras.filter(r => !r.pass).map(r => ({ name: r.name, error: r.error, observations: r.observations })) },
  homeSignature, fontWorst: fonts.slice(0, 8), axe: { available: Boolean(axeSource), casesRun: completed.filter(r => r.contrast.status === 'run').length, casesIncomplete: completed.filter(r => r.contrast.incomplete?.length).length },
  externalAttemptsBlocked: completed.reduce((n, r) => n + r.network.externalCount, 0), serverStats, proxyStats, screenshots: shots, fatal: fatal || null,
  limitations: ['Initial observations, not a complete accessibility audit.', 'Contrast checks cover selected nodes only; incomplete/background-image cases require visual review.', 'Focus appearance is sampled; colors and clipping are diagnostics, not a complete focus-contrast proof.', 'NoJS does not apply query-selected themes; tested generated default only.', 'Print PDFs cover first page only; long-page pagination is not certified.', 'Toy real-time check covers one interval and one activation, not all random effects.', 'External requests are blocked; third-party behavior is outside coverage.'] };
write('summary.json', summary);
const counts = Object.entries(groups).map(([k, v]) => `${k}: ${v.cases}`).join('; ') || 'none observed';
write('REPORT.md', `# Article/footer browser observations\n- Checked: ${completed.length}/${planned} planned matrix cases; full 40-case matrix: ${fullMatrix}; ${results.length - completed.length} execution errors.\n- Mode: ${opt.mode}; initial fail observations are not a complete audit.\n- Prose content widths (min..max px): ${Object.entries(byWidth).map(([w, m]) => `${w}: ${m.min}..${m.max}`).join('; ')}.\n- Observations by failure mode: ${counts}.\n- Fonts: highest cold load ${fonts[0]?.bytes ?? 'unmeasured'} body bytes in ${fonts[0]?.requests ?? 'unmeasured'} requests (${fonts[0]?.skin ?? 'no cases'}). CDP transfer totals are in raw results.\n- Selected axe contrast: ${summary.axe.casesRun} cases run; ${summary.axe.casesIncomplete} with incomplete checks. No whole-site contrast claim.\n- Extras: ${extras.length} attempted, ${extras.filter(r => r.completed).length} completed, ${extras.filter(r => !r.pass).length} with observations/errors.\n- Evidence: matrix.json, extras.json, summary.json, run.json and ${shots.length} screenshots; optional contact-sheet.jpg.\n- Needs confirmation: inspect screenshots for text/decoration overlap, focus clipping and image-backed contrast; budgets are documented heuristics.\n- Source links/root-cause review: see SOURCE-NOTES.md if present; this generated report contains no source-location claims.\n- Run: node script/test-article-layout.mjs --site ${path.relative(repo, site)} --out agent_out/article-layout-rework/browser/NEW-RUN --mode ${opt.mode}${opt.reference ? ' --reference ' + opt.reference : ''}${base ? ' --baseurl ' + base : ''}\n`);
console.log(`${completed.length}/${planned} matrix completed; ${summary.observationCases} cases with initial observations; ${extras.length} extras; fullMatrix=${fullMatrix}. Results: ${path.relative(repo, out)}`);
if (fatal || !planned || completed.length !== planned || extras.some(r => !r.completed) || (opt.mode === 'assert-after' && (summary.observationCases || extras.some(r => !r.pass)))) process.exitCode = 1;
