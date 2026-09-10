import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { person, compose, audits, research } from '../assets/resume/catalog.mjs';
import { typeset, checkLayout } from '../assets/resume/typesetter.mjs';
import { makePDF } from '../assets/resume/pdf.mjs';

const root = new URL('../', import.meta.url);
const catalogSource = await readFile(new URL('assets/resume/catalog.mjs', root), 'utf8');
for (const withheld of ['Zcash', 'Firedancer', 'Helius Zolana', 'Circle MPC']) {
  assert.equal(catalogSource.includes(withheld), false, `${withheld} leaked into the browser catalog`);
}
assert.deepEqual(audits.map(entry => entry.id), ['jolt', 'stacks-wsts', 'ika-library']);
assert.equal(research.find(entry => entry.id === 'binius-research').links.some(link => link.label === 'Exploit'), false,
  'retired Binius64 exploit link remains');

const metrics = JSON.parse(await readFile(new URL('assets/resume/fonts/metrics.json', root), 'utf8'));
const binaries = Object.fromEntries(await Promise.all(Object.entries(metrics).map(async ([key, font]) => {
  const data = await readFile(new URL(`assets/resume/${font.file}`, root));
  return [key, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)];
})));
const base = compose('');
assert.deepEqual(base.qualifications, [], 'the default resume contains added qualifications');
const document = typeset(base, person, metrics);
assert.equal(document.pages.length, 3, 'the default resume page count changed');
assert.deepEqual(checkLayout(document, metrics), [], 'the default resume does not fit');

const request = 'Can negotiate with a kraken.\nMust deploy ZK proofs to a calculator.';
const tailored = compose(request);
assert.deepEqual(tailored.qualifications, ['Can negotiate with a kraken.', 'Must deploy ZK proofs to a calculator.']);
assert.deepEqual(checkLayout(typeset(tailored, person, metrics), metrics), []);

const pdf = await makePDF(document, metrics, binaries);
assert.equal(new TextDecoder().decode(pdf.subarray(0, 8)), '%PDF-1.7');
assert.equal(new TextDecoder().decode(pdf.subarray(-6)), '%%EOF\n');

const about = await readFile(new URL('about.md', root), 'utf8');
const appSource = await readFile(new URL('assets/resume/app.mjs', root), 'utf8');
assert.match(about, /<details id="resume-details" class="resume-disclosure">/);
assert.match(about, /<summary>Hire me\?<\/summary>/);
assert.doesNotMatch(about, /<details[^>]+\bopen\b/);
const defaultRequest = about.match(/<textarea id="request"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
assert.match(defaultRequest, /framework released last Tuesday/);
assert.match(defaultRequest, /active kraken incident/);
assert.match(defaultRequest, /relocate to \/dev\/null/);
assert.equal(compose(defaultRequest).qualifications.length, 9);
assert.deepEqual(checkLayout(typeset(compose(defaultRequest), person, metrics), metrics), []);
assert.match(appSource, /exportPDF\('', true\)/, 'the initial PDF must ignore the tailored requirements');
assert.doesNotMatch(`${about}\n${appSource}`, /\/assets\/resume\.pdf|solve for deuterium|candidate\s*:?=\s*deuterium|search space:|constraints:|ready to overfit|id="ottersec-(?:work|projects)"/i);
console.log('Resume catalog, base layout, PDF export and collapsed About markup pass.');
