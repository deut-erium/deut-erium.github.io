// Cached Chromium integration tests with synthetic fixtures. Every request is
// answered from this process or aborted; no network acquisition is needed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadBrowserTools } from './render-publication-pdfs.mjs';

const out = path.resolve('agent_out/encryption-chain/engine');
await fs.mkdir(out, { recursive: true });
let tools;
try { tools = await loadBrowserTools(); } catch (error) {
  await fs.writeFile(path.join(out, 'browser-ERROR.md'), 'Cached browser tools are unavailable. Browser integration checks were not run. No download was attempted.\n');
  throw error;
}
const salt = '0123456789abcdef0123456789abcdef', a = 'flag{synthetic-browser-a}', b = 'flag{synthetic-browser-b}';
const hash = x => createHash('sha256').update(x + salt).digest('hex');
const scripts = ['chain-session', 'challenge'].map(name => `<script defer src="/assets/js/${name}.js"></script>`).join('');
const form = (id, answer) => `<form class="flag-check" data-flag-check data-sha256="${hash(answer)}" data-salt="${salt}"><label for="flag-${id}">Enter the flag</label><div class="flag-check__controls"><input id="flag-${id}" data-flag-input autocomplete="off"><button type="submit" disabled>Check flag</button></div><output></output></form>`;
const known = [{ id: 'canonical', aliases: ['a'], title: 'Synthetic A', page: '/checkers/', sha256: hash(a), salt },
  { id: 'b', aliases: [], title: '<img src=x> Synthetic B', page: '/checkers/', sha256: hash(b), salt }];
