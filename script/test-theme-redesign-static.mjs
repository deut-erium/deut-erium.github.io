#!/usr/bin/env node
// Run from the repository root. Offline source contracts, not aesthetic scores.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rules, split, declarations, groupRule, alternatives, ownership, ownedDeclaration, footerSelector } from './test-article-css.mjs';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Expectations come only from source-controlled metadata, not ignored review
// artifacts. Loading is explicit so --help and isolated validator controls work
// even while the font worker is preparing the manifest.
export const RPN = 'rpn-garden';
export const themeManifest = 'assets/fonts/theme-library/themes.json';
export let families, displayFaces, skinFiles;
export function readRegistry(root = repo) {
  const text = fs.readFileSync(path.join(root, '_data/themes.yml'), 'utf8');
  const ids = [...text.matchAll(/^- id: ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/gm)].map(m => m[1]);
  assert.equal((text.match(/^- /gm) || []).length, ids.length, 'Unsupported theme registry entry');
  assert.equal(ids.length, 49, 'Registry must contain 48 redesigns plus RPN');
  assert.equal(new Set(ids).size, ids.length, 'Duplicate registry ID');
  assert.equal(ids[0], RPN, 'RPN must remain the default registry entry');
  assert.match(text, /^- id: rpn-garden\n  name: RPN Garden\n  default: true(?:\n|$)/);
  assert.equal((text.match(/default:/g) || []).length, 1, 'Only RPN may be default');
  return ids;
}
export function validateThemes(document, registry, files) {
  assert.ok(document && typeof document === 'object' && !Array.isArray(document), 'themes.json must be keyed by theme ID');
  const byId = new Map(), usedFiles = new Set();
  for (const [id, row] of Object.entries(document)) {
    assert.ok(registry.includes(id) && id !== RPN, `Unknown manifest theme: ${id}`);
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), `Invalid theme entry: ${id}`);
    assert.match(row.file, new RegExp(`^[0-9]{2}-${id}\\.css$`), 'Unsafe or mismatched skin basename');
    const file = `assets/css/skins/${row.file}`;
    assert.ok(files.includes(file) && !usedFiles.has(file), `Missing or duplicate skin file: ${file}`);
    assert.ok(Array.isArray(row.families) && row.families.length >= 2 && row.families.every(f => typeof f === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .-]*$/.test(f) && f.trim() === f), `Invalid families: ${id}`);
    assert.equal(new Set(row.families).size, row.families.length, `Duplicate family: ${id}`);
    assert.ok(row.families.includes(row.display), `Display family not selected: ${id}`);
    assert.equal(typeof row.existing, 'boolean', `Missing existing-implementation annotation: ${id}`);
    // The annotation records prior approval, not current completion or coverage.
    // Never filter the default matrix by it.
    byId.set(id, Object.freeze({ ...row, id, file, families: Object.freeze([...row.families]) })); usedFiles.add(file);
  }
  assert.deepEqual([...byId.keys()].sort(), registry.filter(id => id !== RPN).sort(), 'Manifest must cover every non-RPN registry entry');
  assert.deepEqual([...usedFiles].sort(), [...files].sort(), 'Skin directory and manifest differ');
  return Object.freeze(Object.fromEntries(registry.filter(id => id !== RPN).map(id => [id, byId.get(id)])));
}
export function loadThemes(root = repo) {
  const file = path.join(root, themeManifest);
  assert.ok(fs.existsSync(file), `Missing committed ${themeManifest}; no artifact or five-theme fallback`);
  assert.equal(fs.realpathSync(file), path.resolve(file), 'Theme manifest cannot be a symlink');
  const files = fs.readdirSync(path.join(root, 'assets/css/skins')).filter(f => f.endsWith('.css')).map(f => `assets/css/skins/${f}`);
  const config = validateThemes(JSON.parse(fs.readFileSync(file, 'utf8')), readRegistry(root), files);
  families = Object.freeze(Object.fromEntries(Object.entries(config).map(([id, row]) => [id, row.families])));
  displayFaces = Object.freeze(Object.fromEntries(Object.entries(config).map(([id, row]) => [id, row.display])));
  skinFiles = Object.freeze(Object.fromEntries(Object.entries(config).map(([id, row]) => [id, row.file])));
  return config;
}
export function selectThemes(value, allowed) {
  const selected = value === undefined ? [...allowed] : value.split(',').map(s => s.trim());
  assert.ok(selected.length && selected.every(id => allowed.includes(id)) && new Set(selected).size === selected.length, 'Invalid or duplicate --themes');
  return selected;
}
export const hash = b => createHash('sha256').update(b).digest('hex');
export const within = (root, file) => file === root || file.startsWith(root + path.sep);
export function freshOutput(arg) {
  const allowed = path.join(repo, 'agent_out/theme-redesign'), out = path.resolve(repo, arg);
  let ancestor = out;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, out));
  assert.ok(out !== allowed && within(allowed, out) && within(allowed, resolved), 'Output must stay under agent_out/theme-redesign');
  assert.ok(!fs.existsSync(out), 'Use a fresh output directory; attempts are never overwritten');
  fs.mkdirSync(out, { recursive: true });
  return out;
}
export const unquote = s => s.trim().replace(/^(['"])(.*)\1$/, '$2');
export function* walkRules(css, ancestors = []) {
  for (const r of rules(css)) {
    if (groupRule(r.prelude)) {
      assert.ok(r.body !== undefined, 'Grouping rule needs a block');
      yield* walkRules(r.body, [...ancestors, r.prelude]);
    } else yield { ...r, ancestors };
  }
}
export function localAsset(root, cssFile, url) {
  assert.ok(!/[\\\0?]/.test(url) && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url), `Nonlocal asset URL: ${url}`);
  const [pathname, fragment] = url.split('#');
  assert.ok(!url.includes('#') || url.split('#').length === 2 && /\.svg$/.test(pathname) && /^[\w-]+$/.test(fragment), `Unsafe asset fragment: ${url}`);
  const decoded = decodeURIComponent(pathname);
  const file = url.startsWith('/') ? path.resolve(root, '.' + decoded) : path.resolve(root, path.dirname(cssFile), decoded);
  assert.ok(within(path.join(root, 'assets'), file), `Asset outside assets: ${url}`);
  const real = fs.realpathSync(file);
  assert.ok(within(path.join(root, 'assets'), real) && fs.statSync(real).isFile(), `Asset realpath escaped: ${url}`);
  return path.relative(root, real).split(path.sep).join('/');
}
export function urls(value) {
  const result = [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)].map(m => m[1] ?? m[2] ?? m[3]);
  assert.equal((value.match(/url\s*\(/gi) || []).length, result.length, 'Unsupported URL syntax');
  return result;
}
export function checkScope(css, skin) {
  const anchor = new RegExp(`^html\\[data-skin=(?:"${skin}"|'${skin}'|${skin})\\](?=$|[\\s:.#\\[>])`);
  for (const r of walkRules(css)) {
    if (/^@font-(?:face\s*$|palette-values\s+--[\w-]+\s*$)/i.test(r.prelude)) continue;
    assert.ok(!r.prelude.startsWith('@'), `Unsupported global at-rule: ${r.prelude}`);
    for (const selector of split(r.prelude)) {
      assert.match(selector, anchor, `Unscoped ${skin} selector: ${selector}`);
      // A sibling combinator from the html anchor can select outside the skin.
      assert.ok(!/^html\[[^\]]+\](?::root)?\s*[+~]/.test(selector), `Escaping skin anchor: ${selector}`);
      // Later :not([data-skin=other]) specificity guards cannot broaden this
      // positive html anchor, so they are valid scoped selectors.
    }
  }
}
const genericFonts = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'cursive', 'fantasy', 'emoji', 'math', 'inherit']);
const systemFonts = new Set(['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'SFMono-Regular', 'Segoe UI', 'Impact', 'Verdana', 'Trebuchet MS', 'Arial Black']);
const geometry = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|display|position|inset(?:-.+)?|top|right|bottom|left|grid(?:-.+)?|flex(?:-.+)?|order|gap|row-gap|column-gap|padding(?:-.+)?|margin(?:-.+)?|transform|translate|rotate|scale|overflow(?:-.+)?|(?:align|justify|place)-(?:items|self|content))$/;
function wideOwned(selector, prop) {
  if (/::/.test(selector)) return false;
  // page-shell selectors also match the opt-in wide shell. Narrow-only rules
  // must explicitly exclude it, just as article ownership excludes shared roots.
  if (/:not\(\.page-shell--wide\)/.test(selector)) return false;
  if (/\.page-shell(?:--wide)?$/.test(selector)) return /^(?:display|grid(?:-.+)?|gap|align-items)$/.test(prop);
  if (/\.(?:page-heading|page-prose(?:--wide)?)$/.test(selector)) return geometry.test(prop);
  return false;
}
export function checkSvg(text, label) {
  // Deliberately small decorative SVG grammar. No active elements, references
  // to files, XML entities, embedded CSS, text, links, images, or animation.
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc)>[^<>&]*<\/\1>/g, '');
  assert.ok(!/<!|<\?|&|\bon\w+\s*=|\b(?:style|tabindex|role)\s*=/i.test(clean), `Active SVG syntax: ${label}`);
  const tags = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'view', 'use']);
  const stack = [], ids = new Set(), refs = [], idTags = new Map(), uses = [];
  let end = 0, rootCount = 0;
  for (const m of clean.matchAll(/<\/?([\w:-]+)\b([^<>]*?)>/g)) {
    assert.equal(clean.slice(end, m.index).trim(), '', `Visible SVG text: ${label}`); end = m.index + m[0].length;
    assert.ok(tags.has(m[1]), `Unsupported SVG element ${m[1]}: ${label}`);
    if (m[0].startsWith('</')) { assert.equal(stack.pop(), m[1], `Unbalanced SVG: ${label}`); continue; }
    if (!stack.length) { assert.equal(m[1], 'svg'); rootCount++; }
    const attrs = m[2].replace(/\/\s*$/, ''); let cursor = 0;
    for (const a of attrs.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
      assert.equal(attrs.slice(cursor, a.index).trim(), '', `Malformed SVG attribute: ${label}`); cursor = a.index + a[0].length;
      if (a[1] === 'id') { assert.ok(!ids.has(a[3]), `Duplicate SVG id: ${label}`); ids.add(a[3]); idTags.set(a[3], m[1]); }
      if (/href$/i.test(a[1])) { assert.equal(m[1], 'use'); assert.equal(a[1], 'href'); assert.match(a[3], /^#[\w-]+$/); refs.push(a[3].slice(1)); uses.push(a[3].slice(1)); }
      if (a[1] === 'xmlns') assert.equal(a[3], 'http://www.w3.org/2000/svg');
      else assert.ok(!/(?:https?:|data:|javascript:|\/\/)/i.test(a[3]), `External SVG value: ${label}`);
      for (const ref of urls(a[3])) { assert.match(ref, /^#[\w-]+$/); refs.push(ref.slice(1)); }
    }
    assert.equal(attrs.slice(cursor).trim(), '', `Malformed SVG attributes: ${label}`);
    if (!m[0].endsWith('/>')) stack.push(m[1]);
  }
  assert.equal(rootCount, 1); assert.equal(stack.length, 0); assert.equal(clean.slice(end).trim(), '');
  assert.match(clean, /<svg\b[^>]*\bviewBox=["'][-\d.\s]+["']/);
  assert.ok(refs.every(id => ids.has(id)), `Unresolved SVG fragment: ${label}`);
  assert.ok(uses.every(id => ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(idTags.get(id))), `SVG use must reference a simple shape, not a recursive container: ${label}`);
  return ids;
}
export function checkProvenance(root, selectedFamilies = Object.values(families).flat()) {
  const read = file => fs.readFileSync(file);
  const manifestPath = 'assets/fonts/theme-library/PROVENANCE.json';
  const manifestFile = path.join(root, manifestPath);
  assert.equal(fs.realpathSync(manifestFile), manifestFile, 'No font provenance or parent-directory symlinks');
  assert.ok(fs.lstatSync(manifestFile).isFile(), 'Regular font provenance file required');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.ok(Array.isArray(manifest.files) && manifest.files.length, 'Empty production font provenance');
  const index = new Map(), allowed = new Set(selectedFamilies);
  for (const entry of manifest.files) {
    assert.ok(allowed.has(entry.family), `Unselected installed family: ${entry.family}`);
    assert.ok(/^assets\/fonts\/theme-library\/[\w-]+\/[\w.-]+$/.test(entry.path), `Unsafe provenance path: ${entry.path}`);
    assert.ok(!index.has(entry.path), `Duplicate provenance path: ${entry.path}`);
    assert.match(entry.url, /^https:\/\//); assert.ok(Number.isFinite(Date.parse(entry.accessed_utc)), 'Missing access date');
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const file = path.join(root, entry.path), real = fs.realpathSync(file);
    assert.ok(within(path.join(root, 'assets/fonts/theme-library'), real), 'Font symlink escape');
    const bytes = read(real);
    assert.equal(bytes.length, entry.bytes, `Font/notice byte length: ${entry.path}`);
    assert.equal(hash(bytes), entry.sha256, `Font/notice hash: ${entry.path}`);
    if (/\.woff2$/.test(entry.path)) assert.equal(bytes.subarray(0, 4).toString(), 'wOF2', `Invalid WOFF2: ${entry.path}`);
    index.set(entry.path, entry);
  }
  for (const entry of index.values()) if (/\.woff2$/.test(entry.path)) {
    const dir = path.posix.dirname(entry.path);
    const notice = ['OFL.txt', 'LICENSE.txt', 'LICENSE'].map(n => index.get(`${dir}/${n}`)).find(Boolean);
    assert.ok(notice?.family === entry.family, `No pinned license notice: ${entry.path}`);
    assert.match(read(path.join(root, notice.path)).toString(), /copyright/i, `Missing copyright notice: ${entry.path}`);
  }
  const visit = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name); assert.ok(!e.isSymbolicLink(), 'No symlinks in installed fonts');
    if (e.isDirectory()) visit(file);
    else if (file !== path.join(root, manifestPath) && file !== path.join(root, 'assets/fonts/theme-library/README.md') && file !== path.join(root, themeManifest)) assert.ok(index.has(path.relative(root, file).split(path.sep).join('/')), `Unpinned installed font artifact: ${file}`);
  } };
  visit(path.join(root, 'assets/fonts/theme-library'));
  if (fs.existsSync(path.join(root, themeManifest))) {
    const document = JSON.parse(fs.readFileSync(path.join(root, themeManifest), 'utf8'));
    const config = validateThemes(document, [RPN, ...Object.keys(families)], Object.values(skinFiles));
    const expected = Object.keys(families).map(id => ({ id, file: skinFiles[id], display: displayFaces[id], families: families[id] }));
    assert.deepEqual(Object.values(config).map(({ id, file, display, families }) => ({ id, file, display, families })).sort((a, b) => a.id.localeCompare(b.id)), expected.sort((a, b) => a.id.localeCompare(b.id)), 'Generated theme metadata differs from source expectations');
  }
  return index;
}
export function checkMarginPlacement(css, skin) {
  if (skin !== 'margin-of-error') return;
  const all = [...walkRules(css)], root = /^html\[data-skin=(?:"margin-of-error"|'margin-of-error'|margin-of-error)\](?::root)?$/;
  const tokens = new Map(all.filter(r => !r.ancestors.length && root.test(r.prelude)).flatMap(r => declarations(r.body).map(d => [d.prop, d.value])));
  assert.equal(tokens.get('--article-page-area'), 'folio', 'Margin of Error must retain the article placement hook');
  assert.equal(tokens.get('--footer-page-area'), 'footer', 'Margin of Error must retain the footer placement hook');
  const bodyGrid = all.some(r => split(r.prelude).some(sel => /\] body$/.test(sel)) && declarations(r.body).some(d => d.prop === 'display' && /^(?:inline-)?grid(?:\s*!important)?$/.test(d.value)));
  if (bodyGrid) assert.ok(all.some(r => !r.ancestors.length && split(r.prelude).some(sel => /\] \.page-shell(?:--wide)?$/.test(sel)) && declarations(r.body).some(d => d.prop === 'grid-area' && d.value === 'folio')), 'Margin of Error body grid needs a wide page folio placement hook');
}
export function checkSkin(root, skin, index, cssOverride) {
  const file = skinFiles[skin], css = cssOverride ?? fs.readFileSync(path.join(root, file), 'utf8');
  checkScope(css, skin);
  checkMarginPlacement(css, skin);
  assert.doesNotMatch(css, /Cycle (?:two|three) corrective pass|Theme (?:Chango|Pixelify)|--bonbon-|--grimoire-|--mercury-|--stack-/i, 'Legacy generation remains');
  const declared = new Set(), assets = new Set(), fontPaths = new Set(), baseTokens = new Map();
  let ruleCount = 0;
  for (const r of walkRules(css)) {
    const ds = declarations(r.body), props = Object.fromEntries(ds.map(d => [d.prop, d.value]));
    if (/^@font-face$/i.test(r.prelude)) {
      const family = unquote(props['font-family'] || '');
      assert.ok(families[skin].includes(family), `Unselected face ${family}: ${file}`);
      assert.equal(props['font-display'], family === displayFaces[skin] ? 'swap' : 'optional', `Unexpected font loading policy for ${family}: ${file}`);
      assert.ok(!/local\s*\(/i.test(props.src || ''), 'Local font aliases defeat pinned rendering');
      const srcs = urls(props.src || ''); assert.ok(srcs.length, 'Face without URL');
      for (const url of srcs) {
        const resolved = localAsset(root, file, url);
        assert.equal(index.get(resolved)?.family, family, `Font URL/provenance mismatch: ${resolved}`); fontPaths.add(resolved);
      }
      declared.add(family); continue;
    }
    if (/^@font-palette-values/.test(r.prelude)) {
      assert.ok(families[skin].includes(unquote(props['font-family'] || '')), 'Unselected palette family'); continue;
    }
    ruleCount++;
    for (const sel of alternatives(r.prelude)) {
      assert.ok(!footerSelector(sel) && !/#site-footer\b/.test(sel), `Footer selectors belong to the component: ${sel}`);
      const kind = ownership(sel);
      for (const d of ds) {
        // Page-shell placement in Margin's body grid is outside the wide
        // component's internal track ownership. No other geometry is exempt.
        const marginPlacement = skin === 'margin-of-error' && /\.page-shell(?:--wide)?$/.test(sel) && d.prop === 'grid-area' && d.value === 'folio';
        assert.ok(!(kind && ownedDeclaration(kind, d.prop)) && (!wideOwned(sel, d.prop) || marginPlacement), `Competing geometry: ${sel} { ${d.prop} }`);
        if (d.prop === 'content') assert.match(d.value, /^(?:none|normal|""|'')\s*(?:!important)?$/, `Visible pseudo-copy: ${sel}`);
        if (/^text-decoration(?:-line)?$/.test(d.prop) && /\bunderline\b/.test(d.value) && /!important/.test(d.value)) {
          assert.match(sel, /\.(?:prose|article__content|record-|masthead|page-|home-|archive-|site-nav|site-header)|#(?:content|article-body)/, `Forced underline can reach footer links: ${sel}`);
        }
        // Skin roots define one base font/palette contract. A second base
        // definition indicates an appended generation, not a responsive variant.
        if (!r.ancestors.length && /^html\[[^\]]+\](?::root)?$/.test(sel) && /^--(?:body|display|keys|mono|bench|paper|ink|page|reading)$/.test(d.prop)) {
          assert.ok(!baseTokens.has(d.prop), `Competing base token ${d.prop}: ${file}`); baseTokens.set(d.prop, d.value);
        }
        if (/^--footer-/.test(d.prop)) {
          assert.ok(/-text-transform$/.test(d.prop) || !/(?:^|-)(?:width|height|display|grid|position|margin|transform|order|gap|underline)(?:-|$)/.test(d.prop), `Footer geometry token: ${d.prop}`);
          assert.ok(!/^--footer-.*padding/.test(d.prop) || d.prop === '--footer-note-padding', 'Footer control padding is component-owned');
        }
        if (d.prop === 'font-family' || /^--(?:body|display|keys|mono|footer-.*font-family)$/.test(d.prop)) {
          for (const f of split(d.value).map(unquote)) assert.ok(f.startsWith('var(') || families[skin].includes(f) || genericFonts.has(f) || systemFonts.has(f), `Unselected font stack ${f}: ${file}`);
        }
        for (const url of urls(d.value)) {
          const asset = localAsset(root, file, url); assets.add(asset);
          assert.equal(asset, `assets/images/themes/${skin}.svg`, `Unexpected decorative asset: ${asset}`);
          const ids = checkSvg(fs.readFileSync(path.join(root, asset), 'utf8'), asset);
          if (url.includes('#')) assert.ok(ids.has(url.split('#')[1]), `Missing decorative SVG fragment: ${url}`);
        }
      }
    }
  }
  assert.deepEqual([...declared].sort(), [...families[skin]].sort(), `Incomplete selected faces: ${file}`);
  for (const token of ['--body', '--display', '--keys', '--mono']) assert.ok(baseTokens.has(token), `Hard shell font default inherited: ${token}`);
  assert.ok(assets.size, `Missing local decorative SVG: ${file}`);
  return { skin, file, rules: ruleCount, families: [...declared], fontFiles: fontPaths.size, decorativeAssets: [...assets], sha256: hash(css) };
}
export function checkNoGlobalLibrary(root) {
  // Existing RPN/shared faces are intentionally preserved. The release does not
  // install a global font catalog, even under renamed URLs or new family names.
  const nativeGlobal = new Set(['Atkinson Hyperlegible', 'Silkscreen', 'Theme Bungee', 'Theme Chango', 'Theme Climate', 'Theme Doto', 'Theme Fascinate', 'Theme Monoton', 'Theme Pixelify', 'Theme Glitch', 'Theme Unbounded', 'Theme Computer Modern', 'Theme Euler Fraktur', 'Theme Formal Script']);
  const files = [];
  function visit(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!e.isSymbolicLink(), 'No CSS/include symlinks');
    const file = path.join(dir, e.name);
    if (e.isDirectory()) visit(file); else if (/\.(css|html)$/.test(file)) files.push(file);
  } }
  visit(path.join(root, 'assets/css')); visit(path.join(root, '_includes'));
  const selected = new Set(Object.values(skinFiles));
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/'); if (selected.has(rel)) continue;
    const css = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(css, /theme-library\//i, `Global/unrelated font library reference: ${rel}`);
    // Catch copied declarations even if their URLs were renamed.
    if (file.endsWith('.css')) for (const r of walkRules(css)) if (/^@font-face$/i.test(r.prelude)) {
      const family = unquote(declarations(r.body).find(d => d.prop === 'font-family')?.value || '');
      assert.ok(!Object.values(families).flat().includes(family), `Selected face declared globally: ${rel}: ${family}`);
      if (!rel.startsWith('assets/css/skins/')) assert.ok(nativeGlobal.has(family), `Unapproved global catalog face: ${rel}: ${family}`);
    }
  }
  return { checkedFiles: files.length, policy: 'Selected library faces only in registered lazy skin files; no global library sheet or preload.' };
}
async function main() {
  const { values: opt } = parseArgs({ options: { out: { type: 'string' }, themes: { type: 'string' }, help: { type: 'boolean' }, 'negative-control': { type: 'string' } } });
  if (opt.help) { console.log('node script/test-theme-redesign-static.mjs --out agent_out/theme-redesign/FRESH\nOptional --themes id,id labels partial skin coverage. Defaults: all 48 skins (49 themes including RPN); RPN rendering is checked by the browser matrix.\nOptional --negative-control unscoped|missing-font|corrupt-font must exit nonzero. No build, network or source writes.'); return; }
  const out = freshOutput(opt.out || `agent_out/theme-redesign/static-${Date.now()}`);
  const summary = { status: 'failed', partial: true, controls: [], skins: [], failures: [], limitations: ['Static contracts do not prove rendering, contrast or aesthetic quality.'] };
  const check = (name, fn) => { try { return fn(); } catch (e) { summary.failures.push({ check: name, error: String(e.message).slice(0, 1600) }); return null; } };
  try {
    const config = loadThemes(), themes = selectThemes(opt.themes, Object.keys(config));
    summary.themes = themes; summary.partial = themes.length !== Object.keys(config).length;
    summary.coverage = summary.partial ? 'partial' : `all-${Object.keys(config).length}-skins`;
    summary.manifest = { path: themeManifest, sha256: hash(fs.readFileSync(path.join(repo, themeManifest))) };
    summary.rpn = 'Source global-loading policy checked; unchanged rendering requires the browser comparison.';
    assert.ok(!opt['negative-control'] || ['unscoped', 'missing-font', 'corrupt-font'].includes(opt['negative-control']), 'Unknown negative control');
    for (const text of ['body { color: red; }', 'html[data-skin="proof-bonbons"] .a, body { color:red }', '@media screen { body { color:red } }']) {
      assert.throws(() => checkScope(text, 'proof-bonbons'), /Unscoped/);
    }
    summary.controls.push('unscoped root, comma branch and nested rule rejected');
    checkScope('@font-face { font-family: Test; src: url(test.woff2); } @font-palette-values --test { font-family: Test; } html[data-skin="proof-bonbons"] :is(.a, .b) { color: red; }', 'proof-bonbons');
    for (const bad of ['<script/>', '<text>visible copy</text>', '<use href="https://external.invalid/x.svg#shape"/>', '<path id="x" onclick="alert(1)"/>']) {
      assert.throws(() => checkSvg(`<svg viewBox="0 0 1 1">${bad}</svg>`, 'negative SVG'));
    }
    summary.controls.push('active, visible-copy and external SVG controls rejected');
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'assets/fonts/theme-library/PROVENANCE.json')));
    const target = manifest.files.find(f => f.path.endsWith('.woff2'));
    const notice = manifest.files.find(f => path.posix.dirname(f.path) === path.posix.dirname(target.path) && /\/(OFL.txt|LICENSE.txt|LICENSE)$/.test(f.path));
    assert.ok(notice, 'Font control needs a pinned notice');
    const controlRoots = {};
    for (const mode of ['missing-font', 'corrupt-font']) {
      const root = path.join(out, 'controls', mode); controlRoots[mode] = root;
      for (const entry of [target, notice]) {
        const file = path.join(root, entry.path); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(path.join(repo, entry.path), file);
      }
      fs.writeFileSync(path.join(root, 'assets/fonts/theme-library/PROVENANCE.json'), JSON.stringify({ files: [target, notice] }));
      checkProvenance(root); // The unchanged physical fixture must pass first.
      const file = path.join(root, target.path);
      if (mode === 'missing-font') fs.unlinkSync(file);
      else { const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes); }
      assert.throws(() => checkProvenance(root), mode === 'missing-font' ? /ENOENT/ : /hash/);
      summary.controls.push(`${mode}: physical fixture rejected by production provenance validator`);
    }
    const index = check('installed-font-provenance', () => checkProvenance(controlRoots[opt['negative-control']] || repo));
    for (const skin of themes) {
      const css = opt['negative-control'] === 'unscoped' && skin === themes[0] ? fs.readFileSync(path.join(repo, skinFiles[skin]), 'utf8') + '\nbody { color: red; }' : undefined;
      const result = check(skin, () => checkSkin(repo, skin, index || new Map(), css)); if (result) summary.skins.push(result);
    }
    if (index && !opt['negative-control']) {
      const skin = themes[0], css = fs.readFileSync(path.join(repo, skinFiles[skin]), 'utf8');
      for (const mutated of [css.replace(/font-display\s*:\s*swap\b/, 'font-display: optional'), css.replace(/font-display\s*:\s*optional\b/, 'font-display: swap')]) {
        assert.notEqual(mutated, css);
        assert.throws(() => checkSkin(repo, skin, index, mutated), /Unexpected font loading policy/);
      }
      summary.controls.push('display lockout and reading-font swap policy mutations rejected');
    }
    summary.globalLoading = check('lazy-library-loading', () => checkNoGlobalLibrary(repo));
    summary.status = summary.failures.length ? 'failed' : 'passed';
  } catch (e) { summary.failures.push({ check: 'infrastructure', error: String(e.stack).slice(0, 2000) }); }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ status: summary.status, coverage: summary.coverage, partial: summary.partial, skins: summary.skins.length, failures: summary.failures.length, out: path.relative(repo, out) }));
  if (summary.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
