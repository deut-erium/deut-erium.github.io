#!/usr/bin/env node
// Offline CSS ownership and projection checks. No dependencies or source writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const legacyFiles = ['assets/css/main.css', 'assets/css/theme-remediation.css',
  ...fs.readdirSync('assets/css/skins').filter(f => f.endsWith('.css')).sort().map(f => `assets/css/skins/${f}`)];

// Conservative scanner: delimiters inside strings, comments, escapes, attribute
// selectors and function arguments are opaque. Unexpected nesting fails closed.
export function scan(text, delimiters, start = 0) {
  let quote = '', stack = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      assert.notEqual(end, -1, 'Unclosed comment'); i = end + 1; continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (!stack.length && delimiters.includes(c)) return i;
    if ('([{'.includes(c)) stack.push(c);
    if (')]}'.includes(c)) assert.equal(stack.pop(), { ')': '(', ']': '[', '}': '{' }[c], 'Unbalanced CSS');
  }
  assert.equal(quote, '', 'Unclosed string'); assert.equal(stack.length, 0, 'Unclosed CSS');
  return text.length;
}
export function split(text, delimiter = ',') {
  const parts = []; let start = 0;
  while (start < text.length) {
    const end = scan(text, delimiter, start); parts.push(text.slice(start, end).trim()); start = end + 1;
  }
  return parts;
}
export function rules(css) {
  const out = []; let pos = 0;
  while (pos < css.length) {
    const trivia = /^(?:\s|\/\*[\s\S]*?\*\/)+/.exec(css.slice(pos));
    if (trivia) pos += trivia[0].length;
    if (pos === css.length) break;
    const end = scan(css, '{;', pos), prelude = css.slice(pos, end).trim();
    assert.ok(prelude && end < css.length, 'Rule without block');
    if (css[end] === ';') { out.push({ prelude, start: pos, end: end + 1, statement: true }); pos = end + 1; continue; }
    const close = scan(css, '}', end + 1);
    assert.ok(close < css.length, 'Unclosed rule');
    out.push({ prelude, body: css.slice(end + 1, close), start: pos, end: close + 1 }); pos = close + 1;
  }
  return out;
}
export const groupRule = p => /^@(media|supports|layer|container|scope|document|starting-style)\b/i.test(p);
export const printRule = p => /^@media\b.*\bprint\b/i.test(p);
function uncomment(text) {
  let result = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { result += text.slice(i, i + 2); i++; continue; }
    if (quote) { result += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; result += c; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); assert.ok(end >= 0); i = end + 1; result += ' '; continue; }
    result += c;
  }
  return result;
}
export function declarations(body) {
  return split(body, ';').map(raw => {
    const text = uncomment(raw).trim();
    if (!text) return null;
    const colon = scan(text, ':'); assert.ok(colon < text.length, 'Invalid declaration');
    return { prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim(), raw };
  }).filter(Boolean);
}