let board = await fs.readFile('scoreboard/index.html', 'utf8');
board = board.replace(/^---[\s\S]*?---\s*/, '').replace("{{ '/challenges.json' | relative_url | jsonify }}", '"/challenges.json"');
board = board.replace('<script id="scoreboard-known" type="application/json">[]</script>', `<script id="scoreboard-known" type="application/json">${JSON.stringify(known)}</script>`);
const shell = body => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic fixture</title><link rel="stylesheet" href="/assets/css/main.css">${scripts}</head><body>${body}</body></html>`;
const resources = new Map([
  ['/empty/', '<!doctype html><title>Empty fixture</title>'],
  ['/checkers/', shell('<header class="record-head"></header>' + form('a', a) + form('b', b) + '<p class="challenge-hint" hidden data-hint-for="a" data-hint="1">Synthetic used clue.</p>')],
  ['/scoreboard/', shell(board)],
  ['/challenges.json', JSON.stringify(known)],
  ['/assets/js/chain-session.js', await fs.readFile('assets/js/chain-session.js', 'utf8')],
  ['/assets/js/challenge.js', await fs.readFile('assets/js/challenge.js', 'utf8')],
  ['/assets/css/main.css', await fs.readFile('assets/css/main.css', 'utf8')],
  ['/assets/css/features/challenge.css', await fs.readFile('assets/css/features/challenge.css', 'utf8')],
]);
for (const family of ['atkinson-hyperlegible', 'silkscreen']) {
  for (const weight of [400, 700]) {
    const file = `assets/fonts/${family}/${weight}.woff2`;
    resources.set('/' + file, await fs.readFile(file));
  }
}
const ruby = process.env.RUBY || path.resolve('.toolchain/bin/ruby');
const privateAnswer = 'flag{synthetic-private-browser}';
const authored = execFileSync(ruby, ['script/new_challenge.rb', '--html'], {
  input: `private-synthetic-browser\n${privateAnswer}\nA synthetic clue|<script>bad()</script>\n`, encoding: 'utf8',
});
const privateHTML = authored.slice(authored.indexOf('<form'), authored.indexOf('\nsalted digest:')).trim();
assert.ok(privateHTML.endsWith('</p>'));
assert.ok(!privateHTML.includes(privateAnswer));
const runtime = await fs.mkdtemp(path.join(out, 'browser-runtime-'));
const previousCwd = process.cwd();
let browser;
process.chdir(runtime);
try {
  browser = await tools.puppeteer.launch({
    executablePath: tools.chrome, headless: true, pipe: true, userDataDir: path.join(runtime, 'profile'),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-domain-reliability', '--disable-breakpad', '--disable-crash-reporter', '--disable-default-apps', '--disable-quic', '--disable-extensions', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater', '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
    env: { ...process.env, LD_LIBRARY_PATH: [...tools.libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      TMPDIR: '.', XDG_CACHE_HOME: path.join(runtime, 'cache'), XDG_CONFIG_HOME: path.join(runtime, 'config') },
  });
} finally { process.chdir(previousCwd); }
const results = [], errors = [], blocked = [], requests = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === 'https://fixture.invalid' && resources.has(url.pathname)) {
      requests.push(url.pathname);
      const contentType = url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.woff2') ? 'font/woff2' : 'text/html';
      request.respond({ status: 200, contentType, body: resources.get(url.pathname) });
    } else { blocked.push(url.origin + url.pathname); request.abort(); }
  });
  page.on('pageerror', error => errors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    window.testEvents = []; window.testAudio = 0;
    for (const type of ['deuterium:solved', 'deuterium:attempt', 'deuterium:chain-session']) document.addEventListener(type, e => window.testEvents.push({ type, detail: e.detail }));
    window.AudioContext = class { constructor() { window.testAudio++; throw new Error('Audio forbidden under reduced motion'); } };
  });
  await page.goto('https://fixture.invalid/empty/');
  await page.evaluate(() => {
    localStorage.setItem('deuterium-solves', JSON.stringify({ retired: { at: '2025-01-01T00:00:00Z', flag: 'synthetic-retired-answer' } }));
    localStorage.setItem('deuterium-attempts', '{"a":8}');
    localStorage.setItem('deuterium-hints', '{"a":[1]}');
  });
  await page.goto('https://fixture.invalid/checkers/');
  await page.waitForSelector('[data-chain-session-opt-in]');
  await page.waitForFunction(() => ['/assets/css/main.css', '/assets/css/features/challenge.css'].every(path =>
    [...document.styleSheets].some(sheet => sheet.href && new URL(sheet.href).pathname === path && sheet.cssRules.length > 0)));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.$$eval('[data-chain-session-opt-in]', nodes => nodes.length), 2);
  assert.ok(await page.$$eval('[data-flag-reenter]', nodes => nodes.length === 2 && nodes.every(n => n.hidden && !n.getClientRects().length)));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-solves'))), { retired: { at: '2025-01-01T00:00:00Z', verified: false } });
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.isEnabled()), false);

  // Check actual layout, not just DOM classes: main.css styles all form inputs.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const layout = await page.$eval('.flag-check__session', node => {
      const opt = node.querySelector('input'), warning = node.querySelector('p'), clear = node.querySelector('button');
      const box = opt.getBoundingClientRect(), style = getComputedStyle(opt), text = getComputedStyle(warning), button = getComputedStyle(clear);
      return { width: box.width, height: box.height, minHeight: style.minHeight, padding: style.padding,
        warningSize: parseFloat(text.fontSize), warningLine: parseFloat(text.lineHeight), warningColor: text.color,
        formColor: getComputedStyle(node.closest('form')).color, clearHeight: clear.getBoundingClientRect().height,
        clearPadding: parseFloat(button.paddingTop), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.width >= 16 && layout.width <= 24 && layout.height >= 16 && layout.height <= 24, `${theme}: checkbox must stay small`);
    assert.equal(layout.minHeight, '0px'); assert.equal(layout.padding, '0px');
    assert.ok(layout.warningSize >= 14 && layout.warningLine >= 20);
    assert.equal(layout.warningColor, layout.formColor, 'warning uses readable ink on the form background');
    assert.ok(layout.clearHeight <= 40 && layout.clearPadding <= 6, 'clear stays compact');
    assert.equal(layout.overflow, false);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const expectSolved = async (id, ribbon) => {
    await page.waitForFunction(id => document.getElementById('flag-' + id).form.classList.contains('is-solved'), {}, id);
    const state = await page.$eval('#flag-' + id, input => {
      const f = input.form, reenter = f.querySelector('[data-flag-reenter]');
      return { value: input.value, inputVisible: !!input.getClientRects().length,
        label: getComputedStyle(f.querySelector(':scope > label')).display,
        row: getComputedStyle(f.querySelector('.flag-check__controls')).display,
        reenterVisible: !reenter.hidden && !!reenter.getClientRects().length, reenterText: reenter.textContent,
        reenterHeight: reenter.getBoundingClientRect().height, optVisible: !!f.querySelector('[data-chain-session-opt-in]').getClientRects().length,
        ribbon: f.classList.contains('is-ribbon') };
    });
    assert.equal(state.value, '', 'success must clear the hidden raw answer');
    assert.equal(state.inputVisible, false); assert.equal(state.label, 'none'); assert.equal(state.row, 'none');
    assert.equal(state.reenterVisible, true); assert.equal(state.reenterText, 'Enter answer again');
    assert.ok(state.reenterHeight <= 40); assert.equal(state.optVisible, true); assert.equal(state.ribbon, ribbon);
  };
  const reenterA = async () => {
    const before = await page.evaluate(() => ({ local: JSON.stringify(Object.entries(localStorage).sort()),
      session: JSON.stringify(Object.entries(sessionStorage).sort()), events: window.testEvents.length }));
    // Keyboard users can reach the control even while the input row is hidden.
    await page.focus('[data-chain-session-opt-in]');
    for (const selector of ['[data-chain-session-clear]', '[data-flag-reenter]']) {
      await page.keyboard.press('Tab');
      assert.equal(await page.$eval(selector, node => node === document.activeElement && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle === 'solid'), true);
    }
    await page.keyboard.press('Enter');
    const state = await page.$eval('#flag-a', input => ({ value: input.value, focused: input === document.activeElement,
      visible: !!input.getClientRects().length, label: getComputedStyle(input.form.querySelector(':scope > label')).display,
      solved: input.form.classList.contains('is-solved'), ribbon: input.form.classList.contains('is-ribbon'),
      reenterHidden: input.form.querySelector('[data-flag-reenter]').hidden,
      verdict: input.form.querySelector('.flag-check__verdict').textContent,
      correct: input.form.querySelector('output').classList.contains('is-correct') }));
    assert.deepEqual(state, { value: '', focused: true, visible: true, label: 'block', solved: false, ribbon: false, reenterHidden: true, verdict: '', correct: false });
    assert.equal(await page.$eval('[data-flag-reenter]', node => node.getClientRects().length), 0);
    assert.deepEqual(await page.evaluate(() => ({ local: JSON.stringify(Object.entries(localStorage).sort()),
      session: JSON.stringify(Object.entries(sessionStorage).sort()), events: window.testEvents.length })), before);
    assert.equal(await page.$eval('[data-hint-for="a"]', node => node.hidden), false);
    assert.equal(await page.$eval('.flag-check__hint', node => node.disabled), true);
    assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), null);
  };
  await page.evaluate(answer => {
    const input = document.getElementById('flag-a'); input.value = answer;
    input.form.requestSubmit(); input.form.requestSubmit();
  }, a);
  await expectSolved('a', true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-attempts')).a), 9);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), null);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('deuterium-chain-session')), null);
  assert.equal(await page.evaluate(() => window.testAudio), 0);
  assert.equal(await page.evaluate(() => window.testEvents.filter(e => e.type === 'deuterium:solved').length), 1);
  const originalReceipt = await page.evaluate(() => localStorage.getItem('deuterium-solves'));
  await page.click('[data-chain-session-opt-in]');
  assert.ok(await page.$$eval('[data-chain-session-opt-in]', nodes => nodes.every(n => n.checked)));
  await reenterA();
  await page.type('#flag-a', 'flag{synthetic-wrong}'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.flag-check__verdict').classList.contains('is-again'));
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), null);
  assert.equal(await page.$eval('[data-flag-reenter]', node => node.hidden), true);
  await page.focus('#flag-a');
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type('#flag-a', '  ' + a + '  ');
  assert.equal(await page.$eval('#flag-a', input => input.value), '  ' + a + '  ');
  await page.keyboard.press('Enter');
  await expectSolved('a', true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-attempts')).a), 11);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), a);
  assert.equal(await page.evaluate(() => window.testEvents.filter(e => e.type === 'deuterium:solved').length), 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('deuterium-solves')), originalReceipt);
  assert.ok(!JSON.stringify(await page.evaluate(() => window.testEvents)).includes('flag{'));
  results.push('Full main.css and feature CSS: small checkbox, readable warning, compact controls, keyboard focus, default success input clearing and fresh-grade re-entry passed in a mobile viewport. Light and dark control styles checked.');

  await page.click('[data-chain-session-clear]');
  await page.reload();
  await expectSolved('a', false);
  assert.equal(await page.evaluate(() => window.testEvents.length), 0, 'restoring the receipt emits no grading events');
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.isEnabled()), false);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), null);
  await page.click('[data-chain-session-opt-in]');
  await reenterA();
  await page.type('#flag-a', a); await page.keyboard.press('Enter');
  await expectSolved('a', true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-attempts')).a), 12);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), a);
  assert.equal(await page.evaluate(() => localStorage.getItem('deuterium-solves')), originalReceipt);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-hints')).a.join(',')), '1');
  assert.equal(await page.$eval('#flag-b', input => input.form.classList.contains('is-solved')), false);
  assert.equal(await page.$eval('#flag-b', input => input.form.querySelector('[data-flag-reenter]').hidden), true);
  await page.screenshot({ path: path.join(out, 'checker-reentry-mobile.png'), fullPage: true });
  results.push('Verified receipt reload keeps the answer row hidden but exposes re-entry. Keyboard re-entry preserves the receipt and spent hints, continues attempts and stores only a freshly checked answer.');

  await page.evaluate(html => {
    const container = document.createElement('section'); container.id = 'private-fixture'; container.innerHTML = html;
    document.body.appendChild(container);
    window.DeuteriumChallengeEngine.init(container); window.DeuteriumChallengeEngine.init(container); window.DeuteriumChallengeEngine.init(document);
  }, privateHTML);
  assert.equal(await page.$$eval('#private-fixture [data-chain-session-opt-in]', nodes => nodes.length), 1);
  assert.equal(await page.$$eval('#private-fixture script', nodes => nodes.length), 0);
  await page.evaluate(answer => { const input = document.getElementById('flag-private-synthetic-browser'); input.value = answer; input.form.requestSubmit(); }, privateAnswer);
  await expectSolved('private-synthetic-browser', true);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('private-synthetic-browser')), privateAnswer);
  const priorEvents = await page.evaluate(() => window.testEvents.length);
  const priorProgress = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await page.click('[data-chain-session-clear]');
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('a')), null);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.recall('private-synthetic-browser')), null);
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.isEnabled()), false);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('deuterium-chain-session')), null);
  assert.ok(await page.$$eval('[data-chain-session-opt-in]', nodes => nodes.every(n => !n.checked)));
  assert.deepEqual(await page.evaluate(start => window.testEvents.slice(start), priorEvents), [
    { type: 'deuterium:chain-session', detail: { enabled: false } },
  ]);
  assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), priorProgress);
  assert.match(await page.$eval('.flag-check__session', node => node.textContent), /relocks an unlocked encrypted article on this page/);
  for (const event of await page.evaluate(() => window.testEvents)) {
    assert.deepEqual(Object.keys(event.detail).sort(), event.type === 'deuterium:solved' ? ['at', 'id'] : event.type === 'deuterium:attempt' ? ['attempt', 'correct', 'id'] : ['enabled']);
  }
  results.push('Ruby --html form grades after dynamic insertion; repeated init adds no duplicate controls. Clear removes the tab key, turns every opt-in off, and emits only enabled=false without changing local progress.');

  await page.goto('https://fixture.invalid/scoreboard/');
  await page.waitForFunction(() => document.getElementById('scoreboard-known-count').textContent === '2');
  assert.equal(await page.evaluate(() => window.DeuteriumChainSession.isEnabled()), false, 'clear stays opted out across navigation');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('deuterium-chain-session')), null);
  assert.equal(await page.$eval('#scoreboard-solved-count', e => e.textContent), '1');
  assert.equal(await page.$$eval('#scoreboard-list img', nodes => nodes.length), 0);
  assert.equal(await page.$$eval('#scoreboard-list li', nodes => nodes.filter(n => n.textContent.includes('old local progress (not verified)')).length), 2);
  await page.click('#scoreboard-export');
  const exported = JSON.parse(await page.$eval('#scoreboard-import-box', e => e.value));
  assert.equal(exported.version, 3); assert.equal(exported.solves.a.verified, true);
  assert.ok(!JSON.stringify(exported).includes('flag{'));
  const transfer = { version: 2, solves: { b: { at: '2025-01-01T00:00:00Z', flag: b } }, attempts: { b: 3 }, hints: { b: [1] } };
  await page.$eval('#scoreboard-import-box', (e, value) => { e.value = value; }, JSON.stringify(transfer));
  await page.click('#scoreboard-import');
  await page.waitForFunction(() => document.getElementById('scoreboard-status').textContent.startsWith('Imported 1'));
  assert.equal(await page.$eval('#scoreboard-import-box', e => e.value), '');
  assert.equal(await page.$eval('#scoreboard-solved-count', e => e.textContent), '2');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('deuterium-solves')).b), { at: '2025-01-01T00:00:00Z', verified: true });
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('flag{'))), false);
  transfer.solves.b.flag = 'flag{synthetic-wrong}';
  const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await page.$eval('#scoreboard-import-box', (e, value) => { e.value = value; }, JSON.stringify(transfer));
  await page.click('#scoreboard-import');
  await page.waitForFunction(() => document.getElementById('scoreboard-status').textContent.startsWith('Import rejected.'));
  assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), before);
  await page.$eval('#scoreboard-import-box', e => { e.value = ''; });
  await page.screenshot({ path: path.join(out, 'scoreboard-mobile.png'), fullPage: true });
  results.push('Scoreboard resolves aliases, labels unknown progress, exports no answers and verifies/discards legacy imported flags. Bad imports do not write.');
  assert.deepEqual(errors, []);
  assert.ok(blocked.every(url => url === 'https://fixture.invalid/favicon.ico'), `Unexpected blocked requests: ${blocked.join(', ')}`);
  await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ results, errors, blocked, requests, puppeteer: tools.modulePath, chrome: tools.chrome }, null, 2) + '\n');
  console.log(results.join('\n'));
} finally { await browser.close(); }
