// Optional local browser regression. External telemetry is always stubbed or blocked.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { default: puppeteer } = await import(pathToFileURL(path.resolve('.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')));
const root = path.resolve(process.argv[2] || 'agent_out/tetrasquares-migration/site');
const out = path.resolve('agent_out/tetrasquares-migration');
const saveResults = !process.argv.includes('--stdout-only');
if (saveResults) fs.mkdirSync(out, { recursive: true });
const result = { pass: false, checks: [], external: [], errors: [] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function checkAnimation(page, { loop }) {
  assert.equal(await page.$eval('#play', el => el.getAttribute('aria-pressed')), 'true');
  const snapshot = async () => page.$eval('#family-board', el => el.toDataURL());
  const step = await page.$eval('#step', el => el.value);
  const before = await snapshot();
  await page.waitForFunction(value => document.querySelector('#step').value !== value, { timeout: 2000 }, step);
  assert.notEqual(await snapshot(), before, 'Animation must change the drawn blocks, not just a table or counter');
  if (loop) {
    await page.waitForFunction(() => {
      const step = document.querySelector('#step');
      return step.value === step.max;
    }, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#step').value === '0', { timeout: 2000 });
  }
  await page.click('#play');
  const paused = await page.$eval('#step', el => el.value);
  const still = await snapshot();
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(await page.$eval('#step', el => el.value), paused);
  assert.equal(await snapshot(), still, 'Pause must stop the visible animation');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('#play');
  const started = await page.$eval('#step', el => el.value);
  const reducedBefore = await snapshot();
  await page.waitForFunction(value => document.querySelector('#step').value !== value, { timeout: 2000 }, started);
  assert.notEqual(await snapshot(), reducedBefore, 'Explicit Play must work with reduced motion enabled');
  await page.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.$eval('#play', el => el.textContent), 'Play');
  const layout = await page.evaluate(() => {
    const controls = document.querySelector('#step-controls').getBoundingClientRect();
    const board = document.querySelector('#family-board').getBoundingClientRect();
    const text = document.querySelector('#family-grid').closest('.sr-only');
    return { controlsBeforeBoard: controls.bottom <= board.top,
      textWidth: text?.getBoundingClientRect().width, textOverflow: text && getComputedStyle(text).overflow,
      oldInstructions: /Choose a piece mix|Numbers show the drop order/.test(document.body.textContent) };
  });
  assert.equal(layout.controlsBeforeBoard, true);
  assert.equal(layout.textWidth, 1);
  assert.equal(layout.textOverflow, 'hidden');
  assert.equal(layout.oldInstructions, false);
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'],
    env: { ...process.env, LD_LIBRARY_PATH: process.env.BLOG_CHROME_LIBS || path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu') }
  });
  const cases = [
    ['/tetrasquares/', '#game-machine:not([hidden])', '/tetrasquares/', true, false],
    ['/tetrasquares/?layout=warm-cartridge', '#game-machine:not([hidden])', '/tetrasquares/', true, true],
    ['/tetrasquares/?practice=4&family=T4', '#practice-panel:not([hidden])', '/tetrasquares/', true, false],
    ['/tetrasquares/catalog/?size=4&family=T4', '#catalog-machine:not([hidden])', '/tetrasquares/catalog/', true, true],
    ['/tetrasquares/catalog/?size=6&family=O9', '#catalog-machine:not([hidden])', '/tetrasquares/catalog/', true, false],
    ['/tetrasquares/catalog/?size=8&family=T16', '#catalog-machine:not([hidden])', '/tetrasquares/catalog/', true, true],
    ['/tetrasquares/scoring/', 'main', '/tetrasquares/scoring/', false, true]
  ];
  for (const [route, ready, canonical, js, blocked] of cases) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const errors = [];
    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.setJavaScriptEnabled(js);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) errors.push(r.url()); });
      page.on('requestfailed', r => { if (r.url().startsWith(origin)) errors.push(r.url()); });
      await page.setRequestInterception(true);
      page.on('request', r => {
        const url = new URL(r.url());
        if (url.origin === origin || url.protocol === 'data:') return r.continue();
        result.external.push({ route, url: r.url(), action: !blocked && r.url() === 'https://gc.zgo.at/count.js' ? 'stubbed' : 'blocked' });
        if (!blocked && r.url() === 'https://gc.zgo.at/count.js') return r.respond({
          status: 200, contentType: 'text/javascript', body: 'window.__counterStub = (window.__counterStub || []); window.__counterStub.push(JSON.parse(document.currentScript.dataset.goatcounterSettings));'
        });
        return r.abort();
      });
      const response = await page.goto(origin + route, { waitUntil: 'networkidle0' });
      assert.equal(response.status(), 200);
      await page.waitForSelector(ready);
      assert.equal(await page.$eval('link[rel=canonical]', e => new URL(e.href).pathname), canonical);
      if (js && !blocked) {
        const events = await page.evaluate(() => window.__counterStub);
        assert.equal(events.length, 1); assert.equal(events[0].path, canonical);
      }
      if (route.includes('practice=')) assert.match(await page.$eval('#practice-catalog', e => e.href), /\/tetrasquares\/catalog\/\?size=4&family=T4$/);
      if (route.includes('/catalog/')) {
        await checkAnimation(page, { loop: true });
        result.checks.push({ route, autoplay: true, looping: true,
          canvasFrames: true, pause: true, explicitReducedMotionPlayback: true, textGridScreenReaderOnly: true });
      }
      if (route.includes('size=8')) {
        const checkExample = async () => {
          await page.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input')); });
          const state = await page.evaluate(() => {
            const board = document.querySelector('#family-board');
            const ctx = board.getContext('2d');
            let colored = 0;
            for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
              const [r, g, b] = ctx.getImageData(x * 45 + 8, y * 45 + 8, 1, 1).data;
              if (r !== 18 || g !== 61 || b !== 115) colored += 1;
            }
            const cells = [...document.querySelectorAll('#family-grid-body td')].map(e => e.textContent);
            return {
              title: document.querySelector('#family-title').textContent, colored, cells,
              drawingWidth: board.getBoundingClientRect().width,
              controls: getComputedStyle(document.querySelector('#step-controls')).display,
              order: getComputedStyle(document.querySelector('#order-section')).display,
              practice: getComputedStyle(document.querySelector('#practice-construction')).display,
              points: document.querySelector('#construction-score').textContent,
              overflow: document.documentElement.scrollWidth - innerWidth,
            };
          });
          assert.ok(state.drawingWidth > 0);
          assert.equal(state.colored, 64, state.title);
          assert.equal(state.cells.length, 64);
          assert.equal(new Set(state.cells).size, 16);
          for (const cell of new Set(state.cells)) assert.equal(state.cells.filter(value => value === cell).length, 4);
          assert.ok(state.cells.every(cell => /^[IJLOSTZ] piece \d+$/.test(cell)));
          assert.notEqual(state.controls, 'none');
          assert.equal(state.order, 'none');
          assert.equal(state.practice, 'none');
          assert.match(state.points, /^(10,000|20,000)$/);
          assert.ok(state.overflow <= 2, `Horizontal overflow: ${state.overflow}`);
        };
        const searchFor = async id => {
          await page.$eval('#search', (el, value) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }, id);
        };
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        for (const width of [1280, 390, 320]) {
          await page.setViewport({ width, height: 844 });
          await checkExample();
        }
        for (const id of ['O16', 'T8-Z8', 'S2-T6-Z8']) {
          await searchFor(id);
          assert.equal(await page.$eval('#family-title', el => el.textContent), id);
          await checkExample();
        }
        await searchFor('');
        await page.select('#kind', 'spectrum');
        assert.equal((await page.$eval('#family-title', el => el.textContent)).split('-').length, 7);
        await checkExample();
        await page.select('#kind', 'gold');
        await checkExample();
        await page.select('#kind', '');
        await searchFor('T8-Z8');
        await searchFor('');
        await page.click('#list-next');
        assert.match(await page.$eval('#list-range', el => el.textContent), /^251-500 of 30,434$/);
        await checkExample();
        await page.click('#list-previous');
        await checkExample();
        await searchFor('no-such-piece-mix');
        assert.equal(await page.$eval('#family-detail', el => getComputedStyle(el).display), 'none');
        await page.click('[data-size="4"]');
        await page.waitForFunction(() => document.querySelector('#step').max === '4');
        assert.notEqual(await page.$eval('#step-controls', el => getComputedStyle(el).display), 'none');
        assert.notEqual(await page.$eval('#practice-construction', el => getComputedStyle(el).display), 'none');
        await page.$eval('#step', el => { el.value = '1'; el.dispatchEvent(new Event('input')); });
        assert.equal(await page.$$eval('#family-grid-body td', cells => cells.filter(el => el.textContent === 'Empty').length), 12);
        await page.click('[data-size="6"]');
        await page.waitForFunction(() => document.querySelector('#step').max === '9');
        assert.notEqual(await page.$eval('#order-section', el => getComputedStyle(el).display), 'none');
        result.checks.push({ route, representativeDiagrams: true, paging: true, filters: true,
          viewportWidths: [1280, 390, 320], reducedMotion: true, sizeSwitching: true });
      }
      if (route.includes('/catalog/') && !route.includes('size=8')) {
        const selected = new URL(origin + route).searchParams;
        const practice = new URL(await page.$eval('#practice-construction', e => e.href));
        assert.equal(practice.pathname, '/tetrasquares/');
        assert.equal(practice.searchParams.get('practice'), selected.get('size'));
        assert.equal(practice.searchParams.get('family'), selected.get('family'));
        await page.click('#practice-construction');
        await page.waitForSelector('#practice-panel:not([hidden])');
        assert.equal(new URL(page.url()).pathname, '/tetrasquares/');
      }
      assert.deepEqual(errors, []);
      result.checks.push({ route, js, blocked, pass: true });
    } finally { await context.close(); }
  }
  for (const route of ['/new-tetris/', '/new-tetris/src/catalog/index.html', '/new-tetris/src/scoring/index.html']) {
    assert.equal((await fetch(origin + route)).status, 404);
    result.checks.push({ route, removed: true, pass: true });
  }
  result.pass = true;
} catch (e) {
  result.errors.push(String(e));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  if (saveResults) fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
