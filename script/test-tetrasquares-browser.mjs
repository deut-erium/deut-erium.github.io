// Optional local browser regression. External telemetry is always stubbed or blocked.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { default: puppeteer } = await import(pathToFileURL(path.resolve('.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')));
const root = path.resolve(process.argv[2] || 'agent_out/tetrasquares-migration/site');
const out = path.resolve('agent_out/tetrasquares-migration');
fs.mkdirSync(out, { recursive: true });
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
    ['/tetrasquares/catalog/?size=6&family=O9', '#catalog-machine:not([hidden])', '/tetrasquares/catalog/', true, false],
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
        assert.match(await page.$eval('#practice-construction', e => e.href), /\/tetrasquares\/\?practice=6&family=O9$/);
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
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
