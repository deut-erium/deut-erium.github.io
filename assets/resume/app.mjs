import { person, compose } from './catalog.mjs';
import { typeset, checkLayout } from './typesetter.mjs';
import { makePDF, renderPreview } from './pdf.mjs';

const $ = id => document.getElementById(id);
let fonts, binaries, currentURL, timer, revision = 0, busy = false, valid = false;
const status = (message, state = 'pending') => {
  $('resume-status').textContent = message;
  $('resume-status').dataset.state = state;
};
const syncButton = () => { $('compile').disabled = !fonts || busy || !valid; };
function invalidateDownload() {
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL = null;
  $('download').hidden = true; $('download').removeAttribute('href');
}
function paint() {
  const model = compose($('request').value);
  const document = typeset(model, person, fonts);
  const issues = checkLayout(document, fonts);
  if (issues.some(issue => !issue.startsWith('Unsupported glyph'))) throw new Error('The text did not fit the page layout.');
  renderPreview(document, fonts, $('preview'));
  $('page-count').textContent = `(${document.pages.length} pages)`;
  valid = true; syncButton();
  return { model, document, issues };
}
function preview() {
  if (!fonts) return;
  try {
    const { model, issues } = paint();
    status(`search space: { deuterium }\nconstraints: ${model.qualifications.length}` +
      (issues.length ? '\nsome glyphs need an additional font' : '\nready to overfit'));
  } catch (error) { valid = false; syncButton(); status(error.message, 'error'); }
}
$('request').addEventListener('input', () => {
  revision++; clearTimeout(timer); invalidateDownload();
  status('constraints changed\nupdating preview...');
  timer = setTimeout(preview, 220);
});
$('resume-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!fonts || busy) return;
  clearTimeout(timer);
  const startedAt = revision;
  busy = true; syncButton(); status('candidate = deuterium\nbuilding resume.pdf...');
  try {
    const { document, issues } = paint();
    const pdf = await makePDF(document, fonts, binaries);
    // Edits during compression invalidate that export instead of publishing
    // a stale download beside the newer preview.
    if (revision !== startedAt) return;
    invalidateDownload();
    currentURL = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    $('download').href = currentURL;
    $('download').download = 'Himanshu-Sheoran-Resume.pdf';
    $('download').hidden = false;
    status(`sat\ncandidate = deuterium\nresume = ${document.pages.length} pages` +
      (issues.length ? '\nsome glyphs need an additional font' : ''), 'sat');
  } catch (error) {
    if (revision === startedAt) { invalidateDownload(); status(`Could not compile: ${error.message}`, 'error'); }
  } finally { busy = false; syncButton(); }
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) { clearTimeout(timer); invalidateDownload(); }
});
async function load() {
  const response = await fetch(new URL('fonts/metrics.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load the PDF fonts. Reload to retry.');
  const metadata = await response.json(), files = {};
  await Promise.all(Object.entries(metadata).map(async ([key, font]) => {
    const response = await fetch(new URL(font.file, import.meta.url));
    if (!response.ok) throw new Error(`Could not load the ${key} PDF font. Reload to retry.`);
    files[key] = await response.arrayBuffer();
    const face = new FontFace(font.name, files[key]);
    await face.load(); document.fonts.add(face);
  }));
  fonts = metadata; binaries = files; preview();
}
load().catch(error => status(error.message, 'error'));
