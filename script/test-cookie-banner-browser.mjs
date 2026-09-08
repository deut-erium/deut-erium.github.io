// Browser checks against a built site. Random draws are controlled; production
// banner HTML, JS and CSS are not replaced. External requests are blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const site = path.resolve(process.env.COOKIE_TEST_SITE || 'agent_out/cookie-banner/site');
const out = path.resolve(process.env.COOKIE_TEST_OUT || 'agent_out/cookie-banner/browser');
await fs.mkdir(out, { recursive: true });
const cssPath = '/assets/css/features/cookie-banner.css';
const jsPath = '/assets/js/features/cookie-banner.js';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const blocked = [], results = [];
let failCSS = false;
const server = http.createServer(async (req, res) => {
  try {
    if (/^https?:/i.test(req.url)) { blocked.push(req.url); res.writeHead(403); res.end(); return; }
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (failCSS && name === cssPath) { res.writeHead(404); res.end('Intentional CSS failure'); return; }
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(site, `.${name}`);
    if (!file.startsWith(site + path.sep)) throw new Error('Outside site');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('connect', (req, socket) => { blocked.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run', `--proxy-server=${origin}`],
  env: { ...process.env, LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')].filter(Boolean).join(':') },
});
let current;
async function open({ route = '/', roll = 0.5, legacy = null, storageBlocked = false, js = true, hold = false, skin = 'rpn-garden', mode = 'light' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const requests = [], errors = [], failures = [];
  current = page;
  let release;
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setJavaScriptEnabled(js);
  await page.evaluateOnNewDocument(({ roll, legacy, storageBlocked }) => {
    window.__cookieDraws = 0;
    Math.random = () => { window.__cookieDraws++; return roll; };
    if (legacy !== null) localStorage.setItem('deuterium-cookie-banner', legacy);
    if (storageBlocked) {
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
        configurable: true, get() { throw new DOMException('Storage blocked by test', 'SecurityError'); },
      });
    }
  }, { roll, legacy, storageBlocked });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin) {
      requests.push(url.pathname);
      if (hold && url.pathname === jsPath && !release) release = () => request.continue();
      else request.continue();
    } else if (['data:', 'blob:'].includes(url.protocol)) request.continue();
    else { blocked.push(request.url()); request.abort(); }
  });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) failures.push(new URL(response.url()).pathname);
  });
  const navigation = page.goto(`${origin}${route}?skin=${skin}`, { waitUntil: 'load', timeout: 30000 });
  if (hold) await page.waitForSelector('#cookie-banner');
  else await navigation;
  return { context, page, requests, errors, failures, navigation, release: () => { assert.ok(release); return release(); } };
}
async function state(page) {
  return page.evaluate(() => {
    const banner = document.getElementById('cookie-banner');
    return { exists: Boolean(banner), hidden: banner?.hidden ?? true,
      visible: Boolean(banner?.checkVisibility()), display: banner ? getComputedStyle(banner).display : null,
      draws: window.__cookieDraws || 0 };
  });
}
function checked(c, label, extra = {}) {
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.failures, failCSS ? [cssPath] : []);
  results.push({ label, ...extra, cssRequests: c.requests.filter(p => p === cssPath).length, pass: true });
}
try {
  for (const route of ['/', '/mastermind/', '/2026/09/06/masatermind.html']) {
    for (const storage of ['empty', 'old-dismissal', 'blocked']) {
      for (const roll of [0.005, 0.5]) {
        const c = await open({ route, roll, legacy: storage === 'old-dismissal' ? '1' : null, storageBlocked: storage === 'blocked' });
        if (roll < 0.01) await c.page.waitForFunction(() => !document.getElementById('cookie-banner')?.hidden);
        const s = await state(c.page);
        assert.equal(s.draws, 1);
        assert.equal(s.visible, roll < 0.01);
        assert.equal(s.exists, roll < 0.01);
        assert.equal(c.requests.filter(p => p === cssPath).length, roll < 0.01 ? 1 : 0);
        if (storage !== 'blocked') assert.equal(await c.page.evaluate(() => localStorage.getItem('deuterium-cookie-banner')), storage === 'old-dismissal' ? '1' : null);
        assert.deepEqual(await c.context.cookies(), []);
        if (route === '/' && storage === 'empty') await c.page.screenshot({ path: path.join(out, roll < 0.01 ? 'selected.png' : 'not-selected.png') });
        checked(c, 'probability and storage', { route, storage, roll, state: s });
        await c.context.close();
      }
    }
    const c = await open({ route, roll: 0, js: false });
    const s = await state(c.page);
    assert.equal(s.exists, true);
    assert.equal(s.hidden, true);
    assert.equal(s.visible, false);
    assert.equal(s.display, 'none');
    assert.equal(s.draws, 0);
    assert.equal(c.requests.filter(p => p === cssPath).length, 0);
    if (route === '/') await c.page.screenshot({ path: path.join(out, 'no-javascript.png') });
    checked(c, 'JavaScript disabled', { route, state: s });
    await c.context.close();
  }

  for (const roll of [0, 0.009999999999999998, 0.01]) {
    const c = await open({ roll });
    if (roll < 0.01) await c.page.waitForSelector('#cookie-banner', { visible: true });
    const s = await state(c.page);
    assert.equal(s.visible, roll < 0.01);
    assert.equal(s.draws, 1);
    await c.page.addScriptTag({ url: origin + jsPath });
    assert.equal((await state(c.page)).draws, 1);
    assert.equal(c.requests.filter(p => p === cssPath).length, roll < 0.01 ? 1 : 0);
    checked(c, 'boundary and duplicate initialization', { roll });
    await c.context.close();
  }

  for (const action of ['accept', 'reject', 'Escape']) {
    const c = await open({ roll: 0.005, legacy: '1' });
    await c.page.waitForSelector('#cookie-banner', { visible: true });
    await c.page.click('#cookie-banner [data-prefs]');
    assert.equal(await c.page.$eval('#cookie-banner-prefs', p => p.hidden), false);
    await c.page.click('#cookie-banner [data-prefs]');
    assert.equal(await c.page.$eval('#cookie-banner-prefs', p => p.hidden), true);
    if (action === 'Escape') await c.page.keyboard.press('Escape');
    else await c.page.click(`#cookie-banner .cookie-banner__btn:nth-child(${action === 'accept' ? 1 : 2})`);
    assert.equal((await state(c.page)).exists, false);
    await c.page.addScriptTag({ url: origin + jsPath });
    assert.equal((await state(c.page)).draws, 1);
    assert.equal((await state(c.page)).exists, false);
    assert.equal(await c.page.evaluate(() => localStorage.getItem('deuterium-cookie-banner')), '1');
    await c.page.reload({ waitUntil: 'load' });
    await c.page.waitForSelector('#cookie-banner', { visible: true });
    assert.equal((await state(c.page)).draws, 1, 'A reload gets a fresh document and draw');
    assert.equal(c.requests.filter(p => p === cssPath).length, 2);
    checked(c, 'dismissal, preferences and fresh-page draw', { action });
    await c.context.close();
  }

  failCSS = true;
  {
    const c = await open({ roll: 0.005 });
    await c.page.waitForSelector('#cookie-banner', { visible: true });
    assert.equal((await state(c.page)).draws, 1);
    await c.page.keyboard.press('Escape');
    assert.equal((await state(c.page)).exists, false);
    checked(c, 'stylesheet failure uses the existing fallback, without another draw');
    await c.context.close();
  }
  failCSS = false;

  const allSkins = [...(await fs.readFile('_data/themes.yml', 'utf8')).matchAll(/^- id: (\S+)/gm)].map(m => m[1]);
  const skins = process.env.COOKIE_TEST_ALL_SKINS === '1' ? allSkins : ['rpn-garden', 'high-lonesome-protocol', 'grid-meltdown'];
  for (const skin of skins) for (const mode of ['light', 'dark']) {
    const c = await open({ skin, mode, hold: true });
    const before = await state(c.page);
    assert.equal(before.exists, true);
    assert.equal(before.visible, false, `${skin} ${mode}: banner visible before script execution`);
    assert.equal(before.display, 'none');
    assert.equal(before.draws, 0);
    await c.release(); await c.navigation;
    const after = await state(c.page);
    assert.equal(after.exists, false);
    assert.equal(after.draws, 1);
    assert.equal(c.requests.filter(p => p === cssPath).length, 0);
    checked(c, 'hidden before JavaScript and removed after skipped draw', { skin, mode });
    await c.context.close();
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ passed: true, checks: results.length, results, blocked: [...new Set(blocked)] }, null, 2) + '\n');
  console.log(`PASS: ${results.length} browser cases, including ${skins.length * 2} pre-script theme states`);
} catch (error) {
  await current?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(out, 'ERROR.txt'), String(error.stack));
  await fs.writeFile(path.join(out, 'partial-results.json'), JSON.stringify(results, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
