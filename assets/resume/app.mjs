import { person, compose } from './catalog.mjs';
import { typeset, checkLayout } from './typesetter.mjs';
import { makePDF, renderPreview } from './pdf.mjs';

const $ = id => document.getElementById(id);
const details = $('resume-details');
let fonts, binaries, currentURL, loadPromise;
let revision = 0, busy = false, valid = false;

const status = (message, state = 'pending') => {
  $('resume-status').textContent = message;
  $('resume-status').dataset.state = state;
};
const syncButton = () => { $('compile').disabled = !fonts || busy || !valid; };
function invalidateDownload() {
  if (currentURL) URL.revokeObjectURL(currentURL);
  currentURL = null;
  $('download').hidden = true;
  $('download').removeAttribute('href');
}
function paint(request) {
  const model = compose(request);
  const document = typeset(model, person, fonts);
  const issues = checkLayout(document, fonts);
  if (issues.some(issue => !issue.startsWith('Unsupported glyph'))) {
    throw new Error('The text did not fit the page layout.');
  }
  renderPreview(document, fonts, $('preview'));
  $('page-count').textContent = `(${document.pages.length} pages)`;
  valid = true;
  syncButton();
  return { model, document, issues };
}
function readyMessage(model, document, issues, initial) {
  const tailored = model.qualifications.length > 0;
  let message = tailored
    ? `Tailored PDF ready: ${document.pages.length} pages with ${model.qualifications.length} added qualifications.`
    : `Base resume ready: ${document.pages.length} pages.`;
  if (initial) message += ' Build the tailored PDF to apply the requirements above.';
  if (issues.length) message += ' Some characters need an additional font.';
  return message;
}
async function exportPDF(request, initial = false) {
  if (!fonts || busy) return;
  const startedAt = revision;
  busy = true;
  syncButton();
  status(initial ? 'Preparing the base resume...' : 'Building the tailored PDF...');
  try {
    const { model, document, issues } = paint(request);
    const pdf = await makePDF(document, fonts, binaries);
    // Input entered during compression invalidates the older export.
    if (revision !== startedAt) return;
    invalidateDownload();
    currentURL = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    const tailored = model.qualifications.length > 0;
    $('download').href = currentURL;
    $('download').download = 'Himanshu-Sheoran-Resume.pdf';
    $('download').textContent = tailored ? 'Download tailored resume' : 'Download base resume';
    $('download').hidden = false;
    $('compile').textContent = tailored ? 'Rebuild tailored PDF' : 'Build tailored PDF';
    $('preview').scrollTop = tailored ? $('preview').scrollHeight : 0;
    status(readyMessage(model, document, issues, initial), 'ready');
  } catch (error) {
    if (revision === startedAt) {
      invalidateDownload();
      status(`Could not build the PDF: ${error.message}`, 'error');
    }
  } finally {
    busy = false;
    syncButton();
  }
}

$('request').addEventListener('input', () => {
  revision++;
  invalidateDownload();
  valid = Boolean(fonts);
  $('compile').textContent = 'Build tailored PDF';
  syncButton();
  status('Requirements changed. Build the tailored PDF to apply them.');
});
$('resume-form').addEventListener('submit', event => {
  event.preventDefault();
  exportPDF($('request').value);
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) invalidateDownload();
});

async function load() {
  status('Preparing the resume...');
  const response = await fetch(new URL('fonts/metrics.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load the PDF fonts. Reload to retry.');
  const metadata = await response.json();
  const files = {};
  await Promise.all(Object.entries(metadata).map(async ([key, font]) => {
    const response = await fetch(new URL(font.file, import.meta.url));
    if (!response.ok) throw new Error(`Could not load the ${key} PDF font. Reload to retry.`);
    files[key] = await response.arrayBuffer();
    const face = new FontFace(font.name, files[key]);
    await face.load();
    document.fonts.add(face);
  }));
  fonts = metadata;
  binaries = files;
  valid = true;
  syncButton();
  await exportPDF('', true);
}
function start() {
  if (loadPromise) return;
  loadPromise = load().catch(error => {
    valid = false;
    syncButton();
    status(error.message, 'error');
  });
}
details.addEventListener('toggle', () => {
  if (details.open) start();
});
if (details.open) start();
