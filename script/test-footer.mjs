// Native, offline loader checks. Add --browser for the local Chrome theme matrix.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/js/footer.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../_includes/site-footer.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/components/site-footer.css', import.meta.url), 'utf8');

function fixture({ present = true, src = '/nested/blog/assets/js/features/toybox.js?v=test' } = {}) {
  const scripts = [], calls = [], restores = [], listeners = [];
  let legacyCalls = 0;
  const element = (data = {}) => ({
    dataset: data, disabled: true, hidden: false, textContent: '',
    closest(selector) { assert.equal(selector, 'button'); return this; },
    focus() { document.activeElement = this; },
  });
  const buttons = [0, 1, 2].map(n => element({ toySlot: String(n) }));
  const restore = element(); restore.hidden = true; restore.disabled = false;
  const status = element();
  const footer = {
    dataset: { toyboxSrc: src },
    querySelectorAll(selector) { assert.equal(selector, '.site-footer__mystery'); return buttons; },
    querySelector(selector) {
      return { '.site-footer__restore': restore, '.site-footer__status': status }[selector];
    },
    contains(target) { return [...buttons, restore].includes(target); },
    addEventListener(type, fn, capture) {
      assert.equal(type, 'click'); assert.equal(capture, true); listeners.push(fn);
    },
  };
  const document = {
    activeElement: null,
    getElementById(id) { assert.equal(id, 'site-footer'); return present ? footer : null; },
    createElement(tag) {
      assert.equal(tag, 'script');
      return { removed: false, remove() { this.removed = true; } };
    },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const events = new Map();
  const window = {
    addEventListener(type, handler) { events.set(type, handler); },
    dispatch(type) { events.get(type)?.(); },
  };
  const unexpected = () => assert.fail('Footer must not schedule timers, frames, requests or random draws');
  const context = vm.createContext({
    document, window, setTimeout: unexpected, setInterval: unexpected,
    requestAnimationFrame: unexpected, fetch: unexpected,
    Math: { random: unexpected },
  });
  const run = () => vm.runInContext(source, context);
  const click = (target) => {
    if (target.disabled) return;
    let stopped = false;
    const event = { target, stopPropagation() { stopped = true; } };
    listeners.forEach(fn => fn(event));
    // Simulate the old toybox target listeners after ancestor capture.
    if (window.__dtToy && !stopped && [...buttons, restore].includes(target)) legacyCalls++;
    return stopped;
  };
  const install = (consume = true) => {
    window.__dtToy = {
      go(slot) { calls.push(slot); restore.hidden = false; },
      restore() { restores.push(true); restore.hidden = true; },
    };
    if (consume && typeof window.__dtToyPending === 'number') {
      const slot = window.__dtToyPending;
      delete window.__dtToyPending;
      window.__dtToy.go(slot);
    }
  };
  return { run, click, install, window, document, footer, buttons, restore, status, scripts, calls, restores, listeners,
    legacyCalls: () => legacyCalls };
}

test('markup preserves all destinations, warning and ordered disabled controls', () => {
  assert.match(markup, /Are you really sure that you want to reach me\?/);
  assert.deepEqual([...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => [m[2], m[1]]), [
    ['GitHub', '{{ site.author.github }}'], ['Twitter', '{{ site.author.twitter }}'],
    ['LinkedIn', '{{ site.author.linkedin }}'], ['Discord', 'https://discord.com/users/{{ site.author.discord_id }}'],
    ['Email', 'mailto:{{ site.author.email }}'], ['Feed', "{{ '/feed.xml' | relative_url }}"],
  ]);
  assert.deepEqual([...markup.matchAll(/data-toy-slot="(\d)"[^>]*\bdisabled>\?<\/button>/g)].map(m => m[1]), ['0', '1', '2']);
  assert.match(markup, /Mystery buttons need JavaScript to load\./);
  assert.match(markup, /data-toybox-src="{{ '\/assets\/js\/features\/toybox.js' \| relative_url }}/);
  assert.match(markup, /<script defer src="{{ '\/assets\/js\/footer.js' \| relative_url }}/);
  assert.ok(markup.indexOf('<link rel="stylesheet"') < markup.indexOf('<footer'));
  assert.doesNotMatch(markup, /<script>|\bonclick=|setInterval|setTimeout|Math\.random/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /flex-wrap: wrap/);
  assert.doesNotMatch(markup, /restore-slot/);
  assert.doesNotMatch(source, /These buttons change the page/);
  assert.doesNotMatch(css, /text-decoration: underline/);
  assert.match(css, /\[hidden\]\s*\{\s*display: none !important/);
});

test('idle initialization is idempotent, enables controls and never loads toybox', () => {
  const p = fixture(); p.run(); p.run();
  assert.equal(p.scripts.length, 0);
  assert.equal(p.listeners.length, 1);
  assert.ok(p.buttons.every(b => !b.disabled));
  assert.equal(p.status.textContent, '');
  assert.equal(p.status.dataset.error, 'false');
  assert.equal(p.window.__dtToyPending, undefined);
});

test('pagehide discards a pending first press without preventing later activation', () => {
  for (const consume of [true, false]) {
    const p = fixture(); p.run(); p.click(p.buttons[0]);
    p.window.dispatch('pagehide');
    assert.equal(p.window.__dtToyPending, undefined);
    p.install(consume); p.scripts[0].onload();
    assert.deepEqual(p.calls, []);
    p.click(p.buttons[2]);
    assert.deepEqual(p.calls, [2]);
    assert.equal(p.scripts.length, 1);
  }
});

test('missing footer or URL leaves no listener or request', () => {
  for (const opts of [{ present: false }, { src: '' }]) {
    const p = fixture(opts); p.run();
    assert.equal(p.listeners.length, 0); assert.equal(p.scripts.length, 0);
    assert.ok(p.buttons.every(b => b.disabled));
  }
});

for (const consume of [true, false]) {
  test(`one lazy request, latest slot wins; toybox consumes pending: ${consume}`, () => {
    const p = fixture(); p.run();
    p.click(p.buttons[0]); p.click(p.buttons[1]); p.click(p.buttons[2]); p.run();
    assert.equal(p.scripts.length, 1);
    assert.equal(p.scripts[0].src, '/nested/blog/assets/js/features/toybox.js?v=test');
    assert.equal(p.window.__dtToyPending, 2);
    p.install(consume); p.scripts[0].onload();
    assert.deepEqual(p.calls, [2]);
    assert.equal(p.window.__dtToyPending, undefined);
    assert.equal(p.scripts[0].onload, null); assert.equal(p.scripts[0].onerror, null);
    p.click(p.buttons[0]);
    assert.deepEqual(p.calls, [2, 0]); assert.equal(p.scripts.length, 1);
    assert.equal(p.legacyCalls(), 0, 'The legacy target listener must not double-activate');
  });
}

test('a click after evaluation but before load dispatch does not replay pending', () => {
  const p = fixture(); p.run(); p.click(p.buttons[0]); p.install();
  p.click(p.buttons[2]); p.scripts[0].onload();
  assert.deepEqual(p.calls, [0, 2]); assert.equal(p.window.__dtToyPending, undefined);
});

for (const failure of ['error', 'load-without-api', 'append-throws']) {
  test(`${failure} clears pending, allows retry and ignores stale callbacks`, () => {
    const p = fixture(); p.run();
    const append = p.document.head.appendChild;
    if (failure === 'append-throws') p.document.head.appendChild = () => { throw new Error('blocked'); };
    p.click(p.buttons[0]);
    const first = p.scripts[0];
    const stale = first?.onerror;
    if (failure === 'error') first.onerror();
    if (failure === 'load-without-api') first.onload();
    assert.equal(p.window.__dtToyPending, undefined);
    assert.match(p.status.textContent, /retry/);
    if (first) assert.equal(first.removed, true);
    p.document.head.appendChild = append;
    p.click(p.buttons[1]); p.click(p.buttons[2]);
    stale?.();
    assert.equal(p.window.__dtToyPending, 2);
    p.install(); p.scripts.at(-1).onload();
    assert.deepEqual(p.calls, [2]);
    assert.equal(p.scripts.length, failure === 'append-throws' ? 1 : 2);
  });
}

test('preloaded API activates once without a script, restore returns keyboard focus', () => {
  const p = fixture(); p.run(); p.install(); p.click(p.buttons[1]);
  assert.deepEqual(p.calls, [1]); assert.equal(p.restore.hidden, false);
  p.restore.focus(); p.click(p.restore);
  assert.equal(p.restore.hidden, true); assert.equal(p.document.activeElement, p.buttons[1]);
  assert.equal(p.restores.length, 1); assert.equal(p.legacyCalls(), 0);
  assert.equal(p.scripts.length, 0);
});

test('social links are not intercepted; malformed slot cannot load a script', () => {
  const p = fixture(); p.run();
  assert.equal(p.click({ closest() { return null; } }), false);
  p.buttons[0].dataset.toySlot = '99'; p.click(p.buttons[0]);
  assert.equal(p.scripts.length, 0); assert.equal(p.window.__dtToyPending, undefined);
});

test('toy API exceptions give recovery text rather than another script request', () => {
  const p = fixture(); p.run(); p.install();
  p.window.__dtToy.go = () => { throw new Error('effect failed'); };
  p.click(p.buttons[0]); assert.match(p.status.textContent, /could not start/);
  assert.equal(p.status.dataset.error, 'true');
  p.restore.hidden = false;
  p.window.__dtToy.restore = () => { throw new Error('restore failed'); };
  p.click(p.restore); assert.match(p.status.textContent, /Reload/);
  assert.equal(p.scripts.length, 0);
});

if (process.argv.includes('--browser')) {
  test('offline Chrome: footer theme, mobile, focus, no-JS and restore geometry matrix', async () => {
    const { default: puppeteer } = await import('../.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js');
    const out = path.resolve(process.env.BLOG_FOOTER_OUT || 'agent_out/footer-theme-repair/browser');
    assert.ok(out.startsWith(path.resolve('agent_out') + path.sep));
    mkdirSync(out, { recursive: true });
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'],
      env: { ...process.env, LD_LIBRARY_PATH: process.env.BLOG_CHROME_LIBS || ['agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu', 'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu', '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'].map(p => path.resolve(p)).join(':') },
    });
    const results = [];
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', request => {
        // Fulfill public assets from disk. No request is continued to the network.
        try {
          const url = new URL(request.url());
          const file = realpathSync(path.resolve('.' + decodeURIComponent(url.pathname)));
          if (url.origin === 'https://footer.test' && file.startsWith(path.resolve('assets') + path.sep)) {
            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(file) });
          } else request.abort();
        } catch (_) { request.abort(); }
      });
      // A supplied generated page adds real header/article context to screenshots.
      // The default fixture is standalone; it needs no ignored historical build.
      const base = process.env.BLOG_FOOTER_PAGE
        ? readFileSync(process.env.BLOG_FOOTER_PAGE, 'utf8')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<link\b[^>]*>/gi, '')
          .replace(/<footer\b[^>]*class="site-footer"[^>]*>[\s\S]*?<\/footer>/, 'FOOTER_FIXTURE')
        : '<!doctype html><html><head></head><body>FOOTER_FIXTURE</body></html>';
      assert.ok(base.includes('FOOTER_FIXTURE'));
      const axeSource = readFileSync('.toolchain/verify/lighthouse-node_modules/axe-core/axe.min.js', 'utf8');
      // Embedded CSS needs the same font base as /assets/css/main.css.
      const main = readFileSync('assets/css/main.css', 'utf8').replaceAll('../fonts/', '/assets/fonts/');
      const remediation = readFileSync('assets/css/theme-remediation.css', 'utf8');
      const footerHTML = markup.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        .replace(/{{ '([^']+)' \| relative_url }}/g, (_, url) => url)
        .replace(/{{[^}]+}}/g, 'fixture');
      const skins = [null, ...readdirSync('assets/css/skins').filter(n => n.endsWith('.css')).sort()];
      assert.equal(skins.length, 48);
      for (const file of skins) {
        const skinCSS = file ? readFileSync(path.join('assets/css/skins', file), 'utf8') : '';
        const skin = file ? skinCSS.match(/html\[data-skin="([^"]+)"\]/)?.[1] : 'rpn-garden';
        assert.ok(skin, file);
        for (const mode of ['light', 'dark']) {
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewport({ width, height: 900 });
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
            const html = base.replace(/<html\b[^>]*>/, `<html data-skin="${skin}" data-theme="${mode}">`)
              .replace('<head>', `<head><base href="https://footer.test/"><style>${main}\n${skinCSS}\n${remediation}</style>`)
              .replace('FOOTER_FIXTURE', `<style>${css}</style>${footerHTML}`);
            await page.setContent(html, { waitUntil: 'load' });
            await page.evaluate(() => document.fonts.ready);
            // font-display: optional may retain a cold fallback. Review the
            // warm selected-theme faces as well as the separate cold-page tests.
            await page.setContent(html, { waitUntil: 'load' });
            await page.evaluate(() => document.fonts.ready);
            const fontErrors = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'error').map(f => f.family));
            assert.deepEqual(fontErrors, [], 'Local fixture fonts must load');
            const inspect = () => page.evaluate(() => {
              const footer = document.getElementById('site-footer');
              const controls = [...footer.querySelectorAll('a, button')].filter(el => !el.hidden);
              const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; };
              const luminance = color => {
                const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => {
                  n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
                });
                return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
              };
              const style = getComputedStyle(footer);
              const bg = luminance(style.backgroundColor), fg = luminance(style.color);
              return {
                footer: rect(footer), controls: controls.map(rect),
                slots: [...footer.querySelectorAll('[data-toy-slot]')].map(el => ({ slot: el.dataset.toySlot, ...rect(el), disabled: el.disabled })),
                contrast: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05),
                animations: footer.getAnimations({ subtree: true }).length,
                innerOverflow: footer.scrollWidth - footer.clientWidth,
              };
            });
            const before = await inspect();
            const issues = [];
            if (before.footer.x < -1 || before.footer.x + before.footer.w > width + 1 || before.innerOverflow > 1) issues.push('footer clipping');
            if (before.controls.some(r => r.w < 43.9 || r.h < 43.9 || r.x < -1 || r.x + r.w > width + 1)) issues.push('control size/clipping');
            for (let i = 0; i < before.controls.length; i++) for (let j = i + 1; j < before.controls.length; j++) {
              const a = before.controls[i], b = before.controls[j];
              if (a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1) issues.push('control overlap');
            }
            // A container-color ratio cannot assess gradients or painted notes.
            await page.addScriptTag({ content: axeSource });
            const axe = await page.evaluate(async () => {
              const r = await window.axe.run(document.getElementById('site-footer'), { runOnly: ['color-contrast'] });
              return { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), incomplete: r.incomplete.length };
            });
            if (axe.violations.length) issues.push({ contrast: axe.violations });
            const appearance = await page.evaluate(() => {
              const f = document.getElementById('site-footer'), s = getComputedStyle(f);
              const a = getComputedStyle(f.querySelector('a'));
              return { paint: [s.backgroundColor, s.backgroundImage, s.borderTop, s.borderRadius, s.boxShadow, a.fontFamily, a.backgroundColor],
                underlines: [...f.querySelectorAll('a')].some(a => getComputedStyle(a).textDecorationLine !== 'none'),
                statusHidden: getComputedStyle(f.querySelector('.site-footer__status')).clipPath === 'inset(50%)',
                emptyRestoreSlot: Boolean(f.querySelector('.site-footer__restore-slot')) };
            });
            if (appearance.underlines || !appearance.statusHidden || appearance.emptyRestoreSlot) issues.push('rejected footer copy/spacing/underlines');
            if (!before.slots.every(s => s.disabled) || before.slots.map(s => s.slot).join() !== '0,1,2') issues.push('no-JS contract');
            await page.addScriptTag({ content: source });
            await page.evaluate(() => {
              const restore = document.querySelector('.site-footer__restore');
              window.__dtToy = { go() { restore.hidden = false; }, restore() { restore.hidden = true; } };
            });
            await page.focus('.site-footer__mystery');
            const ready = await inspect();
            await page.keyboard.press('Enter');
            const active = await inspect();
            const focus = await page.$eval('.site-footer__mystery', el => {
              const s = getComputedStyle(el);
              return { visible: el.matches(':focus-visible'), width: s.outlineWidth, style: s.outlineStyle };
            });
            if (!focus.visible || focus.width !== '3px' || focus.style !== 'solid') issues.push('keyboard focus');
            const positions = state => state.slots.map(s => ({
              slot: s.slot, x: s.x - state.footer.x, y: s.y - state.footer.y, w: s.w, h: s.h,
            }));
            if (JSON.stringify(positions(ready)) !== JSON.stringify(positions(active))) issues.push('question marks moved on activation');
            if (before.animations || active.animations) issues.push('footer animation');
            if (active.controls.length !== 10) issues.push('restore missing');
            await page.focus('.site-footer__restore');
            await page.keyboard.press('Space');
            if (!await page.$eval('.site-footer__restore', el => el.hidden)) issues.push('restore failed');
            if (!await page.$eval('.site-footer__mystery', el => document.activeElement === el)) issues.push('restore focus lost');
            {
              await page.$eval('#site-footer', el => el.scrollIntoView({ behavior: 'instant', block: 'end' }));
              await page.evaluate(() => document.activeElement?.blur());
              const el = await page.$('#site-footer');
              await el.screenshot({ path: path.join(out, `${skin}-${mode}-${width}-footer.png`) });
              const header = await page.$('.site-header');
              if (header) await header.screenshot({ path: path.join(out, `${skin}-${mode}-${width}-header.png`) });
            }
            results.push({ skin, mode, width, axe, appearance, footer: before.footer, issues });
          }
        }
      }

      // Exercise the real toybox as well as the API double used for geometry.
      await page.setViewport({ width: 320, height: 900 });
      const minimal = `<html><head><base href="https://footer.test/"><style>${main}\n${css}</style></head><body>${footerHTML}</body></html>`;
      await page.setJavaScriptEnabled(false);
      await page.setContent(minimal, { waitUntil: 'load' });
      assert.equal(await page.$$eval('.site-footer__mystery:disabled', els => els.length), 3);
      assert.equal(await page.$eval('.site-footer__status', el => el.textContent), 'Mystery buttons need JavaScript to load.');
      await page.setJavaScriptEnabled(true);
      await page.evaluate(() => {
        delete window.__dtToy;
        delete window.__dtToyPending;
        Math.random = () => .99; // Identity deck: slot 1 is tilt; no leaked effect.
      });
      await page.addScriptTag({ content: source });
      await page.focus('[data-toy-slot="1"]');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.documentElement.classList.contains('tb-tilt'));
      assert.equal(await page.$eval('[data-toy-slot="1"]', el => el.getAttribute('aria-pressed')), 'true');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tb-tilt')), false, 'A later click must toggle only once');
      await page.keyboard.press('Enter');
      await page.focus('.site-footer__restore');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tb-tilt')), false);
      assert.equal(await page.$eval('[data-toy-slot="1"]', el => document.activeElement === el), true);
      assert.equal(await page.$$eval('script[src*="toybox.js"]', els => els.length), 1);
      await page.emulateMediaType('print');
      assert.equal(await page.$eval('#site-footer', el => getComputedStyle(el).display), 'none');
      await page.emulateMediaType('screen');
      const session = await page.createCDPSession();
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      await page.focus('.site-footer__links a');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), '3px');
      await session.detach();
    } finally {
      writeFileSync(path.join(out, 'browser-matrix.json'), JSON.stringify(results, null, 2) + '\n');
      await browser.close();
    }
    assert.equal(results.length, 384);
    for (const mode of ['light', 'dark']) {
      const paints = results.filter(r => r.mode === mode && r.width === 1440).map(r => JSON.stringify(r.appearance.paint));
      assert.equal(new Set(paints).size, 48, 'Theme paint must not collapse into a uniform footer');
    }
    assert.deepEqual(results.filter(r => r.issues.length), []);
  });
}
