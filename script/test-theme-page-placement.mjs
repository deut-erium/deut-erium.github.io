#!/usr/bin/env node
// Whole-page desktop-grid regression. Serve only an explicitly supplied build
// into an intercepted browser origin; no request is sent to the network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import puppeteer from '../.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const { values: opt } = parseArgs({ options: { site: { type: 'string' }, out: { type: 'string' } } });
assert.ok(opt.site && opt.out, 'Supply --site GENERATED_BUILD --out agent_out/RESULTS');
const root = fs.realpathSync(opt.site), out = path.resolve(opt.out);
assert.ok(fs.existsSync(path.join(root, 'index.html')) && !fs.existsSync(path.join(root, '_config.yml')), 'Generated output required');
assert.ok(out.startsWith(path.resolve('agent_out') + path.sep) && !out.startsWith(root + path.sep));
let parent = out; while (!fs.existsSync(parent)) parent = path.dirname(parent);
const resolvedParent = fs.realpathSync(parent), allowed = path.resolve('agent_out');
assert.ok(resolvedParent === allowed || resolvedParent.startsWith(allowed + path.sep), 'Output must not escape through a symlink');
fs.mkdirSync(out, { recursive: true });
assert.ok(!fs.existsSync(path.join(out, 'results.json')), 'Use a fresh results directory');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'],
  env: { ...process.env, LD_LIBRARY_PATH: process.env.BLOG_CHROME_LIBS || ['agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu', 'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu', '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'].map(p => path.resolve(p)).join(':') } });
const routes = ['/', '/archive.html', '/about.html', '/2026/03/03/unfaithful-claims-breaking-6-zkvms.html', '/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html'];
const widths = [320, 390, 768, 1440, 1472, 1473, 1536, 1920, 2560];
const results = [];
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if (url.origin !== 'https://placement.test' || !['GET', 'HEAD'].includes(request.method())) return request.abort();
      let name = path.join(root, '.' + decodeURIComponent(url.pathname));
      if (fs.statSync(name).isDirectory()) name = path.join(name, 'index.html');
      name = fs.realpathSync(name); if (!name.startsWith(root + path.sep)) return request.abort();
      const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(name)] || 'application/octet-stream';
      request.respond({ status: 200, contentType, body: fs.readFileSync(name) });
    } catch { request.respond({ status: 404, body: 'Not found' }).catch(() => {}); }
  });
  const inspect = () => page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), s = getComputedStyle(el); return { x: r.x, y: r.y + scrollY, right: r.right, bottom: r.bottom + scrollY, width: r.width, height: r.height, area: s.gridArea }; };
    const header = box('.site-header'), main = box('#content'), footer = box('#site-footer');
    const grid = getComputedStyle(document.body).display === 'grid', issues = [];
    if (grid && main.area !== 'folio') issues.push('main lost folio placement');
    if (grid && footer.area !== 'footer') issues.push('footer lost page-grid placement');
    // The redesigned folio uses a one-column named grid on mobile too.
    // Keep the desktop floor and check proportional width below it.
    if (grid && main.width < (innerWidth >= 1200 ? 560 : innerWidth * .75)) issues.push('main squeezed into implicit column');
    if (footer.y < main.bottom - 1) issues.push('footer before content end');
    if (header.x < main.right - 1 && header.right > main.x + 1 && header.y < main.bottom - 1 && header.bottom > main.y + 1) issues.push('header/content overlap');
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal page overflow');
    if (footer.width < 250 || footer.x < 0 || footer.right > innerWidth + 1) issues.push('footer squeezed or outside page');
    if (grid && [...document.querySelectorAll('.record-head .tag-line a')].some(a => a.getBoundingClientRect().width > main.width / 2)) issues.push('article tags inherit full-width dock controls');
    return { width: innerWidth, skin: document.documentElement.dataset.skin, scheme: document.documentElement.dataset.theme, grid, header, main, footer, issues };
  });
  for (const mode of ['light', 'dark']) for (const route of routes) for (const width of widths) {
    await page.setViewport({ width, height: 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto('https://placement.test' + route + '?skin=margin-of-error', { waitUntil: 'load' });
    // Match the saved-theme path used by the site, including live re-selection.
    await page.evaluate(mode => { localStorage.setItem('deuterium-theme', mode); }, mode);
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const row = { mode, route, ...await inspect() };
    if (row.skin !== 'margin-of-error' || row.scheme !== mode) row.issues.push('theme selection');
    results.push(row);
    if (width === 1920 && (route === '/' || route.includes('unfaithful'))) {
      const key = `${mode}-${route === '/' ? 'home' : 'article'}`;
      await page.screenshot({ path: path.join(out, key + '-top.png') });
      await page.$eval('#site-footer', el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
      await page.screenshot({ path: path.join(out, key + '-footer.png') });
      await page.evaluate(() => scrollTo(0, 0));
      const mutation = await page.addStyleTag({ content: 'html[data-skin="margin-of-error"] { --article-page-area: initial; --footer-page-area: initial; }' });
      assert.ok((await inspect()).issues.length, 'Missing placement hooks must fail the geometry check');
      await mutation.evaluate(el => el.remove()); await mutation.dispose();
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}
assert.equal(results.length, 90);
assert.deepEqual(results.filter(r => r.issues.length), []);
console.log('90 whole-page placement cases passed, including 1472/1473px breakpoint and missing-hook mutations.');
