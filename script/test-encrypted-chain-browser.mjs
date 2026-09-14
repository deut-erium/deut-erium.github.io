// Offline Chromium check of repository-produced envelopes in the built locked layout.
// Synthetic bodies replace the article body; existing ciphertext is never decrypted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const site = path.resolve(process.argv[2] || 'agent_out/encryption-chain/release/site');
const out = path.resolve('agent_out/encryption-chain/e2e');
await fs.mkdir(out, { recursive: true });
let puppeteer;
for (const location of ['node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js', '.toolchain/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js', '.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js']) {
  try { puppeteer = (await import(pathToFileURL(path.resolve(location)))).default; break; } catch (_) { /* Try cached packages only. */ }
}
if (!puppeteer) throw new Error('Puppeteer unavailable; no download attempted');
const fixture = await fs.mkdtemp(path.join(out, 'fixture-'));
const repo = path.join(fixture, 'repo');
await fs.mkdir(path.join(repo, 'script'), { recursive: true });
for (const name of ['encrypt_post.py', 'embed_post_assets.py']) await fs.copyFile(path.join(root, 'script', name), path.join(repo, 'script', name));
const answers = ['flag{synthetic-chain-entry}', 'flag{synthetic-chain-next}'];
const routes = ['/locked/2099/01/01/entry.html', '/locked/2099/01/02/next.html', '/locked/2099/01/03/legacy.html'];
const author = (id, answer) => {
  const text = execFileSync(process.env.RUBY || path.resolve('.toolchain/bin/ruby'), ['script/new_challenge.rb', '--html'], { input: `${id}\n${answer}\nSynthetic clue\n`, encoding: 'utf8' });
  return text.slice(text.indexOf('<form'), text.indexOf('\nsalted digest:')).trim();
};
const privateChecker = author('synthetic-next', answers[1]);
const notes = 'Synthetic embedded attachment only.\n';
await fs.writeFile(path.join(fixture, 'notes.txt'), notes);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=', 'base64');
await fs.writeFile(path.join(fixture, 'pic.png'), png);
const produce = async (name, route, answer, needs, html, extra = []) => {
  const input = path.join(fixture, `${name}.html`);
  await fs.writeFile(input, html, { mode: 0o600 });
  execFileSync(process.env.PYTHON || 'python3', [path.join(repo, 'script/encrypt_post.py'), '--plaintext', input, '--answer-stdin', '--out', route.slice(1).replace(/html$/, 'md'), '--unlisted', '--title', 'Synthetic chain test', '--needs', needs, '--embed-assets', ...extra], { input: `${answer}\n`, encoding: 'utf8' });
  const text = await fs.readFile(path.join(repo, route.slice(1).replace(/html$/, 'md')), 'utf8');
  return text.slice(text.indexOf('<div class="argon"')).trim();
};
const first = await produce('entry', routes[0], answers[0], 'synthetic-entry', `<h2 id="private-first">Synthetic private first body</h2><img id="private-image" src="pic.png" alt="Synthetic pixel"><a id="private-download" href="notes.txt" download="notes.txt">Download notes</a>${privateChecker}<a id="next-door" href="${routes[1]}">Next door</a>`);
const next = await produce('next', routes[1], answers[1], 'synthetic-next', '<h2 id="private-next">Synthetic private next body</h2>', ['--previous', routes[0]]);
const legacy = await produce('legacy', routes[2], answers[0], 'synthetic-entry', '<h2 id="private-legacy">Synthetic legacy body</h2>', ['--legacy']);
const original = await fs.readFile(path.join(site, 'ctf-tutorials/2026/09/05/the-first-door.html'), 'utf8');
assert.ok(original.includes('/assets/js/chain-session.js') && original.includes('/assets/js/challenge.js'), 'Build must include the session and private-checker dependencies');
const shell = (body, position = 1) => original.replace(/<article id="article-body"[^>]*>[\s\S]*?<\/article>/, `<article id="article-body" class="prose article__content">${body}</article>`)
  .replace(/<title>[\s\S]*?<\/title>/, '<title>Synthetic browser test</title>')
  .replace(/dataset.chainPosition = \d+/, `dataset.chainPosition = ${position}`)
  .replace(/dataset.chainLength = \d+/, 'dataset.chainLength = 2');
