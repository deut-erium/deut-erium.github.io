#!/usr/bin/env node
// About-page browser regression. It serves only an explicitly supplied build
// through an intercepted origin and writes evidence under agent_out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from '../.toolchain/verify/lighthouse-node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const { values: opt } = parseArgs({ options: { site: { type: 'string' }, out: { type: 'string' } } });
assert.ok(opt.site && opt.out, 'Supply --site GENERATED_BUILD --out agent_out/about-layout/RUN');
const root = fs.realpathSync(opt.site);
const out = path.resolve(opt.out);
const allowed = path.resolve('agent_out/about-layout');
assert.ok(fs.existsSync(path.join(root, 'about.html')) && !fs.existsSync(path.join(root, '_config.yml')),
  'A generated site is required');
assert.ok(out === allowed || out.startsWith(allowed + path.sep), 'Output must stay under agent_out/about-layout');
let parent = out;
while (!fs.existsSync(parent)) parent = path.dirname(parent);
const resolvedParent = fs.realpathSync(parent);
assert.ok(resolvedParent === path.resolve('agent_out') || resolvedParent.startsWith(path.resolve('agent_out') + path.sep),
  'Output must not escape through a symlink');
fs.mkdirSync(out, { recursive: true });
assert.ok(!fs.existsSync(path.join(out, 'results.json')), 'Use a fresh output directory');

const themes = [...fs.readFileSync('_data/themes.yml', 'utf8').matchAll(/^- id: (\S+)/gm)].map(match => match[1]);
assert.equal(themes.length, 48);
const widths = [390, 768, 1024, 1440, 1920];
const modes = ['light', 'dark'];
const minimumProse = new Map([[390, 320], [768, 660], [1024, 880], [1440, 1060], [1920, 1120]]);
const minimumBuilder = new Map([[390, 300], [768, 600], [1024, 800], [1440, 960], [1920, 1000]]);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || path.resolve('.toolchain/verify/browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'],
  env: {
    ...process.env,
    LD_LIBRARY_PATH: process.env.BLOG_CHROME_LIBS || [
      'agent_out/mastermind-game/browser-runtime/root/usr/lib/x86_64-linux-gnu',
      'agent_out/mastermind-game/browser-runtime/root/lib/x86_64-linux-gnu',
      '.toolchain/verify/browser/sysroot/usr/lib/x86_64-linux-gnu'
    ].map(name => path.resolve(name)).join(':')
  }
});

const page = await browser.newPage();
const results = [];
await page.setRequestInterception(true);
page.on('request', request => {
  try {
    const url = new URL(request.url());
    if (url.origin !== 'https://about-layout.test' || !['GET', 'HEAD'].includes(request.method())) return request.abort();
    // This test owns CSS geometry, not PDF generation. Keep the disclosure open
    // without running the comparatively expensive resume application.
    if (url.pathname === '/assets/resume/app.mjs') {
      return request.respond({ status: 200, contentType: 'text/javascript', body: '' });
    }
    let name = path.join(root, '.' + decodeURIComponent(url.pathname));
    if (fs.statSync(name).isDirectory()) name = path.join(name, 'index.html');
    name = fs.realpathSync(name);
    if (!name.startsWith(root + path.sep)) return request.abort();
    const contentType = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp'
    }[path.extname(name)] || 'application/octet-stream';
    request.respond({ status: 200, contentType, body: fs.readFileSync(name) });
  } catch {
    request.respond({ status: 404, body: 'Not found' }).catch(() => {});
  }
});

const inspect = () => page.evaluate(() => {
  document.querySelector('#resume-details').open = true;
  const rect = selector => {
    const element = document.querySelector(selector);
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: box.x, y: box.y, right: box.right, bottom: box.bottom,
      width: box.width, height: box.height, display: style.display,
      gridColumn: style.gridColumn, gridTemplateColumns: style.gridTemplateColumns
    };
  };
  const escaped = [...document.querySelectorAll('#content *')].filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
  }).slice(0, 10).map(element => element.id || element.className || element.tagName);
  return {
    selected: document.documentElement.dataset.skin || 'rpn-garden',
    theme: document.documentElement.dataset.theme,
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    wideShell: document.querySelector('.page-shell').classList.contains('page-shell--wide'),
    wideProse: document.querySelector('.page-prose').classList.contains('page-prose--wide'),
    shell: rect('.page-shell'), heading: rect('.page-heading'), prose: rect('.page-prose'),
    intro: rect('.resume-profile > p'), details: rect('.resume-disclosure'),
    builder: rect('.resume-builder'), form: rect('#resume-form'), result: rect('#resume-result'),
    escaped
  };
});

try {
  for (const mode of modes) {
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: mode },
      { name: 'prefers-reduced-motion', value: 'reduce' }
    ]);
    for (const width of widths) {
      await page.setViewport({ width, height: 1000 });
      for (const skin of themes) {
        const issues = [];
        try {
          const response = await page.goto(`https://about-layout.test/about.html?skin=${skin}`, { waitUntil: 'load', timeout: 30000 });
          if (response.status() !== 200) issues.push(`response ${response.status()}`);
          await page.evaluate(() => document.fonts.ready);
          const value = await inspect();
          if (value.selected !== skin || value.theme !== mode) issues.push('theme selection');
          if (!value.wideShell || !value.wideProse) issues.push('wide-page hooks missing');
          if (value.scrollWidth > value.viewport + 1 || value.escaped.length) issues.push('horizontal overflow');
          if (value.heading.bottom > value.prose.y + 1) issues.push('heading overlaps prose');
          if (value.prose.x < value.shell.x - 1 || value.prose.right > value.shell.right + 1) issues.push('prose outside shell');
          if (value.prose.width < minimumProse.get(width)) issues.push('prose too narrow');
          if (value.builder.width < minimumBuilder.get(width)) issues.push('resume builder too narrow');
          if (value.intro.width > value.prose.width + 1) issues.push('intro exceeds prose');
          if (width <= 768) {
            if (Math.abs(value.form.x - value.result.x) > 1 || value.result.y < value.form.bottom - 1) issues.push('mobile builder is not stacked');
          } else if (value.form.right > value.result.x + 1 || Math.abs(value.form.y - value.result.y) > 1) {
            issues.push('desktop builder columns overlap');
          }
          results.push({ skin, mode, width, ...value, issues });
          if (mode === 'light' && width === 1440 && ['rpn-garden', 'stack-underflow', 'margin-of-error'].includes(skin)) {
            await page.screenshot({ path: path.join(out, `${skin}.png`) });
          }
        } catch (error) {
          results.push({ skin, mode, width, issues: [...issues, String(error)] });
        }
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}

const failed = results.filter(row => row.issues.length);
const summary = {
  cases: results.length,
  expected: themes.length * modes.length * widths.length,
  failed: failed.length,
  widths,
  themes: themes.length,
  failures: failed.map(row => ({ skin: row.skin, mode: row.mode, width: row.width, issues: row.issues }))
};
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
assert.equal(results.length, summary.expected);
assert.deepEqual(failed, []);
console.log(`${results.length} About layout cases passed across 48 themes, two color modes and five viewport widths.`);
