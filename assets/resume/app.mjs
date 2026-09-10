import { person, compose } from './catalog.mjs';
import { typeset, checkLayout } from './typesetter.mjs';
import { makePDF, renderPreview } from './pdf.mjs';

const $ = id => document.getElementById(id);
const details = $('resume-details');
let fonts, binaries, currentURL, timer, loadPromise;
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
function paint() {
  const model = compose($('request').value);
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
function readyMessage(model, issues, exported = false) {
  const message = exported
    ? (model.qualifications.length ? 'Tailored PDF ready.' : 'Base resume ready to download.')
    : (model.qualifications.length ? 'Preview updated.' : 'Base resume ready.');
  return issues.length ? `${message} Some characters need an additional font.` : message;
}
function preview() {
  if (!fonts) return;
  try {
    const { model, issues } = paint();
    status(readyMessage(model, issues), 'ready');
  } catch (error) {
    valid = false;
    syncButton();
    status(error.message, 'error');
  }
}
async function exportPDF(automatic = false) {
  if (!fonts || busy) return;
  clearTimeout(timer);
  const startedAt = revision;
  busy = true;
  syncButton();
  status(automatic ? 'Preparing the base PDF...' : 'Building the tailored PDF...');
  try {
    const { model, document, issues } = paint();
    const pdf = await makePDF(document, fonts, binaries);
    // Input entered during compression invalidates the older export.
    if (revision !== startedAt) return;
    invalidateDownload();
    currentURL = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    $('download').href = currentURL;
    $('download').download = 'Himanshu-Sheoran-Resume.pdf';
    $('download').hidden = false;
    status(readyMessage(model, issues, true), 'ready');
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
  clearTimeout(timer);
  invalidateDownload();
  status('Updating the preview...');
  timer = setTimeout(preview, 220);
});
$('resume-form').addEventListener('submit', event => {
  event.preventDefault();
  exportPDF();
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    clearTimeout(timer);
    invalidateDownload();
  }
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
  preview();
  await exportPDF(true);
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