const pages = new Map([['/checker/', shell(author('synthetic-entry', answers[0]))], [routes[0], shell(first)], [routes[1], shell(next, 2)], [routes[2], shell(legacy)]]);
for (const body of [first, next, legacy]) {
  assert.ok(!body.includes('Synthetic private') && !body.includes('notes.txt'));
  for (const answer of answers) assert.ok(!body.includes(answer));
}
const result = { pass: false, cases: [], pageErrors: [], missing: [], blocked: [] };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
  env: { ...process.env, LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')].filter(Boolean).join(':') } });
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
    if (url.origin !== 'https://fixture.invalid') { result.blocked.push(url.origin); return request.abort(); }
    if (pages.has(url.pathname)) return request.respond({ status: 200, contentType: 'text/html', body: pages.get(url.pathname) });
    const file = path.resolve(site, '.' + decodeURIComponent(url.pathname));
    if (file.startsWith(site + path.sep)) {
      try {
        const body = await fs.readFile(file);
        const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
        return request.respond({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body });
      } catch (_) { /* Record absent local resources below. */ }
    }
    result.missing.push(url.pathname); return request.respond({ status: 404, body: 'Missing fixture resource' });
  });
  await page.evaluateOnNewDocument(() => {
    window.testEvents = [];
    for (const name of ['deuterium:solved', 'deuterium:attempt', 'deuterium:chain-session']) document.addEventListener(name, event => window.testEvents.push({ name, detail: event.detail }));
  });
  const go = async route => { await page.goto('https://fixture.invalid' + route, { waitUntil: 'networkidle0' }); };
  const clean = async () => {
    const value = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, events: window.testEvents, url: location.href }));
    for (const answer of answers) assert.ok(!value.includes(answer), 'Answer must not enter persistent progress, events or URL');
    assert.ok(!value.includes('"flag":'));
  };
  const grade = async (id, answer) => {
    await page.type('#flag-' + id, answer);
    await page.click(`#flag-${id} ~ button` ).catch(async () => {
      await page.$eval('#flag-' + id, input => input.closest('form').requestSubmit());
    });
    await page.waitForFunction(id => document.getElementById('flag-' + id).closest('form').classList.contains('is-solved'), {}, id);
    assert.equal(await page.$eval('#flag-' + id, e => e.value), '');
    await clean();
  };
  await page.setViewport({ width: 390, height: 844 });
  await go('/checker/');
  await grade('synthetic-entry', answers[0]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('deuterium-chain-session')), null);
  await go(routes[0]);
  assert.equal(await page.$('#private-first'), null);
  await page.type('#argon-key', 'synthetic-wrong-answer');
  await page.click('.argon-unlock button[type=submit]');
  await page.waitForSelector('.argon-note.is-wrong');
  assert.equal(await page.$('#private-first'), null);
  await page.$eval('#argon-key', e => { e.value = ''; });
  await page.type('#argon-key', answers[0]); await page.click('.argon-unlock button[type=submit]');
  await page.waitForSelector('#private-first');
  assert.equal(await page.$eval('#private-image', image => image.complete && image.naturalWidth), 1);
  const href = await page.$eval('#private-download', a => a.href);
  assert.equal(Buffer.from(href.split(',')[1], 'base64').toString(), notes);
  assert.equal(await page.$eval('#private-image', image => image.src), 'data:image/png;base64,' + png.toString('base64'));
  const downloads = path.join(out, 'downloads'); await fs.mkdir(downloads, { recursive: true });
  await fs.rm(path.join(downloads, 'notes.txt'), { force: true });
  const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.click('#private-download');
  for (let n = 0; n < 50; n++) { try { if (await fs.readFile(path.join(downloads, 'notes.txt'), 'utf8') === notes) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal(await fs.readFile(path.join(downloads, 'notes.txt'), 'utf8'), notes);
  await clean();
  assert.equal(await page.$eval('#flag-synthetic-next', input => {
    const form = input.closest('form'), label = form.querySelector('label').getBoundingClientRect();
    const sound = form.querySelector('.flag-check__sound').getBoundingClientRect();
    return sound.top >= label.bottom || sound.bottom <= label.top;
  }), true, 'Sound control must not overlap the checker label');
  await page.screenshot({ path: path.join(out, 'manual-open-mobile.png'), fullPage: true });
  await page.reload({ waitUntil: 'networkidle0' }); assert.equal(await page.$('#private-first'), null);
  result.cases.push('Default solve stores no answer; wrong/manual unlock, embedded image/download bytes, reload locked');
  await go('/checker/');
  await page.click('[data-chain-session-opt-in]');
  await page.click('[data-flag-reenter]');
  await grade('synthetic-entry', answers[0]);
  await go(routes[0]); await page.waitForSelector('#private-first');
  await grade('synthetic-next', answers[1]);
  await page.click('#next-door'); await page.waitForSelector('#private-next');
  await clean();
  result.cases.push('Opt-in public solve opens first page; authenticated private checker opens next page');
  await go(routes[0]); await page.waitForSelector('#private-first');
  await page.click('[data-chain-session-clear]');
  await page.waitForFunction(() => !document.querySelector('#private-first'));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('deuterium-chain-session')), null);
  await page.reload({ waitUntil: 'networkidle0' }); assert.equal(await page.$('#private-first'), null);
  result.cases.push('Clear inside decrypted checker opts out, relocks and prevents reopening');
  await page.setViewport({ width: 1440, height: 1000 });
  await go(routes[2]); await page.type('#argon-key', answers[0]); await page.click('.argon-unlock button[type=submit]');
  await page.waitForSelector('#private-legacy'); await clean();
  await page.screenshot({ path: path.join(out, 'legacy-open-desktop.png'), fullPage: true });
  result.cases.push('Repository-produced legacy envelope remains readable');
  for (const width of [390, 1440]) {
    await page.setViewport({ width, height: 900 }); await go(routes[0]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
  }
  assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.missing, []);
  result.pass = true;
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'RESULTS.json'), JSON.stringify(result, null, 2) + '\n');
  await fs.rm(fixture, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
