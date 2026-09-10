#!/usr/bin/env node
// Offline: node --test script/test-font-preloads.mjs
// Uses the installed Jekyll/Liquid renderer, then Node's VM; never builds the site.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'agent_out/article-layout-rework/fonts/native');
mkdirSync(out, { recursive: true });
const ruby = process.env.RUBY || (existsSync(path.join(repo, '.toolchain/bin/ruby'))
  ? path.join(repo, '.toolchain/bin/ruby') : 'ruby');
const env = { ...process.env };
if (!env.BUNDLE_PATH && existsSync(path.join(repo, '.toolchain/vendor-bundle'))) {
  env.BUNDLE_PATH = path.join(repo, '.toolchain/vendor-bundle');
}
const rendered = spawnSync(ruby, ['-e', `
require 'bundler/setup'
require 'jekyll'
require 'yaml'
require 'json'
require_relative './_plugins/asset_version'
# Supply only public theme data; no site scan, plugins, content or build hooks.
themes = YAML.safe_load_file('_data/themes.yml')
site_class = Struct.new(:source, :config, :data, :filter_cache)
result = ['', '/nested/blog'].to_h do |base|
  site = site_class.new(Dir.pwd, {'baseurl'=>base, 'url'=>'https://example.invalid'}, {'themes'=>themes}, {})
  html = Liquid::Template.parse(File.read('_includes/theme-bootstrap.html')).render!(
    {'site'=>{'data'=>site.data}}, registers: {site: site})
  [base, html]
end
puts JSON.generate(result)
`], { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
assert.equal(rendered.status, 0, `Local Jekyll renderer failed: ${rendered.error || rendered.stderr}`);
const fixtures = JSON.parse(rendered.stdout);
const defaultSkin = 'rpn-garden';

function execute(html, { query = '', saved, color, systemDark = false, blocked = false, route = '/' } = {}) {
  assert.match(html, /^<script>\s/);
  assert.doesNotMatch(html, /\{[{%]|theme_font_preloads|theme-bootstrap\.js/);
  const source = html.replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const writes = [], classes = new Set(), attributes = {};
  const storage = new Map();
  if (saved !== undefined) storage.set('deuterium-skin', saved);
  if (color !== undefined) storage.set('deuterium-theme', color);
  const picker = { value: '', querySelector() { return { textContent: 'Selected skin' }; } };
  const summary = { textContent: '' };
  const button = { hidden: true, setAttribute(k, v) { attributes[k] = v; } };
  const root = { dataset: {}, classList: { add(c) { classes.add(c); } } };
  const forbidden = () => assert.fail('Theme selection must not force font requests or add a loader');
  const context = vm.createContext({
    window: {}, URLSearchParams,
    location: { search: query, pathname: route },
    matchMedia(q) { assert.equal(q, '(prefers-color-scheme: dark)'); return { matches: systemDark }; },
    localStorage: {
      getItem(k) { if (blocked) throw new Error('Storage blocked'); return storage.get(k) ?? null; },
      setItem(k, v) { if (blocked) throw new Error('Storage blocked'); storage.set(k, v); },
    },
    document: {
      documentElement: root,
      write(s) { assert.match(s, /^<link rel="preload" as="style" href="[^"<>]+">$/); writes.push(s); },
      querySelector(s) { return { '.theme-toggle': button, '#skin-picker': picker, '.skin-menu summary': summary }[s]; },
      createElement: forbidden, head: { appendChild: forbidden }, fonts: { load: forbidden, add: forbidden },
    },
    fetch: forbidden, XMLHttpRequest: forbidden, Image: forbidden, FontFace: forbidden,
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden,
  });
  new vm.Script(source).runInContext(context, { timeout: 1000 });
  const config = context.window.__deuteriumTheme;
  assert.ok(classes.has('js'));
  config.syncControls();
  assert.equal(picker.value, config.skin);
  assert.equal(button.hidden, false);
  assert.equal(attributes['aria-pressed'], String(root.dataset.theme === 'dark'));
  if (config.skin === defaultSkin) {
    assert.equal(root.dataset.skin, undefined);
    assert.equal(config.skinHref, null);
    assert.deepEqual(writes, []);
  } else {
    assert.equal(root.dataset.skin, config.skin);
    assert.deepEqual(writes, [`<link rel="preload" as="style" href="${config.skinHref}">`]);
  }
  return { config, root, storage };
}

for (const [base, html] of Object.entries(fixtures)) {
  writeFileSync(path.join(out, base ? 'baseurl.html' : 'root.html'), html);
  const prefix = base || 'root';
  const { config } = execute(html);
  const skins = [defaultSkin, ...Object.keys(config.skinFiles)];

  test(`${prefix}: all skin URLs are versioned, baseurl-aware and backed by local CSS`, () => {
    assert.equal(skins.length, 48);
    assert.equal(config.skinBase, base + '/assets/css/skins/');
    for (const href of Object.values(config.skinFiles)) {
      assert.ok(href.startsWith(base + '/assets/css/skins/'));
      assert.match(href, /\.css\?v=[0-9a-f]{8}$/);
      assert.ok(existsSync(path.join(repo, href.slice(base.length).split('?')[0])));
    }
  });

  test(`${prefix}: every query/saved skin applies synchronously on home and article, without forced fonts`, () => {
    for (const route of [base + '/', base + '/2026/03/03/unfaithful-claims-breaking-6-zkvms.html']) {
      for (const skin of skins) {
        const q = execute(html, { query: '?skin=' + skin, saved: 'proof-bonbons', route });
        assert.equal(q.config.skin, skin);
        assert.equal(q.storage.get('deuterium-skin'), skin);
        assert.equal(execute(html, { saved: skin, route }).config.skin, skin);
      }
    }
  });

  test(`${prefix}: invalid query falls back to saved skin; invalid saved values never become paths`, () => {
    for (const id of ['unknown', '__proto__', 'constructor', '../../assets/fonts/x.woff2', 'https://example.invalid/a']) {
      assert.equal(execute(html, { query: '?skin=' + encodeURIComponent(id), saved: 'magnetic-index' }).config.skin, 'magnetic-index');
      assert.equal(execute(html, { saved: id }).config.skin, defaultSkin);
    }
    assert.equal(execute(html, { query: '?skin=rpn-garden', saved: 'magnetic-index' }).config.skin, defaultSkin);
    assert.equal(execute(html, { query: '?skin=grid-meltdown', saved: 'magnetic-index' }).config.skin, 'grid-meltdown');
  });

  test(`${prefix}: unavailable storage and color preferences preserve first-page selection`, () => {
    const blocked = execute(html, { query: '?skin=magnetic-index', blocked: true, systemDark: true });
    assert.equal(blocked.config.skin, 'magnetic-index');
    assert.equal(blocked.root.dataset.theme, 'dark');
    assert.equal(execute(html, { blocked: true }).config.skin, defaultSkin);
    for (const color of ['light', 'dark']) {
      assert.equal(execute(html, { color, systemDark: color !== 'dark' }).root.dataset.theme, color);
    }
    assert.equal(execute(html, { color: 'invalid', systemDark: true }).root.dataset.theme, 'dark');
  });
}

test('obsolete font map and runtime loader are absent; selected CSS still blocks first render', () => {
  assert.equal(existsSync(path.join(repo, '_data/theme_font_preloads.yml')), false);
  assert.equal(existsSync(path.join(repo, 'assets/js/theme-bootstrap.js')), false);
  const head = readFileSync(path.join(repo, '_includes/head.html'), 'utf8');
  assert.doesNotMatch(head, /as=["']font["']/);
  const bootstrap = head.indexOf('{% include theme-bootstrap.html %}');
  const main = head.indexOf('/assets/css/main.css');
  const selected = head.indexOf('document.write(\'<link id="skin-stylesheet" rel="stylesheet"');
  assert.ok(bootstrap >= 0 && main > bootstrap && selected > main);
});
