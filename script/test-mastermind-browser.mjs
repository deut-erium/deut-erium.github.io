// Offline Chromium integration tests. Build into the private site directory
// first. All external requests are blocked, including site telemetry/fonts.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createSession } from '../assets/js/mastermind/session.mjs';
import { chooseGuess } from '../assets/js/mastermind/policies.mjs';

const out = path.resolve('agent_out/mastermind-publish/ui');
const site = path.resolve(process.env.MASTERMIND_TEST_SITE || path.join(out, 'site'));
await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(out, 'downloads'), { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
let delayPolicyImport = false;
const server = http.createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(site, `.${name}`);
    if (!file.startsWith(`${site}/`)) throw new Error('Path outside site');
    const data = await fs.readFile(file);
    if (delayPolicyImport && name.endsWith('/mastermind/policies.mjs')) await new Promise(resolve => setTimeout(resolve, 250));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run'],
  env: { ...process.env, LD_LIBRARY_PATH: path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu') },
});
const results = [];
let activePage = null;
const routes = ['/mastermind/', '/2026/09/06/masatermind.html'];
const p = name => `[data-mastermind] [data-part="${name}"]`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const initial = changes => ({ positions: 4, colors: 6, secret: [6, 6, 6, 6], seed: 7,
  mode: 'misread', policy: 'fields', lieBudget: null, noiseModel: 'forced-change', probability: 1, ...changes });
const issue = s => s.issueGuess(chooseGuess(s.solverView(), s.initial.policy).guess);
const capSession = createSession(initial());
while (capSession.solverView().turns.length < 59) { issue(capSession); capSession.sampleReply(); }
const capReady = path.join(out, 'ready-query-60.json');
await fs.writeFile(capReady, capSession.exportText());
issue(capSession);
assert.equal(capSession.solverView().phase, 'awaiting-reply');
const capPending = path.join(out, 'pending-query-60.json');
await fs.writeFile(capPending, capSession.exportText());