// :is() branches in these stylesheets use classes/types/attributes and ordinary
// pseudo-classes. Fail rather than guess about unsupported specificity syntax.
export function specificity(selector) {
  let s = uncomment(selector), score = [0, 0, 0];
  const add = a => { score = score.map((n, i) => n + a[i]); };
  for (let i = 0; i < s.length;) {
    if (/[\s>+~*|]/.test(s[i])) { i++; continue; }
    if (s[i] === '[') { i = scan(s, ']', i + 1) + 1; score[1]++; continue; }
    const token = /^(::?|[.#])?([\w-]+)/.exec(s.slice(i));
    assert.ok(token, `Unsupported selector near ${s.slice(i)}`);
    i += token[0].length;
    const [, prefix, name] = token;
    if (s[i] === '(') {
      const close = scan(s, ')', i + 1), inside = s.slice(i + 1, close); i = close + 1;
      if (prefix === ':' && name === 'where') continue;
      if (prefix === ':' && ['is', 'not', 'has'].includes(name)) {
        add(split(inside).map(specificity).sort(compareScore).at(-1)); continue;
      }
      assert.ok(!/\bof\b/.test(inside), 'nth-child(of selector) needs a full parser');
    }
    score[prefix === '#' ? 0 : prefix === '.' || prefix === ':' ? 1 : 2]++;
  }
  return score;
}
const compareScore = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// This branch never matches. It preserves :is specificity when a removed
// alternative was more specific than the surviving alternatives.
function sentinel(score) {
  return ':not(*)' + ':is(#css-specificity)'.repeat(score[0]) + ':nth-child(n)'.repeat(score[1]) + ':is(css-specificity)'.repeat(score[2]);
}
const isSentinel = s => s.startsWith(':not(*)');
function selectorTokens(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') { i = scan(s, ']', i + 1); continue; }
    if (s.startsWith('/*', i)) { const end = s.indexOf('*/', i + 2); assert.ok(end >= 0); i = end + 1; continue; }
    out += s[i];
  }
  return out;
}
export const footerSelector = s => /\.site-footer(?:__[\w-]+)?\b/.test(selectorTokens(s));
export function removeFooter(selector) {
  return split(selector).map(branch => {
    for (let i = 0; i < branch.length; i++) {
      if (branch[i] === '[') { i = scan(branch, ']', i + 1); continue; }
      if (branch.startsWith(':is(', i)) {
        const end = scan(branch, ')', i + 4), inside = branch.slice(i + 4, end);
        if (!footerSelector(inside)) { i = end; continue; }
        const kept = removeFooter(inside);
        if (!kept) return '';
        const max = split(inside).map(specificity).sort(compareScore).at(-1);
        const next = split(kept).map(specificity).sort(compareScore).at(-1);
        const replacement = `:is(${kept}${compareScore(max, next) ? ', ' + sentinel(max) : ''})`;
        branch = branch.slice(0, i) + replacement + branch.slice(end + 1);
        i += replacement.length - 1;
      } else if (branch[i] === '(') {
        const end = scan(branch, ')', i + 1);
        assert.ok(!footerSelector(branch.slice(i, end)), 'Footer in unsupported selector function'); i = end;
      }
    }
    return footerSelector(branch) ? '' : branch;
  }).filter(Boolean).join(',\n');
}

// Expand positive :is lists for projection and ownership. Each selector retains
// the original specificity, including mixed lists with more specific branches.
export function alternatives(selector) {
  const branches = split(selector);
  return branches.flatMap(branch => {
    for (let i = 0; i < branch.length; i++) {
      if (branch[i] === '[') { i = scan(branch, ']', i + 1); continue; }
      if (branch.startsWith(':is(', i)) {
        const end = scan(branch, ')', i + 4), inside = branch.slice(i + 4, end);
        const items = split(inside).filter(Boolean), max = items.map(specificity).sort(compareScore).at(-1);
        const real = items.filter(s => !isSentinel(s));
        if (real.length === 1) {
          if (!/::/.test(real[0]) && compareScore(specificity(real[0]), max) === 0) {
            return alternatives(branch.slice(0, i) + real[0] + branch.slice(end + 1));
          }
          i = end; continue;
        }
        return real.flatMap(item => {
          const replacement = compareScore(specificity(item), max) === 0 ? (/::/.test(item) ? `:is(${item})` : item) : `:is(${item}, ${sentinel(max)})`;
          return alternatives(branch.slice(0, i) + replacement + branch.slice(end + 1));
        });
      }
      if (branch[i] === '(') i = scan(branch, ')', i + 1);
    }
    return [branch];
  });
}

