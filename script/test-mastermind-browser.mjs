// Real two-role browser tests against a private Jekyll build. No external
// requests are allowed. A loopback-only proxy is a backstop for worker traffic.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createGame } from '../assets/js/mastermind/game.mjs';
import { score } from '../assets/js/mastermind/core.mjs';

const out = path.resolve(process.env.MASTERMIND_TEST_OUT || 'agent_out/mastermind-game/frontend/browser');
const site = path.resolve(process.env.MASTERMIND_TEST_SITE || 'agent_out/mastermind-game/frontend/site');
const override = process.env.MASTERMIND_TEST_OVERRIDE === '1';
const scopedAsset = /^\/assets\/(?:css\/mastermind\.css|js\/mastermind\/(?:board|game|core|opponent|opponent-worker)\.mjs)$/;
await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
let delayOpponent = false;
const blockedProxy = [];
const server = http.createServer(async (req, res) => {
  try {
    // An absolute-form request is external proxy traffic, never a local asset.
    if (/^https?:/i.test(req.url)) { blockedProxy.push(new URL(req.url).hostname); res.writeHead(403); res.end(); return; }
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(site, `.${name}`);
    if (!file.startsWith(`${site}/`)) throw new Error('Path outside site');
    const data = await fs.readFile(override && scopedAsset.test(name) ? path.resolve(`.${name}`) : file);
    if (delayOpponent && name.endsWith('/mastermind/opponent.mjs')) await new Promise(resolve => setTimeout(resolve, 250));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('connect', (req, socket) => { blockedProxy.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run', `--proxy-server=${origin}`],
  // Source browser-runtime/env.sh before invoking this test. Retain its restored
  // libraries and the caller's existing search path, rather than overwriting it.
  env: { ...process.env, LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu')].filter(Boolean).join(':') },
});
const p = name => `[data-mastermind] [data-part="${name}"]`;
const root = '[data-mastermind]';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = { role: 'breaker', positions: 4, colors: 6, probability: .1, cap: 1, limit: 16, seed: 7 };
const expected = createGame(config);
expected.giveUp();
const breakerSecret = expected.view().secret;
const results = [];
let activePage;
try {
  for (const route of ['/mastermind/', '/2026/09/06/masatermind.html']) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    activePage = page;
    const errors = [], localFailures = [], blocked = [], tests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) localFailures.push(response.url().replace(origin, '')); });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) request.continue();
      else { blocked.push(url.hostname); request.abort(); }
    });
    await page.evaluateOnNewDocument(() => {
      // Banner probability has its own tests. Keep game focus checks independent
      // of that draw without changing the page's random-number generator.
      document.addEventListener('DOMContentLoaded', () => document.getElementById('cookie-banner')?.remove(), { once: true });
      localStorage.setItem('mastermind-reference-v1', 'untouched legacy save');
      // Only the round and independent opponent seeds are deterministic. Game
      // scoring and native worker choices run unmodified from production files.
      const nativeRandom = crypto.getRandomValues.bind(crypto);
      let calls = 0;
      crypto.getRandomValues = array => {
        if (array instanceof Uint32Array && array.length === 1) { array[0] = calls++ % 2 ? 23 : 7; return array; }
        return nativeRandom(array);
      };
      const NativeWorker = window.Worker;
      const state = { active: 0, maxActive: 0, terminated: 0, hold: false, queued: [], messages: [], callbacks: [], results: [] };
      window.__mmWorkers = state;
      window.Worker = class {
        constructor(url, options) {
          this.native = new NativeWorker(url, options);
          this.dead = false;
          state.active++;
          state.maxActive = Math.max(state.maxActive, state.active);
          this.native.onmessage = event => {
            state.results.push(structuredClone(event.data));
            const callback = this.onmessage;
            const onerror = this.onerror, onmessageerror = this.onmessageerror;
            state.callbacks.push({ callback, onerror, onmessageerror, event });
            if (state.hold) state.queued.push(() => callback?.(event)); else callback?.(event);
          };
          this.native.onerror = event => this.onerror?.(event);
          this.native.onmessageerror = event => this.onmessageerror?.(event);
        }
        postMessage(message) { state.messages.push(structuredClone(message)); this.native.postMessage(message); }
        terminate() {
          if (this.dead) throw new Error('Worker terminated twice');
          this.dead = true;
          state.active--;
          state.terminated++;
          this.native.terminate();
        }
      };
    });
    await page.setViewport({ width: 1280, height: 1000 });
    const response = await page.goto(origin + route, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200);
    await page.waitForSelector(`${root}[data-mounted="true"]`);
    const text = name => page.$eval(p(name), el => el.textContent);
    const click = name => page.click(p(name));
    const phase = () => page.$eval(root, el => el.dataset.phase);
    const rows = () => page.$$eval(`${p('history')} > li`, els => els.length);
    const slots = () => page.$$eval(`${p('editor')} button`, els => els.map(el => Number(el.textContent) || null));
    const active = () => page.evaluate(() => window.__mmWorkers.active);
    const ready = () => page.waitForFunction(() => ['reply', 'over'].includes(document.querySelector('[data-mastermind]').dataset.phase), { timeout: 30000 });
    const typeCode = async code => {
      await page.focus(`${p('editor')} button`);
      await page.keyboard.type(code.join(''));
    };
    const settings = async values => {
      await page.$eval(p('settings'), el => { el.open = true; });
      for (const [key, value] of Object.entries(values)) await page.$eval(p(key), (el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await page.$eval(p('settings-form'), el => el.requestSubmit());
    };
    const reset = async () => { await click('reset'); assert.equal(await rows(), 0); };
    const capture = async (name, target = root) => {
      await page.$eval(target, el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, 'screenshots', `${route.includes('2026') ? 'article' : 'standalone'}-${name}.png`), captureBeyondViewport: false });
    };
    const hold = value => page.evaluate(value => { window.__mmWorkers.hold = value; }, value);
    const queued = () => page.waitForFunction(() => window.__mmWorkers.queued.length > 0, { timeout: 30000 });
    const flush = () => page.evaluate(() => {
      window.__mmWorkers.hold = false;
      window.__mmWorkers.queued.splice(0).forEach(callback => callback());
    });

    assert.equal(await phase(), 'guess');
    assert.equal(await active(), 0);
    assert.match(await text('rule'), /10%/);
    assert.equal(await page.$$eval(`${root} details[open]`, els => els.length), 0);
    assert.equal(await page.$$eval('#mastermind-game', els => els.length), 1);
    assert.equal(await page.$$eval('#mst-play', els => els.length), 1);
    await page.click(`${root} a[href="#mst-play"]`);
    assert.equal(await page.evaluate(() => location.hash), '#mst-play');
    assert.equal(await page.$eval('#mst-play', el => el.tagName), 'SECTION');
    const unnamed = await page.$$eval(`${root} button, ${root} input, ${root} select`, els => els.filter(el =>
      el.tagName === 'BUTTON' ? !el.textContent.trim() && !el.getAttribute('aria-label') : !el.labels?.length && !el.getAttribute('aria-label'))
      .map(el => el.outerHTML));
    assert.deepEqual(unnamed, []);
    assert.equal(await page.$$eval('script[src*="mastermind/ui.mjs"]', els => els.length), 0);
    assert.equal(await page.$$eval('script[src*="mastermind/board.mjs"]', els => els.length), 1);
    const versions = await page.$$eval('link[href*="mastermind.css"], script[src*="mastermind/board.mjs"]', els => els.map(el => el.href || el.src));
    assert.ok(versions.every(url => /\?v=[0-9a-f]+$/.test(url)));
    assert.equal(await text('secret'), '????');
    assert.equal(await page.$eval(p('review'), el => el.hidden), true);
    assert.equal(await page.$eval(p('submit'), el => el.disabled), true);
    await capture('breaker-ready-desktop');
    tests.push('Ready on load, closed help/settings, hidden secret, new imports');

    // Actual keyboard play: incomplete Enter, digits, arrows, Backspace and Tab.
    await page.focus(`${p('editor')} button`);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.position), '2');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.position), '1');
    await page.keyboard.press('Enter');
    assert.match(await text('error'), /Fill every/);
    await page.keyboard.type('12');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    assert.deepEqual((await slots()).slice(0, 2), [1, 3]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Backspace');
    assert.deepEqual((await slots()).slice(0, 2), [1, null]);
    await click('clear');
    const wrong = breakerSecret.map(value => value % 6 + 1);
    await typeCode(wrong);
    await page.keyboard.press('Enter');
    assert.equal(await rows(), 1);
    assert.equal(await phase(), 'guess');
    assert.equal(await text('secret'), '????');
    await typeCode(wrong); await page.keyboard.press('Enter');
    assert.equal(await rows(), 2, 'repeated guesses are legal');
    await typeCode(breakerSecret); await page.keyboard.press('Enter');
    assert.equal(await phase(), 'over');
    assert.match(await text('end-title'), /Code cracked/);
    assert.equal(await text('secret'), breakerSecret.join(''));
    assert.equal(await page.$eval(p('ending'), el => el === document.activeElement), true);
    assert.match(await text('review-rows'), /true score/);
    assert.doesNotMatch(await text('review-rows'), /undefined/);
    await capture('breaker-win', p('secret-rack'));
    tests.push('Keyboard editing, incomplete-row guard, repeats, actual-match win, secret reveal and review');

    // Six wrong guesses hit the limit; equality remains the only win with p=1.
    await settings({ limit: 6, probability: 1 });
    for (let i = 0; i < 6; i++) { await typeCode(wrong); await page.keyboard.press('Enter'); }
    assert.equal(await phase(), 'over');
    assert.match(await text('end-title'), /Out of guesses/);
    assert.equal(await rows(), 6);
    await capture('breaker-loss', p('ending'));
    await reset(); await typeCode(breakerSecret); await page.keyboard.press('Enter');
    assert.match(await text('end-title'), /Code cracked/);
    tests.push('Round limit and equality before p=1 mutation');

    // With two colors and p=1 the temporary row is the forced complement.
    await settings({ positions: 3, colors: 2, probability: 1, limit: 6 });
    const tiny = createGame({ ...config, positions: 3, colors: 2, probability: 1, limit: 6 });
    tiny.giveUp();
    const tinySecret = tiny.view().secret;
    await typeCode(tinySecret.map(value => 3 - value)); await page.keyboard.press('Enter');
    assert.equal(await phase(), 'guess');
    assert.match(await text('history'), /3 exact, 0 misplaced/);
    assert.match(await text('status'), /All-exact clue, but not the fixed code/);
    assert.equal(await text('secret'), '???');
    await typeCode(tinySecret); await page.keyboard.press('Enter');
    assert.equal(await phase(), 'over');
    tests.push('False-perfect clues do not win; only fixed-secret equality wins');

    await settings({ positions: 4, colors: 6, probability: .1, limit: 16, cap: 1 });
    await click('liar');
    assert.equal(await phase(), 'setup');
    assert.equal(await active(), 0);
    assert.equal(await page.$eval(p('giveup'), el => el.disabled), true);
    const secret = [6, 6, 6, 6];
    await typeCode(secret);
    delayOpponent = true;
    await page.keyboard.press('Enter');
    await ready(); delayOpponent = false;
    assert.equal(await phase(), 'reply');
    assert.equal(await active(), 0, 'worker terminates after delivering one guess');
    assert.equal(await text('secret'), '6666');
    assert.deepEqual(await slots(), secret);
    assert.match(await text('edit-count'), /0 \/ 1/);
    await page.focus(`${p('editor')} button`); await page.keyboard.type('1');
    assert.match(await text('edit-count'), /1 \/ 1/);
    const draftBefore = await slots();
    await page.keyboard.type('2');
    assert.match(await text('error'), /Only 1 position/);
    assert.deepEqual(await slots(), draftBefore, 'cap rejection leaves the row unchanged');
    assert.equal(await text('secret'), '6666', 'temporary edits never change the fixed secret');
    const firstGuess = await page.$$eval(`${p('history')} li:first-child .mst-peg`, els => els.map(el => Number(el.textContent)));
    const reported = score(draftBefore, firstGuess, { positions: 4, colors: 6 });
    assert.match(await text('preview'), new RegExp(`${reported.exact} exact, ${reported.misplaced} misplaced`));
    await capture('liar-temporary-desktop', p('secret-rack'));
    await click('submit'); await ready();
    assert.equal(await phase(), 'reply');
    assert.equal(await rows(), 2, 'computer automatically advances');
    assert.deepEqual(await slots(), secret);
    assert.match(await text('edit-count'), /0 \/ 1/);
    // Spend this turn's cap on a different position. No cumulative allowance.
    await page.focus(`${p('editor')} button:nth-child(2)`); await page.keyboard.type('2');
    assert.match(await text('edit-count'), /1 \/ 1/);
    await click('submit'); await ready();
    assert.equal(await text('error'), '');
    assert.ok(await rows() >= 3);
    await click('giveup');
    assert.equal(await phase(), 'over');
    assert.match(await text('review-rows'), /1 changed position/);
    assert.doesNotMatch(await text('review-rows'), /undefined/);
    tests.push('Liar lock, real temporary edits, automatic duplicate-aware clues, per-turn cap reset, auto-advance');

    // Small honest domain finishes naturally with real workers, not injected choices.
    await settings({ positions: 3, colors: 2, cap: 0, limit: 16 });
    await typeCode([2, 2, 2]); await page.keyboard.press('Enter'); await ready();
    for (let i = 0; i < 8 && await phase() === 'reply'; i++) { await click('submit'); await ready(); }
    assert.equal(await phase(), 'over');
    assert.match(await text('end-title'), /computer cracked/);
    assert.ok(await rows() <= 8);
    await capture('liar-loss', p('ending'));
    tests.push('Native opponent solves honest small domain; computer-match ending');

    // Liar win at the gameplay limit. Information-free cap lets the player send
    // the same temporary row every turn; secret chosen outside this short search.
    await settings({ positions: 4, colors: 6, cap: 4, limit: 6 });
    await typeCode(secret); await page.keyboard.press('Enter'); await ready();
    for (let i = 0; i < 6 && await phase() === 'reply'; i++) {
      await typeCode([1, 1, 1, 1]); await page.keyboard.press('Enter');
      if (await phase() !== 'over') await ready();
    }
    assert.equal(await phase(), 'over');
    assert.match(await text('end-title'), /You kept the secret/);
    assert.equal(await rows(), 6);
    await capture('liar-win', p('ending'));
    tests.push('Liar survives limit, including final pending reply');

    // Native replies are held, then their captured callbacks are deliberately
    // replayed after termination. Also test wrong IDs on the live callback.
    await settings({ positions: 4, colors: 6, cap: 1, limit: 16 });
    for (const action of ['reset', 'breaker', 'giveup', 'settings']) {
      if (await page.$eval(root, el => el.dataset.role) !== 'liar') await click('liar');
      else await reset();
      await hold(true); await typeCode(secret); await page.keyboard.press('Enter'); await queued();
      assert.equal(await active(), 1);
      await page.evaluate(() => {
        const last = window.__mmWorkers.callbacks.at(-1);
        last.callback({ data: { ...last.event.data, generation: last.event.data.generation + 100 } });
        last.callback({ data: { ...last.event.data, requestId: last.event.data.requestId + 100 } });
      });
      assert.equal(await phase(), 'ready');
      assert.equal(await rows(), 0);
      if (action === 'settings') await settings({ limit: 12 }); else await click(action);
      assert.equal(await active(), 0);
      const snapshot = await page.$eval(root, el => el.textContent);
      await flush();
      await page.evaluate(() => {
        for (const saved of window.__mmWorkers.callbacks) {
          saved.callback?.(saved.event);
          saved.onerror?.({ preventDefault() {} });
          saved.onmessageerror?.({});
        }
      });
      await wait(50);
      assert.equal(await page.$eval(root, el => el.textContent), snapshot, `${action}: stale callback changed the board`);
      assert.equal(await active(), 0);
    }
    // A previous worker cannot terminate or answer a new in-flight worker.
    await reset(); await hold(true); await typeCode(secret); await page.keyboard.press('Enter'); await queued();
    await page.evaluate(() => { window.__stale = window.__mmWorkers.callbacks.at(-1); window.__mmWorkers.queued.length = 0; });
    await reset(); await typeCode(secret); await page.keyboard.press('Enter'); await queued();
    await page.evaluate(() => {
      window.__stale.callback(window.__stale.event);
      window.__stale.onerror({ preventDefault() {} });
      window.__stale.onmessageerror({});
    });
    assert.equal(await active(), 1);
    assert.equal(await phase(), 'ready');
    assert.equal(await rows(), 0);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('.mst-pulse', el => getComputedStyle(el).animationName), 'none');
    await flush(); await ready();
    assert.equal(await rows(), 1);
    assert.equal(await active(), 0);
    tests.push('Native worker load delay, one worker maximum, termination on reset/role/give-up/settings, stale replies/errors during a new request, correlation IDs');

    // Genuine worker load failure, followed by a retry against the same state.
    await reset();
    const workerURL = await page.$eval(root, el => el.dataset.workerUrl);
    await page.$eval(root, el => { el.dataset.workerUrl = '/intentional-missing-worker.mjs'; });
    await typeCode(secret); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-part="retry"]').hidden);
    assert.equal(await phase(), 'ready');
    assert.equal(await active(), 0);
    await page.$eval(root, (el, url) => { el.dataset.workerUrl = url; }, workerURL);
    await click('retry'); await ready();
    assert.equal(await phase(), 'reply');
    assert.equal(await text('error'), '');
    tests.push('Worker load failure and explicit retry without losing the locked secret');
    // Inspect narrow end states and the optional review, not only opening boards.
    await page.setViewport({ width: 320, height: 1000 });
    await page.focus(p('giveup')); await page.keyboard.press('Enter');
    assertLayout(await measure(page), `${route} mobile ending`);
    await capture('ended-320', p('ending'));
    await page.$eval(p('review'), el => { el.open = true; });
    await capture('review-320', p('review'));
    await page.setViewport({ width: 1280, height: 1000 });

    const layouts = [];
    await click('giveup'); await click('breaker');
    await settings({ positions: 8, colors: 6, cap: 1, limit: 16 });
    assert.equal(await phase(), 'guess');
    await click('liar');
    assert.match(await text('error'), /32,768/);
    assert.equal(await page.$eval(root, el => el.dataset.role), 'breaker');
    await click('reset');
    await typeCode([1, 2, 3, 4, 5, 6, 1, 2]); await page.keyboard.press('Enter');
    assert.equal(await rows(), 1);
    assert.equal(await page.$$eval(`${p('editor')} button`, els => els.length), 8);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewport({ width, height: 1000 });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.focus(`${p('editor')} button`);
      const metrics = await measure(page);
      assertLayout(metrics, `${route} ${width}`);
      layouts.push({ width, ...metrics });
      await capture(`eight-pegs-${width}`);
      if (width === 320) await capture('eight-pegs-320-editor', p('editor-panel'));
    }
    await page.setViewport({ width: 320, height: 1000 });
    const touch = await page.createCDPSession();
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.tap(`${p('editor')} button:first-child`);
    await page.tap(`${p('palette')} [data-color="5"]`);
    assert.equal((await slots())[0], 5, 'touch palette places the selected peg');
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touch.detach();
    tests.push('Eight-peg history and active editor at 320/390/768/1280, 44px controls, actual touch placement, no overflow');

    await settings({ positions: 8, colors: 2, cap: 1 });
    await click('liar'); await typeCode(Array(8).fill(2)); await page.keyboard.press('Enter'); await ready();
    assert.equal(await phase(), 'reply');
    await page.setViewport({ width: 320, height: 1000 });
    assertLayout(await measure(page), `${route} eight-peg liar`);
    await capture('liar-eight-pegs-320', p('secret-rack'));
    await click('giveup'); await click('breaker');
    await settings({ positions: 4, colors: 6, probability: .1, cap: 1, limit: 16 });
    const skins = await page.$$eval('#skin-picker option', els => els.map(el => el.value));
    const representative = [...new Set([skins[0], 'grid-meltdown', 'proof-bonbons', 'the-descent', 'twin-blades'])].filter(value => skins.includes(value));
    assert.ok(representative.length >= 4);
    const themes = [];
    const selectedSkins = process.env.MASTERMIND_TEST_ALL_SKINS === '1' ? skins : representative;
    for (const skin of selectedSkins) {
      await page.select('#skin-picker', skin);
      await page.waitForFunction(skin => {
        const link = document.querySelector('#skin-stylesheet');
        return skin === window.__deuteriumTheme.defaultSkin ? link.disabled
          : document.documentElement.dataset.skin === skin && link.sheet?.href === link.href;
      }, {}, skin);
      for (const mode of ['light', 'dark']) {
        await page.setViewport({ width: 320, height: 1000 });
        await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, mode);
        await page.focus(`${p('editor')} button`);
        const metrics = await measure(page);
        assertLayout(metrics, `${route} ${skin} ${mode}`);
        assert.equal(metrics.bg, 'rgb(21, 30, 40)');
        themes.push({ skin, mode, ...metrics });
        await capture(`theme-${skin}-${mode}-320`);
      }
    }
    tests.push(`${selectedSkins.length} real site skins in light/dark at 320px; consistent dark board`);

    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.focus(`${p('editor')} button`);
    assert.equal(await page.$eval(`${p('editor')} button`, el => getComputedStyle(el).outlineStyle), 'solid');
    const colorLabels = await page.$$eval(`${p('palette')} button`, els => els.map(el => el.getAttribute('aria-label')));
    assert.deepEqual(colorLabels, ['1 Red', '2 Blue', '3 Green', '4 Yellow', '5 Purple', '6 Orange']);
    await capture('forced-colors-320', p('editor-panel'));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    tests.push('Forced colors preserve numbers/names and focus; reduced-motion styles');

    assert.equal(await page.evaluate(() => localStorage.getItem('mastermind-reference-v1')), 'untouched legacy save');
    const workerStats = await page.evaluate(() => ({ active: window.__mmWorkers.active, maxActive: window.__mmWorkers.maxActive, terminated: window.__mmWorkers.terminated, messages: window.__mmWorkers.messages }));
    assert.equal(workerStats.active, 0);
    assert.equal(workerStats.maxActive, 1);
    assert.ok(workerStats.terminated > 12);
    for (const message of workerStats.messages) {
      assert.deepEqual(Object.keys(message).sort(), ['generation', 'requestId', 'seed', 'type', 'view']);
      assert.equal(message.seed, 23, 'separate opponent seed, not round seed 7');
      assert.deepEqual(Object.keys(message.view).sort(), ['cap', 'colors', 'positions', 'turns']);
      assert.doesNotMatch(JSON.stringify(message.view), /secret|truth|temporary|seed|random|review|ending/);
      message.view.turns.forEach(turn => assert.deepEqual(Object.keys(turn).sort(), ['guess', 'reply']));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(localFailures.filter(url => !url.includes('intentional-missing-worker')), []);
    tests.push('Public-only solver payload, independent seed, legacy storage unchanged, no page errors');
    results.push({ route, passed: true, tests, layouts, themes, workerStats, blocked: [...new Set(blocked)], errors, localFailures });
    await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(`PASS ${route}: ${tests.length} groups`);
    await context.close();
  }
  await fs.writeFile(path.join(out, 'proxy-blocks.json'), JSON.stringify([...new Set(blockedProxy)], null, 2));
} catch (error) {
  const diagnostics = await activePage?.evaluate(() => ({ phase: document.querySelector('[data-mastermind]')?.dataset.phase,
    status: document.querySelector('[data-part="status"]')?.textContent,
    error: document.querySelector('[data-part="error"]')?.textContent,
    workers: window.__mmWorkers ? { active: window.__mmWorkers.active, queued: window.__mmWorkers.queued.length, messages: window.__mmWorkers.messages, results: window.__mmWorkers.results } : null,
  })).catch(() => null);
  await activePage?.screenshot({ path: path.join(out, 'failure.png'), fullPage: false }).catch(() => {});
  await fs.writeFile(path.join(out, 'browser-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  await fs.writeFile(path.join(out, 'browser-error.txt'), String(error.stack));
  console.error(diagnostics?.phase, diagnostics?.status, diagnostics?.error);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

async function measure(page) {
  return page.$eval('[data-mastermind]', root => {
    const rect = root.getBoundingClientRect();
    const geometry = [], controls = [], lowContrast = [];
    const rgb = text => (text.match(/[\d.]+/g) || []).map(Number);
    const lum = color => color.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
      .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const background = el => {
      for (let at = el; at; at = at.parentElement) {
        const color = rgb(getComputedStyle(at).backgroundColor);
        if (color.length === 3 || color[3] === 1) return color;
      }
      return [255, 255, 255];
    };
    for (const el of root.querySelectorAll('*')) {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
      const box = el.getBoundingClientRect(), css = getComputedStyle(el);
      if (!box.width || !box.height) continue;
      const name = el.dataset.part || el.className || el.tagName;
      if (box.left < rect.left - 1 || box.right > rect.right + 1) geometry.push({ name, left: box.left, right: box.right });
      if (el.matches('.mst-color > span:last-child')) {
        if (box.height > parseFloat(css.lineHeight) + 1) geometry.push({ name, problem: 'wrapped palette name' });
      }
      if (el.matches('button, input, select, summary, a')) {
        controls.push({ name, width: box.width, height: box.height });
        if (box.height < 44 || box.width < 44) geometry.push({ name, width: box.width, height: box.height });
      }
      if ([...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) && !el.matches(':disabled, option, script, style')) {
        const a = lum(rgb(css.color)), b = lum(background(el)), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        if (ratio < 4.5) lowContrast.push({ name, ratio, text: el.textContent.trim().slice(0, 60) });
      }
    }
    const tables = [...document.querySelectorAll('.mst-table')].map(el => {
      const before = el.scrollLeft; el.scrollLeft = el.scrollWidth;
      const result = { contained: el.getBoundingClientRect().right <= innerWidth + 1, scrollable: el.scrollWidth <= el.clientWidth + 1 || el.scrollLeft > 0 };
      el.scrollLeft = before; return result;
    });
    return { pageOverflow: document.documentElement.scrollWidth - innerWidth, gameOverflow: root.scrollWidth - root.clientWidth,
      bg: getComputedStyle(root).backgroundColor, focus: getComputedStyle(document.activeElement).outlineStyle,
      geometry, controls, lowContrast, tables };
  });
}
function assertLayout(metrics, label) {
  assert.equal(metrics.pageOverflow, 0, `${label}: page overflow`);
  assert.ok(metrics.gameOverflow <= 1, `${label}: board overflow`);
  assert.deepEqual(metrics.geometry, [], `${label}: geometry`);
  assert.deepEqual(metrics.lowContrast, [], `${label}: text contrast`);
  assert.equal(metrics.focus, 'solid', `${label}: focus`);
  assert.ok(metrics.tables.every(table => table.contained && table.scrollable), `${label}: article table containment`);
}
