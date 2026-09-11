// Local regression checks for the restored visible navigation and homepage.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const out = path.resolve('agent_out/blog-layout-revert');
fs.mkdirSync(out, { recursive: true });
const origin = process.env.BLOG_TEST_ORIGIN || 'http://127.0.0.1:4197';
const themes = [...fs.readFileSync('_data/themes.yml', 'utf8').matchAll(/^- id: (\S+)/gm)].map(m => m[1]);
assert.equal(themes.length, 5);
const routes = ['/', '/archive.html', '/WriteUps/', '/ctf-tutorials/', '/ramblings/', '/about.html'].sort();
const article = '/2026/03/03/unfaithful-claims-breaking-6-zkvms.html';
const profiles = [['home-mobile', '/', 390, 844], ['article-desktop', article, 1440, 900]];
const jobs = themes.flatMap(skin => ['light', 'dark'].flatMap(mode => profiles.map(([name, route, width, height]) => ({ skin, mode, name, route, width, height }))));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
  env: { ...process.env, LD_LIBRARY_PATH: path.resolve('.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu') }
});
const results = [], interactions = [];
let cursor = 0;

async function open(job, js = true) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  await page.setViewport({ width: job.width, height: job.height, deviceScaleFactor: 1 });
  await page.setJavaScriptEnabled(js);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: job.mode }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    // The banner has separate probability tests; it must not cover layout controls.
    document.addEventListener('DOMContentLoaded', () => document.getElementById('cookie-banner')?.remove(), { once: true });
  });
  if (job.storageBlocked) await page.evaluateOnNewDocument(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new DOMException('Storage blocked for this test', 'SecurityError'); };
  });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin === origin || u.protocol === 'data:') r.continue(); else r.abort();
  });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => { if (r.url().startsWith(origin)) errors.push(r.url() + ': ' + r.failure()?.errorText); });
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const response = await page.goto(`${origin}${job.route}?skin=${job.skin}`, { waitUntil: 'networkidle0', timeout: 45000 });
  assert.equal(response.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

async function inspect(page, home) {
  const metrics = await page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
    };
    const publications = document.querySelector('.section-cards'), records = document.querySelector('#records');
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      header: box('.site-header'), publications: box('.section-cards'), records: box('#records'),
      publicationsFirst: publications && records ? Boolean(publications.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      links: [...document.querySelectorAll('.site-nav > a')].map(e => ({
        href: new URL(e.href).pathname,
        visible: e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        inClosedDisclosure: Boolean(e.closest('details:not([open])'))
      })),
      collapsedNav: Boolean(document.querySelector('.nav-menu, .primary-links')),
      preview: Boolean(document.querySelector('.post-preview')),
      heroActions: Boolean(document.querySelector('.masthead__actions')),
      questions: [...document.querySelectorAll('.site-footer__mystery')].filter(e => e.checkVisibility()).length,
      themes: document.querySelectorAll('#skin-picker option').length
    };
  });
  assert.equal(metrics.overflow, 0, 'page overflow');
  assert.equal(metrics.collapsedNav, false, 'primary navigation is collapsed');
  assert.deepEqual(metrics.links.map(l => l.href).sort(), routes);
  assert.ok(metrics.links.every(l => l.visible && !l.inClosedDisclosure), 'navigation links must stay visible');
  assert.equal(metrics.questions, 3);
  assert.equal(metrics.themes, 5);
  if (home) {
    assert.equal(metrics.publicationsFirst, true);
    assert.equal(metrics.preview, false);
    assert.equal(metrics.heroActions, true);
  }
  return metrics;
}

async function matrix(job) {
  const c = await open(job);
  try {
    const metrics = await inspect(c.page, job.route === '/');
    assert.deepEqual(c.errors, []);
    if (job.skin === 'rpn-garden') await c.page.screenshot({ path: path.join(out, `${job.name}-${job.mode}.png`) });
    results.push({ ...job, ...metrics, pass: true });
  } finally { await c.context.close(); }
}