const coreName = '(?:record-page|record-grid|article__content|record-head|record-end)';
const tail = '(?::(?:not|where|is)\\([^{}]*\\)|\\[[^\\]]*\\])*';
const core = new RegExp(`(?:\\.${coreName}|#article-body)${tail}$`);
const rail = /(?:\.record-grid\s*>?\s*\.record-index|\.record-page\s+\.record-index)(?::[\w()-]+)*$/;
const sharedRoot = /\.(?:prose|record-index)$/;
const headChild = /(?:\.record-head[\s>]+(?:h1|\.record-head__[\w-]+|\.record-facts|\.tag-line|\.record-actions)|\.(?:record-head__[\w-]+|record-facts))$/;
const proseBlock = /(?:\.article__content|\.prose)\s*(?:>\s*)?(?:p|\*|:is\(p[,\s][^{}]*\)|:not\(\.code-frame[^{}]*\)|\.prose)$/;
const geometry = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|box-sizing|display|position|inset(?:-.+)?|top|right|bottom|left|float|clear|transform|translate|rotate|scale|grid(?:-.+)?|gap|row-gap|column-gap|columns|column-(?:count|width)|order|flex(?:-.+)?|(?:align|justify|place)-(?:items|content|self)|padding(?:-.+)?|margin(?:-.+)?|overflow(?:-.+)?|contain|content-visibility|aspect-ratio|overscroll-behavior(?:-.+)?)$/;
const horizontal = /^(?:(?:min-|max-)?(?:width|inline-size)|box-sizing|padding-(?:inline(?:-.+)?|left|right)|margin-(?:inline(?:-.+)?|left|right)|column-(?:count|width)|columns)$/;
const placement = /^(?:grid(?:-.+)?|order|position|inset(?:-.+)?|top|right|bottom|left|transform|translate|rotate|scale|float|clear|align-self|justify-self)$/;
export function ownership(selector) {
  if (selector.includes(':not(:where(.record-page, .record-page *))')) return null;
  // Unwrap our one-live-branch specificity wrappers for classification only.
  for (let i = 0; i < selector.length; i++) {
    if (!selector.startsWith(':is(', i)) continue;
    const end = scan(selector, ')', i + 4), items = split(selector.slice(i + 4, end)).filter(s => !isSentinel(s));
    if (items.length === 1) selector = selector.slice(0, i) + items[0] + selector.slice(end + 1);
  }
  // Pseudo-element paint and placement stay with the skin; the owner keeps
  // structural pseudos out of the grid without stripping their art.
  if (/::[\w-]+/.test(selector)) return null;
  if (/\.record-end$/.test(selector) && !explicitlyArticle(selector)) {
    if (/\.(?:home-shell|archive-shell)\b/.test(selector)) return null;
    return 'shared-core';
  }
  if (core.test(selector) || rail.test(selector)) return 'core';
  if (sharedRoot.test(selector) && !/\.home-shell|\.archive-shell/.test(selector)) return 'shared';
  if (headChild.test(selector)) return 'head-child';
  if (/(?:\.article__content|\.prose)\s+table$/.test(selector)) return 'prose-measure';
  if (proseBlock.test(selector)) return 'prose-block';
  if (/(?:\.article__content|\.prose)\s*(?:>\s*)?(?:ul|ol|dl|blockquote|h[1-6]|hr)$/.test(selector)) return 'prose-measure';
  return null;
}
export function ownedDeclaration(kind, prop) {
  if (kind === 'core' || kind === 'shared-core') return geometry.test(prop);
  if (kind === 'shared') return horizontal.test(prop) || ['padding', 'margin', 'grid-area', 'grid-column', 'grid-row'].includes(prop);
  if (kind === 'head-child') return horizontal.test(prop) || placement.test(prop);
  if (kind === 'prose-block') return horizontal.test(prop);
  if (kind === 'prose-measure') return /^(?:max-|min-)?(?:width|inline-size)$/.test(prop);
  return false;
}
export function outsideArticle(selector) {
  return selector.replace(/\.(prose|record-index|record-end)\b/, '.$1:not(:where(.record-page, .record-page *))');
}
export const explicitlyArticle = s => /\.(?:article__content|record-page|record-grid)\b|#article-body\b/.test(s);