try {
  for (const route of routes) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    activePage = page;
    const errors = [], localFailures = [], requests = [], workerEpochs = [], restoreTimings = [];
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      requests.push(req.url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) req.continue(); else req.abort();
    });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('response', res => { if (res.url().startsWith(origin) && res.status() >= 400) localFailures.push(res.url()); });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('deuterium-cookie-banner', '1');
      // Real workers compute every response. Holding delivery lets reset/pause/
      // cancel run while requests are pending, then invokes captured stale
      // callbacks even after physical termination to test generation guards.
      const Native = window.Worker;
      const state = { active: 0, maxActive: 0, terminated: 0, hold: false, queued: [], messages: [], elapsed: [], events: [] };
      window.__mmTestWorkers = state;
      window.Worker = class {
        constructor(url, options) {
          this.worker = new Native(url, options);
          state.events.push(['created', performance.now()]);
          this.dead = false;
          state.active++;
          state.maxActive = Math.max(state.maxActive, state.active);
          this.worker.onmessage = event => {
            if (event.data?.type === 'ready') { state.events.push(['ready', performance.now()]); this.onmessage?.(event); return; }
            state.events.push(['received', performance.now(), event.data?.requestId]);
            state.elapsed.push(performance.now() - this.started);
            const callback = this.onmessage;
            if (state.hold) state.queued.push(() => callback?.(event)); else callback?.(event);
          };
          this.worker.onerror = event => this.onerror?.(event);
          this.worker.onmessageerror = event => this.onmessageerror?.(event);
        }
        postMessage(message) {
          this.started = performance.now();
          state.events.push(['posted', performance.now(), message.requestId]);
          state.messages.push(structuredClone(message));
          this.worker.postMessage(message);
        }
        terminate() {
          if (this.dead) throw new Error('Worker terminated twice');
          this.dead = true;
          state.active--;
          state.terminated++;
          state.events.push(['terminated', performance.now()]);
          this.worker.terminate();
        }
      };
    });
    const text = name => page.$eval(p(name), el => el.textContent);
    const click = name => page.click(p(name));
    const select = (name, value) => page.select(p(name), String(value));
    const settled = () => page.waitForFunction(() => !document.querySelector('[data-part="status"]').textContent.includes('Computing'));
    const pending = async () => {
      try { await page.waitForFunction(() => !document.querySelector('[data-part="reply-form"]').hidden, { timeout: 10000 }); }
      catch (failure) {
        await page.screenshot({ path: path.join(out, 'pending-failure.png'), fullPage: true });
        await fs.writeFile(path.join(out, 'pending-failure.html'), await page.content());
        console.error('pending failed:', await text('status'), await text('error'), await rows());
        throw failure;
      }
    };
    const rows = () => page.$$eval(`${p('history')} > li`, els => els.length);
    const saveText = () => page.evaluate(() => localStorage.getItem('mastermind-reference-v1'));
    const showSaves = () => page.$eval(p('file'), el => { el.closest('details').open = true; });
    const restoreFile = async (file, expectRejection = false) => {
      const started = performance.now();
      await showSaves();
      const input = await page.$(p('file'));
      // Wait for this import's completion, not an old non-validating status
      // observed before Chromium dispatches the file input's change event.
      await page.evaluate(() => {
        document.querySelector('[data-part="storage-status"]').textContent = 'Test awaiting restore';
        document.querySelector('[data-part="error"]').textContent = '';
      });
      await input.uploadFile(file);
      await page.waitForFunction(() => document.querySelector('[data-part="storage-status"]').textContent.startsWith('Session restored')
        || document.querySelector('[data-part="error"]').textContent.startsWith('Restore rejected'), { timeout: 60000 });
      if (!expectRejection) {
        assert.equal(await text('error'), '', `valid restore failed: ${path.basename(file)}`);
        assert.match(await text('storage-status'), /^Session restored/);
      }
      restoreTimings.push({ file: path.basename(file), elapsedMs: performance.now() - started });
    };
    const start = async () => { await click('start'); await settled(); };
    const reset = async () => { await click('reset'); assert.equal(await rows(), 0); };
    const hold = value => page.evaluate(value => { window.__mmTestWorkers.hold = value; }, value);
    const queued = async () => {
      try { await page.waitForFunction(() => window.__mmTestWorkers.queued.length > 0, { timeout: 20000 }); }
      catch (failure) {
        console.error('held response failed:', await text('status'), await text('error'), await page.evaluate(() => ({
          active: window.__mmTestWorkers.active, requests: window.__mmTestWorkers.messages.length,
          hold: window.__mmTestWorkers.hold, queued: window.__mmTestWorkers.queued.length,
        })));
        throw failure;
      }
    };
    const flush = () => page.evaluate(() => { const s = window.__mmTestWorkers; s.hold = false; s.queued.splice(0).forEach(fn => fn()); });
    const collectWorkers = async () => {
      const stats = await page.evaluate(() => window.__mmTestWorkers
        ? { ...window.__mmTestWorkers, queued: window.__mmTestWorkers.queued.length } : null);
      if (stats) workerEpochs.push(stats);
    };
    const goto = async () => {
      await collectWorkers();
      const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle0' });
      assert.equal(response.status(), 200);
      await page.waitForSelector('[data-mastermind][data-mounted="true"]');
      assert.equal(await page.evaluate(() => crossOriginIsolated), false);
    };
    await goto();
    assert.equal(await saveText(), null);
    assert.equal(await page.$eval('[data-mastermind] > script', el => Boolean(el)).catch(() => false), false);
    const versions = await page.$$eval('link[href*="mastermind.css"], script[src*="mastermind/ui.mjs"]', els => els.map(el => el.href || el.src));
    assert.equal(versions.length, 2);
    assert.ok(versions.every(url => /\?v=[0-9a-f]+$/.test(url)));
    assert.ok(await page.$eval('[data-mastermind] a[href*="masatermind.html"]', el => el.pathname === '/2026/09/06/masatermind.html'));

    // Native keyboard scoring controls, with text/number labels independent of color.
    await page.focus(p('learn-exact'));
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.match(await text('learn-result'), /^Correct.*2 exact, 0 misplaced/);
    await select('exercise', 'mixed');
    await select('learn-exact', 1); await select('learn-misplaced', 2);
    await page.$eval(p('learn-form'), form => form.requestSubmit());
    assert.match(await text('learn-result'), /^Correct.*1 exact, 2 misplaced/);
    const unnamed = await page.$$eval('[data-mastermind] input, [data-mastermind] select, [data-mastermind] button', els => els.filter(el => {
      if (el.tagName === 'BUTTON') return !el.textContent.trim() && !el.getAttribute('aria-label');
      return !el.labels?.length && !el.getAttribute('aria-label');
    }).map(el => el.outerHTML));
    assert.deepEqual(unnamed, []);

    const layouts = [];
    for (const width of [320, 390, 768, 1280]) for (const mode of ['light', 'dark']) {
      await page.setViewport({ width, height: 900 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, mode);
      await page.focus(p('exercise'));
      const metrics = await page.$eval('[data-mastermind]', el => ({
        width: el.clientWidth, scroll: el.scrollWidth, bg: getComputedStyle(el).backgroundColor,
        focus: getComputedStyle(document.activeElement).outlineStyle,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      }));
      assert.ok(metrics.scroll <= metrics.width + 1, `game overflow ${route} ${width}: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.pageOverflow, 0, `page overflow ${route} ${width}`);
      assert.equal(metrics.focus, 'solid');
      assert.equal(metrics.bg, mode === 'light' ? 'rgb(255, 250, 240)' : 'rgb(24, 33, 45)');
      layouts.push({ width, mode, ...metrics });
      await page.screenshot({ path: path.join(out, 'screenshots', `${route.includes('2026') ? 'article' : 'standalone'}-${width}-${mode}.png`), fullPage: true });
    }
    await page.setViewport({ width: 1280, height: 900 });
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    assert.ok(await page.$$eval(`${p('learn-guess')} .mst-peg`, els => els.every(el => /[1-6] (Red|Blue|Green|Yellow|Purple|Orange)/.test(el.textContent))));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // Delay dependency loading after mount: the worker must receive a request
    // posted before its asynchronous policy import has finished.
    delayPolicyImport = true;
    // Locked human secret, illegal feedback, whole-reply allowance, false wins.
    await start(); await pending();
    delayPolicyImport = false;
    assert.equal(await page.$eval(p('setup'), el => el.disabled), true);
    assert.equal(await rows(), 1);
    const fixedRow = await text('history');
    await select('exact', 0); await select('misplaced', 1); await click('reply');
    assert.match(await text('error'), /not attainable/);
    assert.equal(await text('history'), fixedRow);
    for (let i = 0; i < 2; i++) {
      await select('exact', 4); await select('misplaced', 0); await click('reply');
      assert.doesNotMatch(await text('status'), /Found the code/);
      await click('next'); await settled(); await pending();
    }
    assert.match(await text('truth'), /remaining: 0/);
    const spentRows = await text('history');
    await select('exact', 4); await select('misplaced', 0); await click('reply');
    assert.match(await text('error'), /No false replies remain/);
    assert.equal(await text('history'), spentRows);
    assert.equal(await saveText(), null, 'no automatic persistence');

    // Save while a guess is issued but unanswered; reload must not create a guess.
    await showSaves(); await click('save-local');
    const saved = await saveText();
    const savedObject = JSON.parse(saved);
    assert.equal(savedObject.state.solver.phase, 'awaiting-reply');
    await goto();
    assert.equal(await rows(), 0);
    await showSaves(); await click('restore-local');
    await page.waitForFunction(() => document.querySelector('[data-part="storage-status"]').textContent.startsWith('Session restored'));
    assert.equal(await text('history'), spentRows);
    assert.equal(await page.evaluate(() => window.__mmTestWorkers.messages.length), savedObject.actions.filter(a => a.type === 'guess').length,
      'restore validates existing guesses but does not issue another guess');
    await click('save-local');
    assert.deepEqual(JSON.parse(await saveText()), savedObject);

    // Explicit file download and restore; no network transmission of the save.
    const downloadDir = path.join(out, 'downloads', route.includes('2026') ? 'article' : 'standalone');
    await fs.mkdir(downloadDir, { recursive: true });
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    await click('download');
    const downloadFile = path.join(downloadDir, 'mastermind-session.json');
    for (let i = 0; i < 100; i++) {
      try { await fs.access(downloadFile); break; } catch { await wait(50); }
    }
    assert.deepEqual(JSON.parse(await fs.readFile(downloadFile, 'utf8')), savedObject);
    await reset(); await restoreFile(downloadFile); await pending();
    assert.equal(await text('history'), spentRows);
    await click('honest');
    assert.equal(await text('error'), '');

    // Invalid import is transactional; the active history is retained.
    await click('save-local');
    const good = JSON.parse(await saveText());
    good.state.solver.turns[0].reply.exact = 0;
    const badFile = path.join(out, 'mismatched-history.json');
    await fs.writeFile(badFile, JSON.stringify(good));
    const currentHistory = await text('history');
    await restoreFile(badFile, true);
    assert.match(await text('error'), /does not match replay/);
    assert.equal(await text('history'), currentHistory);
    const oversized = path.join(out, 'oversized-save.json');
    await fs.writeFile(oversized, 'x'.repeat(262145));
    await restoreFile(oversized, true);
    assert.match(await text('error'), /exceeds 256 KiB/);
    assert.equal(await text('history'), currentHistory);

    // Honest equality cannot be hidden: second guess is the locked 1 1 2.
    await reset(); await select('size', '3x3');
    await page.select('[data-position="1"]', '1'); await page.select('[data-position="2"]', '1'); await page.select('[data-position="3"]', '2');
    await page.$eval(p('allowance'), el => { el.value = '0'; });
    await start(); await pending(); await click('honest'); await click('next'); await settled();
    assert.match(await text('status'), /Found the code in 2 guesses/);
    assert.equal(await page.$eval(p('reply-form'), el => el.hidden), true);
    assert.match(await text('review'), /0 of 0 false replies spent/);
    assert.ok(await page.$eval(p('next'), el => el.disabled));

    // Hold actual worker responses across reset, then replay the stale callback.
    await reset(); await hold(true); await click('start'); await queued();
    assert.equal(await page.evaluate(() => window.__mmTestWorkers.active), 1);
    await reset();
    assert.equal(await page.evaluate(() => window.__mmTestWorkers.active), 0);
    await hold(false); await start(); await pending();
    const freshHistory = await text('history');
    await flush(); await wait(50);
    assert.equal(await text('history'), freshHistory);
    // Cancel must terminate in-flight work and keep the cancelled review terminal.
    await reset(); await hold(true); await click('start'); await queued(); await click('cancel');
    assert.equal(await page.evaluate(() => window.__mmTestWorkers.active), 0);
    await flush(); await wait(50);
    assert.match(await text('status'), /Cancelled after 0 guesses/);
    assert.equal(await rows(), 0);

    // Watch pause also terminates an in-flight request, without cancelling play.
    await reset(); await select('mode', 'misread'); await start();
    await hold(true); await click('play'); await queued(); await click('pause');
    assert.equal(await page.evaluate(() => window.__mmTestWorkers.active), 0);
    await flush(); await wait(900);
    assert.equal(await rows(), 0);
    assert.match(await text('status'), /Paused/);
    await click('step'); await settled();
    assert.equal(await rows(), 1);
    await click('play');
    await page.waitForFunction(() => document.querySelectorAll('[data-part="history"] > li').length >= 2);
    await click('pause');
    const paused = await text('history');
    await wait(1000);
    assert.equal(await text('history'), paused, 'no playback timer survives pause');
    await click('cancel');
    assert.match(await text('review'), /changed positions.*incorrect whole replies/);
    assert.match(await text('review'), /Temporary row/);

    // Both channels and both agreement objectives survive a save/replay with
    // byte-identical next replies. The same seed drives the referee, not a test RNG.
    for (const noiseModel of ['forced-change', 'redraw']) for (const policy of ['fields', 'replies']) {
      await reset(); await select('mode', 'misread'); await select('size', '3x3');
      for (const position of [1, 2, 3]) await page.select(`[data-position="${position}"]`, '3');
      await select('noise', noiseModel); await select('policy', policy);
      await page.$eval(p('probability'), el => { el.value = '1'; });
      await page.$eval(p('seed'), el => { el.value = '7'; });
      await start(); await click('step'); await settled();
      assert.match(await text('session-info'), new RegExp(noiseModel));
      await showSaves(); await click('save-local');
      const first = await saveText();
      const firstFile = path.join(out, `replay-${noiseModel}-${policy}.json`);
      await fs.writeFile(firstFile, first);
      await click('step'); await settled(); await click('save-local');
      const second = JSON.parse(await saveText());
      await restoreFile(firstFile);
      assert.equal(await rows(), 1);
      await click('step'); await settled(); await click('save-local');
      assert.deepEqual(JSON.parse(await saveText()), second);
      await click('cancel');
      assert.match(await text('review'), /Temporary row/);
    }
    for (const mode of ['light', 'dark']) {
      await page.setViewport({ width: 320, height: 900 });
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, mode);
      assert.ok(await page.$eval('[data-mastermind]', el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: path.join(out, 'screenshots', `${route.includes('2026') ? 'article' : 'standalone'}-review-320-${mode}.png`), fullPage: true });
    }
    await page.setViewport({ width: 1280, height: 900 });

    // Pending query 60 is preserved. Sampling it hits the cap rather than issuing 61.
    await restoreFile(capPending);
    assert.equal(await rows(), 60, `${await text('status')} | ${await text('error')}`);
    assert.match(await text('status'), /sample its reply/);
    await click('step'); await settled();
    assert.match(await text('status'), /Stopped after 60 guesses without finding the code/);
    assert.equal(await rows(), 60);
    assert.match(await text('review'), /60 sampled replies/);
    assert.ok(await page.$eval(p('play'), el => el.disabled));
    // Also compute the last query in the real worker with 59 noisy turns.
    await restoreFile(capReady);
    await click('step'); await settled();
    assert.match(await text('status'), /Stopped after 60 guesses without finding the code/);
    await click('save-local');
    const capped = JSON.parse(await saveText());
    await goto(); await showSaves(); await click('restore-local');
    await page.waitForFunction(() => document.querySelector('[data-part="status"]').textContent.startsWith('Stopped after 60'));
    await click('save-local');
    assert.deepEqual(JSON.parse(await saveText()), capped);

    // Reset cancels a long restore; its completion cannot resurrect the session.
    await click('restore-local');
    await page.waitForFunction(() => document.querySelector('[data-part="status"]').textContent.startsWith('Restoring the saved game'));
    await click('reset'); await wait(1200);
    assert.equal(await rows(), 0);
    assert.match(await text('status'), /Choose a mode/);
    // Storage failure is reported accurately, not treated as a successful save.
    await select('mode', 'bounded'); await start(); await settled();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
    await showSaves(); await click('save-local');
    assert.match(await text('storage-status'), /No browser save was written/);

    await collectWorkers();
    for (const workerStats of workerEpochs) {
      assert.ok(workerStats.maxActive <= 1);
      assert.ok(workerStats.active <= 1, 'only one worker may be retained between turns');
      for (const message of workerStats.messages) {
        assert.deepEqual(Object.keys(message).sort(), ['generation', 'policy', 'requestId', 'sessionId', 'solverView']);
        assert.doesNotMatch(JSON.stringify(message), /secret|truth|remainingBudget|spent|random|seed|annotations/);
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(localFailures, []);
    assert.ok(!requests.some(url => /z3|coi-serviceworker|\.wasm/.test(url)));
    results.push({ route, passed: true, layouts, errors, localFailures,
      requests: requests.filter(url => url.startsWith(origin)).map(url => url.replace(origin, '')),
      workerEpochs, restoreTimings });
    await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(`PASS ${route}`);
    await context.close();
  }
  await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
} catch (error) {
  const diagnostics = await activePage?.evaluate(() => ({
    status: document.querySelector('[data-part="status"]')?.textContent,
    error: document.querySelector('[data-part="error"]')?.textContent,
    storage: document.querySelector('[data-part="storage-status"]')?.textContent,
    events: window.__mmTestWorkers?.events, hold: window.__mmTestWorkers?.hold,
  })).catch(() => null);
  console.error(JSON.stringify(diagnostics));
  await fs.writeFile(path.join(out, 'browser-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  await fs.writeFile(path.join(out, 'browser-error.txt'), String(error.stack));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