try {
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try { await matrix(job); } catch (e) { results.push({ ...job, pass: false, error: String(e) }); }
    }
  }));
  for (const [width, height, js] of [[320, 740, true], [390, 844, true], [768, 1024, true], [1440, 900, true], [390, 844, false]]) {
    const c = await open({ skin: 'rpn-garden', mode: 'light', route: '/', width, height }, js);
    try {
      const metrics = await inspect(c.page, true);
      assert.ok(metrics.publications.bottom <= metrics.records.y, 'Publications must be above Latest posts');
      // Links are available immediately; only the theme picker uses disclosure.
      await c.page.focus('.site-nav > a[data-route="home"]');
      await c.page.keyboard.press('Tab');
      assert.equal(await c.page.evaluate(() => document.activeElement.dataset.route), 'archive');
      await c.page.focus('.skin-menu > summary');
      await c.page.keyboard.press('Enter');
      assert.equal(await c.page.$eval('.skin-menu', e => e.open), true);
      if (js) {
        await c.page.select('#skin-picker', 'cryptographic-blockbuster');
        await c.page.waitForNetworkIdle({ idleTime: 200 });
        assert.equal(await c.page.evaluate(() => document.documentElement.dataset.skin), 'cryptographic-blockbuster');
        assert.equal(await c.page.$eval('.skin-menu > summary', e => e.textContent), 'Theme: Cryptographic Blockbuster');
        await c.page.select('#skin-picker', 'rpn-garden');
        await c.page.waitForNetworkIdle({ idleTime: 200 });
      }
      await c.page.focus('.skin-menu > summary');
      await c.page.keyboard.press('Enter');
      assert.equal(await c.page.$eval('.skin-menu', e => e.open), false);
      await c.page.evaluate(() => scrollTo(0, 0));
      await c.page.screenshot({ path: path.join(out, `home-${width}-${js ? 'js' : 'no-js'}.png`) });
      assert.deepEqual(c.errors, []);
      interactions.push({ width, height, js, ...metrics, pass: true });
    } finally { await c.context.close(); }
  }
  for (const storageBlocked of [false, true]) {
    const c = await open({ skin: 'rpn-garden', mode: 'light', route: '/', width: 390, height: 844, storageBlocked });
    try {
      if (storageBlocked) await c.page.keyboard.press('Escape');
      await c.page.click('.skin-menu > summary');
      await c.page.select('#skin-picker', 'cryptographic-blockbuster');
      await c.page.waitForNetworkIdle({ idleTime: 200 });
      assert.equal(await c.page.evaluate(() => document.documentElement.dataset.skin), 'cryptographic-blockbuster');
      if (!storageBlocked) {
        await c.page.goto(origin + '/', { waitUntil: 'networkidle0' });
        assert.equal(await c.page.evaluate(() => document.documentElement.dataset.skin), 'cryptographic-blockbuster');
        await c.page.goto(origin + '/?skin=rpn-garden', { waitUntil: 'networkidle0' });
        assert.equal(await c.page.evaluate(() => document.documentElement.dataset.skin), undefined);
      }
      assert.deepEqual(c.errors, []);
      interactions.push({ case: storageBlocked ? 'blocked-storage' : 'saved-and-query-skins', pass: true });
    } finally { await c.context.close(); }
  }
} finally {
  results.sort((a, b) => themes.indexOf(a.skin) - themes.indexOf(b.skin) || a.name.localeCompare(b.name) || a.mode.localeCompare(b.mode));
  fs.writeFileSync(path.join(out, 'matrix.json'), JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'interactions.json'), JSON.stringify(interactions, null, 2) + '\n');
  await browser.close();
}
const failed = results.filter(r => !r.pass);
console.log(`${results.length} matrix cases; ${failed.length} failed; ${interactions.length} interaction cases passed.`);
if (failed.length) { console.error(failed); process.exitCode = 1; }