export function projection(css, mode = 'unrelated') {
  const rows = [];
  function collect(source, ancestry = []) {
  for (const rule of rules(source)) {
    if (groupRule(rule.prelude)) { collect(rule.body, [...ancestry, rule.prelude]); continue; }
    if (/^@keyframes toy-(pulse|wink|jitter)$/.test(rule.prelude)) continue;
    if (rule.prelude.startsWith('@')) { rows.push(JSON.stringify([ancestry, rule.prelude, rule.body || ''])); continue; }
    const inPrint = ancestry.some(printRule);
    for (const sel of alternatives(rule.prelude)) {
      if (footerSelector(sel)) continue;
      const kind = inPrint ? null : ownership(sel);
      for (const d of declarations(rule.body)) {
        if (mode === 'unrelated' && kind && ownedDeclaration(kind, d.prop)) {
          if ((kind === 'shared' || kind === 'shared-core' || kind === 'prose-block' || kind === 'prose-measure') && !explicitlyArticle(sel)) {
            rows.push(JSON.stringify([ancestry, outsideArticle(sel), specificity(sel), d.prop, d.value]));
          }
          continue;
        }
        rows.push(JSON.stringify([ancestry, sel, specificity(sel), d.prop, d.value]));
      }
    }
  }
  }
  collect(css);
  // Per-selector declaration order is significant. The cleanup also retains
  // source-rule order; browser checks cover interacting selectors. Retain declaration sequence per selector/at-rule/specificity key.
  const map = new Map();
  for (const row of rows) {
    const data = JSON.parse(row), key = JSON.stringify(data.slice(0, 3));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(data.slice(3));
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}
function selfTest() {
  assert.deepEqual(split('.a:is(.b,.c), [x="a,b"] /* , */'), ['.a:is(.b,.c)', '[x="a,b"] /* , */']);
  assert.equal(rules('/* { */ @media screen { .x { content: "};"; x: url("a;b"); } }').length, 1);
  assert.equal(declarations('content: "a;b:c"; width: calc(100% - 1rem);').length, 2);
  assert.throws(() => rules('.a { color: red;'));
  for (const sel of ['html :is(.site-footer, .record-page, .home-shell)', ':is(.site-footer a:last-child, .home-shell) > p', '[x=",footer"] :is(.site-footer, .prose):hover']) {
    for (const branch of alternatives(sel)) assert.deepEqual(specificity(branch), specificity(sel));
  }
  const mixed = 'html :is(.site-footer a:last-child, .home-shell) { width: 3rem; color: red; }';
  assert.equal(projection(mixed).length, 1);
  const mr = rules(mixed)[0];
  assert.deepEqual(projection(mixed), projection(`${removeFooter(mr.prelude)} {${mr.body}}`));
  assert.equal(removeFooter('[title=".site-footer, /* comma */"]'), '[title=".site-footer, /* comma */"]');
  assert.equal(declarations('content: "/* literal ; : */";')[0].value, '"/* literal ; : */"');
  assert.equal(removeFooter('.site-footer, :is(.site-header, .site-footer__note)'), ':is(.site-header)');
  assert.ok(alternatives(':is(.masthead::before, .site-footer)').includes(':is(.masthead::before)'));
  assert.equal(removeFooter(':is(.site-footer /* , ignored */, [title="a,b"])'), ':is([title="a,b"])');
  assert.equal(ownership('.home-shell > .record-index'), null);
  assert.equal(ownership('.archive-shell > .record-end'), null);
  assert.equal(ownership('.record-end'), 'shared-core');
  assert.equal(ownership('.record-page > .record-end'), 'core');
  assert.equal(ownership('.record-grid > .record-index'), 'core');
  assert.equal(ownership('.record-grid::before'), null);
  assert.equal(ownedDeclaration('prose-block', 'font-size'), false);
  assert.equal(ownedDeclaration('core', 'border-color'), false);
  console.log('Scanner, selector specificity and ownership fixtures passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selfTest();
  const before = process.argv.find(a => a.startsWith('--before='))?.slice(9);
  let declarationsLeft = 0;
  for (const file of legacyFiles) {
    const css = fs.readFileSync(file, 'utf8');
    function check(source, print = false) {
      for (const r of rules(source)) {
        if (groupRule(r.prelude)) { check(r.body, print || printRule(r.prelude)); continue; }
        if (r.prelude.startsWith('@')) continue;
        assert.ok(!footerSelector(r.prelude), `Legacy footer rule: ${file}: ${r.prelude}`);
        if (print) continue;
        for (const s of alternatives(r.prelude)) {
          if (s.includes(':not(:where(.record-page, .record-page *))')) continue;
          const kind = ownership(s);
          for (const d of declarations(r.body)) if (kind && ownedDeclaration(kind, d.prop)) declarationsLeft++;
        }
      }
    }
    check(css);
    if (before) assert.deepEqual(projection(css), projection(fs.readFileSync(path.join(before, file), 'utf8')), `Non-owned projection differs: ${file}`);
  }
  assert.equal(declarationsLeft, 0, 'Article geometry remains in legacy owner rules');
  const component = fs.readFileSync('assets/css/components/article-layout.css', 'utf8');
  assert.ok(rules(component).every(r => r.prelude === '@media screen'), 'Article component must be screen-only');
  console.log(`${legacyFiles.length} legacy stylesheets: no footer branches or competing owned geometry.${before ? ' Non-owned declarations, specificity and print projections match the snapshot.' : ' Supply --before=SNAPSHOT to check projection parity.'}`);
}
