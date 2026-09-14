#!/usr/bin/env node
/** Pure checks: node script/test-publication-pdfs.mjs
 * Offline Chrome fixtures: node script/test-publication-pdfs.mjs --browser
 * Optional --chrome PATH and --puppeteer PATH use already cached tools only.
 * Fixtures and reports are written only under agent_out/publications/tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import {
  validateRoute, normalizeBaseurl, routeToRelative, validateManifest,
  resolveNavigation, resolveLocalResource, isAllowedRequest, escapeHTML,
  safeInputFile, safeOutputPath, installPDF, renderPublications,
} from './render-publication-pdfs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: options } = parseArgs({ options: { browser: { type: 'boolean' }, chrome: { type: 'string' }, puppeteer: { type: 'string' } } });
const origin = 'http://127.0.0.1:43123';
const canonical = 'https://example.test/docs/paper/index.html';
const makePost = (url = '/paper/index.html', base = '/docs') => ({ url, pdf_url: url.replace(/\.html$/, '.pdf'), bib_url: url.replace(/\.html$/, '.bib'), canonical_url: 'https://example.test' + base + url,
  title: 'A publication', author: 'Test Author', date: '2026-01-02', description: 'An offline fixture.' });
const manifest = (posts = [makePost()], baseurl = '/docs') => ({ version: 1, baseurl, posts });
const scratch = async () => {
  const root = path.join(repo, 'agent_out/publications/tests');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'fixture-'));
};

test('route validation rejects traversal before URL normalization', () => {
  assert.equal(validateRoute('/paper/a%20b.html'), '/paper/a b.html');
  assert.equal(validateRoute('/paper/%C3%A9.html'), '/paper/é.html');
  for (const route of ['../x', '//host/x', '/a/../x', '/a/./x', '/%2e%2e/x', '/a/%252e%252e/x', '/%2fx', '/%5cx', '/x%00', '/x%0a', '/x%3fquery', '/x%23hash', '/x%25', '/x\\y', '/x?y', '/x#y', '/a//b', '/.git/config', '/%', '/%zz', '/white space']) assert.throws(() => validateRoute(route), undefined, route);
});

test('mount handling enforces prefix boundaries and directory index routes', () => {
  assert.equal(normalizeBaseurl('/'), '');
  assert.equal(normalizeBaseurl('/docs/'), '/docs');
  assert.equal(routeToRelative('/docs/paper/', '/docs', true), 'paper/index.html');
  assert.equal(routeToRelative('/docs/assets/a.svg', '/docs'), 'assets/a.svg');
  assert.equal(routeToRelative('/', '', true), 'index.html');
  assert.throws(() => routeToRelative('/docspaper/index.html', '/docs'));
  assert.throws(() => routeToRelative('/paper/index.html', '/docs'));
  assert.throws(() => normalizeBaseurl('https://example.test'));
  assert.throws(() => normalizeBaseurl('/docs//'));
});

test('manifest v1 maps unprefixed Jekyll routes and prefixed canonical URLs', () => {
  const parsed = validateManifest(manifest());
  assert.equal(parsed.posts[0].htmlPath, 'paper/index.html');
  assert.equal(parsed.posts[0].pdfPath, 'paper/index.pdf');
  const directory = { ...makePost('/paper/'), pdf_url: '/paper.pdf', bib_url: '/paper.bib' };
  assert.equal(validateManifest(manifest([directory])).posts[0].htmlPath, 'paper/index.html');
  assert.equal(validateManifest(manifest([makePost('/paper.html', '')], '')).baseurl, '');
  for (const bad of [null, {}, { ...manifest(), version: 2 }, { ...manifest(), baseurl: null }, manifest([makePost(), makePost()]), manifest([{ ...makePost(), pdf_url: '/paper/index.html' }]), manifest([{ ...makePost(), canonical_url: 'https://elsewhere.test/other.html' }]), manifest([{ ...makePost(), canonical_url: 'https://user@example.test/docs/paper/index.html' }]), manifest([{ ...makePost(), url: '/paper/../index.html' }]), manifest([{ ...makePost(), canonical_url: 'https://example.test/docs/a/../paper/index.html' }]), manifest([{ ...makePost(), title: '' }]), manifest([{ ...makePost(), description: null }])]) assert.throws(() => validateManifest(bad));
  for (const flag of ['hidden', 'noindex', 'unlisted', 'locked', 'argon']) assert.throws(() => validateManifest(manifest([{ ...makePost(), [flag]: true }])));
  assert.throws(() => validateManifest(manifest([directory, makePost()]))); // Same input via / and /index.html.
});

test('manifest accepts optional publication dates and event-date notes without coercion', () => {
  const note = 'Challenge event began 2026-01-02; article publication date not recorded.';
  for (const fields of [{}, { publication_date: null }, { publication_date: '2026-02-03', date_note: null }, { publication_date: null, date_note: note }]) {
    const post = validateManifest(manifest([{ ...makePost(), ...fields }])).posts[0];
    for (const [field, value] of Object.entries(fields)) assert.equal(post[field], value);
  }
  for (const field of ['publication_date', 'date_note']) for (const value of [false, 2026, {}, [], '', '  ', 'bad\u0000value']) {
    assert.throws(() => validateManifest(manifest([{ ...makePost(), [field]: value }])), new RegExp(`Invalid ${field}`));
  }
});

test('navigation is canonical, not a local resource or automatic PDF download', () => {
  assert.equal(resolveNavigation('#proof', canonical), canonical + '#proof');
  assert.equal(resolveNavigation('index.pdf', canonical), 'https://example.test/docs/paper/index.pdf');
  assert.equal(resolveNavigation('../next.html', canonical), 'https://example.test/docs/next.html');
  assert.equal(resolveNavigation('https://external.test/paper.pdf', canonical), 'https://external.test/paper.pdf');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:pass@example.test/a', '\njavascript:alert(1)']) assert.equal(resolveNavigation(value, canonical), null);
});

test('resources resolve to the exact local mount, never to public origins', () => {
  assert.equal(resolveLocalResource('image.svg', canonical, origin, '/docs'), origin + '/docs/paper/image.svg');
  assert.equal(resolveLocalResource('./image.svg?v=1', canonical, origin, '/docs'), origin + '/docs/paper/image.svg?v=1');
  assert.equal(resolveLocalResource('/docs/assets/a.svg', canonical, origin, '/docs'), origin + '/docs/assets/a.svg');
  assert.equal(resolveLocalResource('https://example.test/docs/image.svg', canonical, origin, '/docs'), origin + '/docs/image.svg');
  for (const value of ['', null, '../secret.png', '%2e%2e/secret.png', 'a/%252e%252e/s.png', '/outside.png', 'https://external.test/x.png', '//external.test/x.png', 'file:///tmp/x.png', 'data:image/png;base64,a', 'blob:https://example.test/id', 'http://127.0.0.1:9999/docs/a.png', 'index.pdf', 'index.bib', 'index.html']) assert.throws(() => resolveLocalResource(value, canonical, origin, '/docs'), undefined, String(value));
});

test('request gate blocks scripts, connections, downloads and other loopback ports', () => {
  const documentURL = origin + '/docs/render.html';
  const allowed = (url, type = 'image', method = 'GET') => isAllowedRequest(url, origin, '/docs', type, documentURL, method);
  assert.ok(allowed(documentURL, 'document'));
  assert.ok(allowed(origin + '/docs/assets/a.svg'));
  assert.ok(allowed(origin + '/docs/assets/font.woff2', 'font'));
  for (const type of ['script', 'fetch', 'xhr', 'websocket', 'other', 'media']) assert.equal(allowed(origin + '/docs/x', type), false);
  for (const url of [origin + '/outside.png', origin + '/docs/a.pdf', origin + '/docs/a.bib', origin + '/docs/a.html', 'http://127.0.0.1:9999/docs/x.png', 'https://example.test/docs/x.png', 'data:image/png;base64,a', 'file:///tmp/a', origin + '/docs/%2e%2e/private.png', origin + '/docs/a/../x.png']) assert.equal(allowed(url), false, url);
  assert.equal(allowed(origin + '/docs/other.html', 'document'), false);
  assert.equal(allowed(documentURL, 'document', 'POST'), false);
});

test('HTML escaping covers metadata and rewritten attribute values', () => {
  assert.equal(escapeHTML('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('file confinement rejects input escape and output symlinks; PDF install is no-clobber', async () => {
  const root = await scratch();
  const site = path.join(root, 'site'); await fs.mkdir(site);
  await fs.writeFile(path.join(root, 'outside.html'), 'not a site file');
  await fs.symlink('../outside.html', path.join(site, 'escape.html'));
  await assert.rejects(safeInputFile(site, 'escape.html'));
  await fs.mkdir(path.join(site, 'real'));
  await fs.symlink('real', path.join(site, 'alias'));
  await assert.rejects(safeOutputPath(site, 'alias/out.pdf'));
  await assert.rejects(safeOutputPath(site, '../outside.pdf'));
  const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');
  const installed = await installPDF(site, 'real/out.pdf', pdf);
  assert.equal(installed.bytes, pdf.length);
  await assert.rejects(installPDF(site, 'real/out.pdf', pdf));
  assert.deepEqual(await fs.readFile(path.join(site, 'real/out.pdf')), pdf);
  assert.deepEqual(await fs.readdir(path.join(site, 'real')), ['out.pdf']);
  await assert.rejects(installPDF(site, 'bad.pdf', Buffer.from('not a PDF')));
});

test('missing manifest produces a failed local report without starting Chrome', async () => {
  const root = await scratch(); const site = path.join(root, 'site'); await fs.mkdir(site);
  const report = await renderPublications({ site, out: path.join(root, 'logs') });
  assert.equal(report.status, 'failed');
  assert.equal(report.rendered, 0);
  assert.equal(report.browser, undefined);
  assert.ok((await fs.readFile(report.reportPath, 'utf8')).includes('ENOENT'));
  await assert.rejects(renderPublications({ site, out: path.join(repo, 'agent_out/elsewhere') }));
});

const html = (body, head = '', attrs = '') => `<!doctype html><html><head><title>Fixture</title>${head}</head><body ${attrs}><h1>A publication</h1><article id="article-body">${body}</article></body></html>`;
async function browserFixture(base = '/docs') {
  const root = await scratch(); const site = path.join(root, 'site');
  await fs.mkdir(path.join(site, 'assets/fonts/computer-modern'), { recursive: true });
  await fs.copyFile(path.join(repo, 'assets/fonts/computer-modern/roman.woff2'), path.join(site, 'assets/fonts/computer-modern/roman.woff2'));
  await fs.cp(path.join(repo, 'assets/katex'), path.join(site, 'assets/katex'), { recursive: true });
  await fs.writeFile(path.join(site, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#ddd"/><text x="5" y="25">Local figure</text></svg>');
  const posts = [];
  return { root, site, posts, async add(name, source) {
    const post = makePost('/' + name + '.html', base); posts.push(post);
    await fs.writeFile(path.join(site, name + '.html'), source); return post;
  }, async run(extra = {}) {
    await fs.writeFile(path.join(site, 'publications.json'), JSON.stringify(manifest(posts, base)));
    return renderPublications({ site, out: path.join(root, 'logs'), chrome: options.chrome, puppeteer: options.puppeteer, ...extra });
  } };
}

// Optional local PDF inspection. Set PYTHONPATH to an existing PyMuPDF cache
// when it is not installed system-wide; never acquire a dependency in tests.
async function inspectPDF(fixture, name) {
  const result = spawnSync('python3', ['-c', `
import json, sys
try:
    import pymupdf
except ImportError:
    sys.exit(77)
with pymupdf.open(sys.argv[1]) as doc:
    print(json.dumps([dict(width=p.rect.width, height=p.rect.height, text=p.get_text(),
        words=p.get_text('words'), spans=[s for b in p.get_text('dict')['blocks']
        if 'lines' in b for l in b['lines'] for s in l['spans']]) for p in doc]))
`, path.join(fixture.site, name + '.pdf')], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT' || result.status === 77) {
    await fs.writeFile(path.join(fixture.root, name + '-pdf-inspection.json'), JSON.stringify({ skipped: true, reason: 'Local Python/PyMuPDF unavailable; paginated text checks did not run.' }) + '\n');
    return null;
  }
  assert.equal(result.status, 0, result.stderr);
  const pages = JSON.parse(result.stdout);
  await fs.writeFile(path.join(fixture.root, name + '-pdf-inspection.json'), JSON.stringify(pages, null, 2) + '\n');
  return pages;
}

test('offline browser: figures, math, fallbacks, canonical links and partial coverage', { skip: !options.browser, timeout: 120000 }, async () => {
  const fixture = await browserFixture();
  // Pre-rendered KaTeX fraction with a subscript and superscript; no runtime TeX dependency.
  const math = "<span class=\"katex-display\"><span class=\"katex\"><span class=\"katex-mathml\"><math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><mfrac><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow><msub><mi>y</mi><mn>1</mn></msub></mfrac></mrow><annotation encoding=\"application/x-tex\">\\frac{x^2+1}{y_1}</annotation></semantics></math></span><span class=\"katex-html\" aria-hidden=\"true\"><span class=\"katex-base\"><span class=\"katex-strut\" style=\"height:2.3715em;vertical-align:-0.8804em;\"></span><span class=\"mord\"><span class=\"mopen nulldelimiter\"></span><span class=\"mfrac\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:1.4911em;\"><span style=\"top:-2.314em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"mord\"><span class=\"mord\"><span class=\"mord mathnormal\" style=\"margin-right:0.0359em;\">y</span><span class=\"msupsub\"><span class=\"vlist-t vlist-t2\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.3011em;\"><span style=\"top:-2.55em;margin-left:-0.0359em;margin-right:0.05em;\"><span class=\"pstrut\" style=\"height:2.7em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mtight\">1</span></span></span></span><span class=\"vlist-s\">\u200b</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.15em;\"><span></span></span></span></span></span></span></span></span><span style=\"top:-3.23em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"frac-line\" style=\"border-bottom-width:0.04em;\"></span></span><span style=\"top:-3.677em;\"><span class=\"pstrut\" style=\"height:3em;\"></span><span class=\"mord\"><span class=\"mord\"><span class=\"mord mathnormal\">x</span><span class=\"msupsub\"><span class=\"vlist-t\"><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.8141em;\"><span style=\"top:-3.063em;margin-right:0.05em;\"><span class=\"pstrut\" style=\"height:2.7em;\"></span><span class=\"katex-sizing reset-size6 size3 mtight\"><span class=\"mord mtight\">2</span></span></span></span></span></span></span></span><span class=\"mspace\" style=\"margin-right:0.2222em;\"></span><span class=\"mbin\">+</span><span class=\"mspace\" style=\"margin-right:0.2222em;\"></span><span class=\"mord\">1</span></span></span></span><span class=\"vlist-s\">\u200b</span></span><span class=\"vlist-r\"><span class=\"vlist\" style=\"height:0.8804em;\"><span></span></span></span></span></span><span class=\"mclose nulldelimiter\"></span></span></span></span></span></span>";
  await fixture.add('good', html(`<p>Visible paper text. ${math}</p><script>document.body.textContent='SITE SCRIPT EXECUTED';fetch('https://external.test/send')</script>
    <figure><img src="image.svg" loading="lazy" onload="alert(1)"><figcaption>Kept figure caption.</figcaption></figure>
    <figure><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><rect style="fill:blue" x="0" y="0" width="100" height="30"/></svg><figcaption>Inline SVG.</figcaption></figure>
    <example-widget><p class="widget-fallback">Static widget explanation.</p><button>Run widget</button></example-widget>
    <noscript><p>No-JS explanation remains.</p></noscript><form><p>Form explanation remains.</p><input value="hidden input"></form>
    <details><summary>Proof sketch</summary><p>Details remain visible.</p></details>
    <p hidden>SECRET HIDDEN TEXT</p><p style="display:none">SECRET INLINE HIDDEN TEXT</p>
    <p><a href="good.pdf" download ping="https://external.test/ping">PDF navigation</a><a href="#proof">Proof link</a></p><h2 id="proof">Proof</h2><pre><code>const x = 1;</code></pre>`,
    '<link rel="alternate" type="application/pdf" href="good.pdf"><link rel="preload" href="good.pdf" as="fetch"><link rel="stylesheet" href="https://external.test/style.css"><script src="https://external.test/site.js"></script>'));
  await fixture.add('not-selected', html('<p>Must not be rendered by a limited run.</p>'));
  await fs.writeFile(path.join(fixture.site, 'not-in-manifest.html'), html('<p>Unlisted file is not an input.</p>'));
  const report = await fixture.run({ limit: '1' });
  assert.equal(report.status, 'partial', JSON.stringify(report.results, null, 2));
  assert.equal(report.partial, true); assert.equal(report.planned, 2); assert.equal(report.rendered, 1);
  assert.equal(report.byteReproducible, false);
  const result = report.results[0];
  assert.equal(result.rendering.imageCount, 1); assert.equal(result.rendering.figureCount, 2); assert.equal(result.rendering.mathCount, 1);
  assert.equal(result.rendering.svgFigureCount, 1);
  assert.equal(result.rendering.mathScriptRatios.length, 2);
  assert.ok(result.rendering.mathScriptRatios.every(ratio => Math.abs(ratio - 0.7) < 0.001));
  assert.equal(result.rendering.fractions.length, 1);
  assert.ok(result.rendering.fractions[0].border > 0 && result.rendering.fractions[0].width > 10);
  assert.deepEqual(result.rendering.missingImages, []); assert.deepEqual(result.rendering.overflow, []);
  assert.equal(result.rendering.scripts, 0); assert.equal(result.rendering.eventHandlers, 0);
  assert.equal(result.rendering.inlineStyles, 0); assert.equal(result.rendering.controls, 0);
  assert.equal(result.rendering.visibleWidgetFallbacks, 1); assert.equal(result.rendering.visibleNoscriptFallbacks, 1);
  assert.equal(result.siteJavaScriptEnabled, false);
  assert.ok(result.rendering.fonts.some(f => /KaTeX/.test(f.family) && f.status === 'loaded'));
  assert.ok(result.notes.some(n => n.includes('Static widget')));
  assert.deepEqual(result.blockedRequests, []); assert.deepEqual(result.failedRequests, []);
  await assert.rejects(fs.access(path.join(fixture.site, 'not-selected.pdf')));
  await assert.rejects(fs.access(path.join(fixture.site, 'not-in-manifest.pdf')));
  const pdf = await fs.readFile(path.join(fixture.site, 'good.pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pageCount = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  assert.ok(pageCount > 0);
  const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)];
  assert.ok(boxes.length);
  for (const box of boxes) {
    const [, , width, height] = box[1].trim().split(/\s+/).map(Number);
    assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, 'A4 dimensions');
  }
  assert.match(result.rendering.bodyFont, /^16px .*Publication Serif/);
  // Chrome stores URI annotations uncompressed; verify no local PDF links leak.
  assert.ok(pdf.includes(Buffer.from('https://example.test/docs/good.pdf')));
  assert.ok(pdf.includes(Buffer.from('https://example.test/docs/good.html#proof')));
  assert.ok(!pdf.includes(Buffer.from('http://127.0.0.1')));
  const extracted = spawnSync('pdftotext', [path.join(fixture.site, 'good.pdf'), '-'], { encoding: 'utf8' });
  if (extracted.error) await fs.writeFile(path.join(fixture.root, 'text-check.json'), JSON.stringify({ skipped: true, reason: 'pdftotext is not installed; DOM and PDF URI checks still ran.' }) + '\n');
  else {
    assert.equal(extracted.status, 0);
    for (const text of ['Visible paper text', 'Static widget explanation', 'No-JS explanation remains', 'Form explanation remains', 'Details remain visible', 'Kept figure caption', 'Canonical HTML', 'Test Author', 'Abstract']) assert.ok(extracted.stdout.includes(text), text);
    assert.doesNotMatch(extracted.stdout, /SECRET|SITE SCRIPT EXECUTED|hidden input|Run widget/);
    assert.match(extracted.stdout, new RegExp(`1\\s*\\/\\s*${pageCount}`));
  }
});

test('offline browser: exclusion guards and resource/layout failures do not emit PDFs', { skip: !options.browser, timeout: 180000 }, async () => {
  const fixture = await browserFixture('');
  for (const [name, source] of [
    ['noindex', html('<p>Private prose</p>', '<meta NAME="ROBOTS" content="follow, NOINDEX">')],
    ['argon', html('<div class="argon">Ciphertext</div>')],
    ['loader', html('<p>Locked prose</p><script>document.body.dataset.argon="";s.src="/assets/js/argon.js"</script>')],
    ['locked', html('<p>Locked prose</p>', '', 'data-layout="locked"')],
    ['unlisted', html('<p>Unlisted prose</p>', '', 'data-unlisted="true"')],
    ['hidden', html('<p>Hidden prose</p>', '', 'hidden')],
    ['css-hidden', html('<p>CSS-hidden prose</p>', '<style>article#article-body { display:none }</style>')],
    ['aria-hidden', html('<p>Inaccessible prose</p>', '', 'aria-hidden="TRUE"')],
    ['redirect', html('<p>Redirect</p>', '<meta http-equiv="refresh" content="0;url=https://external.test">')],
    ['empty', html('<script>Only active code</script>')],
    ['missing-image', html('<p>Missing image</p><img src="missing.svg">')],
    ['external-image', html('<p>Remote image</p><img src="https://external.test/a.svg">')],
    ['bad-image', html('<p>Bad image</p><img src="bad.png">')],
    ['nested-image', html('<p>Incomplete SVG image</p><img src="nested.svg">')],
    ['overflow', html('<p>Too wide</p><table><tr>' + '<td>Unbreakable</td>'.repeat(60) + '</tr></table>')],
    ['tall-figure', html('<figure><figcaption>Atomic figure must still fail.</figcaption><pre>' + 'line\n'.repeat(180) + '</pre></figure>')],
    ['tall-row', html('<figure class="code-frame"><table><tr><td>' + 'line<br>'.repeat(180) + '</td></tr></table></figure>')],
    ['tall-equation', html('<figure class="code-frame"><span class="katex-display"><span class="katex" style="height:300mm">Tall equation</span></span></figure>')],
    ['tall-svg', html('<figure class="code-frame"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 1200" style="height:300mm;min-height:300mm"><rect width="100" height="1200"/></svg><figcaption>Tall SVG</figcaption></figure>')],
  ]) await fixture.add(name, source);
  await fs.writeFile(path.join(fixture.site, 'bad.png'), 'not an image');
  await fs.writeFile(path.join(fixture.site, 'nested.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="missing.png" width="10" height="10"/></svg>');
  const report = await fixture.run();
  assert.equal(report.status, 'failed'); assert.equal(report.failed, fixture.posts.length, JSON.stringify(report.results, null, 2));
  assert.equal(report.rendered, 0);
  for (const post of fixture.posts) await assert.rejects(fs.access(path.join(fixture.site, post.pdf_url.slice(1))));
  assert.ok(report.results.find(r => r.url === '/missing-image.html').resourceErrors.length);
  assert.ok(report.results.find(r => r.url === '/bad-image.html').rendering.missingImages.length);
  assert.ok(report.results.find(r => r.url === '/nested-image.html').resourceErrors.some(r => /self-contained/.test(r.error)));
  assert.ok(report.results.find(r => r.url === '/overflow.html').rendering.overflow.length);
  for (const [name, element] of [['tall-figure', 'figure'], ['tall-row', 'tr'], ['tall-equation', 'span'], ['tall-svg', 'svg']]) {
    const result = report.results.find(r => r.url === `/${name}.html`);
    assert.equal(result.error, 'Academic layout overflow');
    assert.ok(result.rendering.overflow.some(o => o.element === element && o.kind === 'taller-than-page'), name);
  }
});

test('offline browser: code figures paginate without shrinking, clipping or losing lines', { skip: !options.browser, timeout: 120000 }, async () => {
  const fixture = await browserFixture('');
  const lines = Array.from({ length: 180 }, (_, i) => `line_${String(i).padStart(3, '0')} = ${i} # retained code`);
  await fixture.add('listing', html(`<p>Before listing.</p><figure class="code-frame"><figcaption>Code listing caption.</figcaption><div class="code-frame__viewport"><div class="highlight"><pre><code>${lines.join('\n')}</code></pre></div></div></figure><p>After listing.</p>`));
  const report = await fixture.run();
  assert.equal(report.status, 'complete', JSON.stringify(report.results, null, 2));
  const result = report.results[0];
  assert.deepEqual(result.rendering.overflow, []);
  assert.equal(result.rendering.codeFrames.length, 1);
  assert.ok(result.rendering.codeFrames[0].height > 2 * 257 * 96 / 25.4);
  assert.equal(result.rendering.codeFrames[0].breakInside, 'auto');
  const pdf = await fs.readFile(path.join(fixture.site, 'listing.pdf'));
  assert.ok([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length >= 3);
  const pages = await inspectPDF(fixture, 'listing');
  if (pages) {
    assert.ok(pages.length >= 3);
    const text = pages.map(p => p.text).join('\n');
    assert.deepEqual(text.match(/line_\d{3} = \d+ # retained code/g), lines);
    for (const phrase of ['Before listing.', 'Code listing caption.', 'After listing.']) assert.ok(text.includes(phrase), phrase);
    assert.ok(pages.filter(p => /line_\d{3}/.test(p.text)).length >= 3);
    for (const page of pages) {
      const code = page.spans.filter(s => s.text.includes('line_'));
      for (const span of code) {
        assert.ok(Math.abs(span.size - 9) < 0.01, `Code size changed: ${span.size}`);
        const [x0, y0, x1, y1] = span.bbox;
        assert.ok(x0 >= 56 && x1 <= page.width - 56 && y0 >= 56 && y1 <= page.height - 56, JSON.stringify(span));
      }
    }
  }
});

test('offline browser: bylines distinguish event dates and retain their notes', { skip: !options.browser, timeout: 120000 }, async () => {
  const fixture = await browserFixture();
  const note = 'Challenge event began 2026-01-02; article publication date not recorded.';
  for (const [name, fields] of [
    ['legacy-date', {}], ['unknown-date', { publication_date: null }],
    ['publication-date', { publication_date: '2026-02-03', date_note: null }],
    ['event-date', { publication_date: null, date_note: note }],
    ['escaped-note', { publication_date: null, date_note: '<script>Not markup</script>' }],
  ]) Object.assign(await fixture.add(name, html('<p>Date fixture.</p>')), fields);
  const report = await fixture.run();
  assert.equal(report.status, 'complete', JSON.stringify(report.results, null, 2));
  assert.deepEqual(report.results.map(r => r.rendering.byline), [
    'Test Author | 2026-01-02', 'Test Author | 2026-01-02', 'Test Author | 2026-02-03',
    'Test Author | Event date: 2026-01-02', 'Test Author | Event date: 2026-01-02',
  ]);
  assert.equal(report.results[3].rendering.dateNote, note);
  assert.equal(report.results[4].rendering.dateNote, '<script>Not markup</script>');
  assert.equal(report.results[4].rendering.scripts, 0);
  const pages = await inspectPDF(fixture, 'event-date');
  if (pages) {
    const text = pages.map(p => p.text).join('\n');
    assert.ok(text.includes('Event date: 2026-01-02'));
    assert.ok(text.replace(/\s+/g, ' ').includes(note));
    assert.ok(!text.includes('Publication date: 2026-01-02'));
  }
});

test('offline browser: missing local serif font is fatal', { skip: !options.browser, timeout: 90000 }, async () => {
  const fixture = await browserFixture(); await fixture.add('font', html('<p>Font load must succeed.</p>'));
  await fs.unlink(path.join(fixture.site, 'assets/fonts/computer-modern/roman.woff2'));
  const report = await fixture.run();
  assert.equal(report.status, 'failed'); assert.equal(report.rendered, 0);
  assert.ok(report.results[0].failedRequests.some(r => r.type === 'font'));
});

test('offline browser: root deployment, directory route and oversized limit remain partial', { skip: !options.browser, timeout: 90000 }, async () => {
  const fixture = await browserFixture('');
  await fs.mkdir(path.join(fixture.site, 'nested'));
  const post = await fixture.add('nested/index', html('<p>A directory-index publication.</p>'));
  Object.assign(post, { url: '/nested/', pdf_url: '/nested.pdf', bib_url: '/nested.bib', canonical_url: 'https://example.test/nested/' });
  const report = await fixture.run({ limit: '99' });
  assert.equal(report.status, 'partial', JSON.stringify(report.results, null, 2));
  assert.equal(report.partial, true); assert.equal(report.selected, 1); assert.equal(report.rendered, 1);
  const original = await fs.readFile(path.join(fixture.site, 'nested.pdf'));
  const rerun = await fixture.run();
  assert.equal(rerun.status, 'failed');
  assert.match(rerun.results[0].error, /overwrite/);
  assert.deepEqual(await fs.readFile(path.join(fixture.site, 'nested.pdf')), original);
});
