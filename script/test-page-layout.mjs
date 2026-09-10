#!/usr/bin/env node
// Static contracts for opt-in wide pages. Browser geometry is checked by
// test-about-layout.mjs against a generated build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { declarations, rules } from './test-article-css.mjs';

const layout = fs.readFileSync('_layouts/page.html', 'utf8');
const head = fs.readFileSync('_includes/head.html', 'utf8');
const about = fs.readFileSync('about.md', 'utf8');
const component = fs.readFileSync('assets/css/components/page-layout.css', 'utf8');
const resume = fs.readFileSync('assets/resume/resume.css', 'utf8');

assert.match(layout, /page\.page_width == 'wide'[\s\S]*page-shell--wide/);
assert.match(layout, /page\.page_width == 'wide'[\s\S]*page-prose--wide/);
assert.match(about, /^page_width: wide$/m);

const remediationAt = head.indexOf('/assets/css/theme-remediation.css');
const pageLayoutAt = head.indexOf('/assets/css/components/page-layout.css');
const articleLayoutAt = head.indexOf('/assets/css/components/article-layout.css');
const pageStylesAt = head.indexOf('for _stylesheet in page.stylesheets');
assert.ok(remediationAt >= 0 && remediationAt < pageLayoutAt,
  'wide-page geometry must load after the selected skin and remediation');
assert.ok(pageLayoutAt < articleLayoutAt && articleLayoutAt < pageStylesAt,
  'component ownership order changed');

const outer = rules(component);
assert.ok(outer.length > 0 && outer.every(rule => rule.prelude === '@media screen'),
  'wide-page geometry must not replace print layout');
const inner = outer.flatMap(rule => rules(rule.body));
assert.ok(inner.every(rule => rule.prelude.includes('.page-shell--wide')),
  'wide-page rules must remain opt-in');
const props = new Map(inner.map(rule => [rule.prelude, new Map(declarations(rule.body).map(d => [d.prop, d.value]))]));
const shell = props.get('html .page-shell--wide');
const prose = props.get('html .page-shell--wide > .page-prose--wide');
assert.equal(shell?.get('display'), 'grid !important');
assert.equal(shell?.get('grid-template-columns'), 'minmax(0, 1fr) !important');
assert.equal(prose?.get('max-width'), 'var(--wide-page-measure) !important');
assert.equal(prose?.get('margin-inline'), 'auto !important');

assert.match(resume, /container:\s*resume-workshop\s*\/\s*inline-size/);
assert.match(resume, /@container resume-workshop \(max-width: 52rem\)/);
assert.match(resume, /\.resume-profile\s*>\s*p\s*\{\s*max-width:\s*72ch/);
console.log('Wide-page opt-in, stylesheet ownership and resume container contracts pass.');
