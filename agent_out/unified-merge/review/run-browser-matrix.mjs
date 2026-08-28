import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4100';
const cdpOrigin = 'http://127.0.0.1:9241';
const siteRoot = path.resolve('_site-next');
const outputRoot = path.resolve('agent_out/unified-merge/review/current-browser');
const pdfRoot = path.join(outputRoot, 'pdf');
await mkdir(pdfRoot, { recursive: true });

async function filesBelow(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(full));
    else found.push(full);
  }
  return found;
}

const htmlFiles = (await filesBelow(siteRoot)).filter((file) => file.endsWith('.html')).sort();
const routes = htmlFiles.map((file) => {
  const relative = path.relative(siteRoot, file).split(path.sep).join('/');
  return relative.endsWith('/index.html') ? `/${relative.slice(0, -'index.html'.length)}` : `/${relative}`;
});
const manifestLines = [];
for (const file of await filesBelow(siteRoot)) {
  const data = await readFile(file);
  manifestLines.push(`${createHash('sha256').update(data).digest('hex')}  ${path.relative(siteRoot, file).split(path.sep).join('/')}`);
}
manifestLines.sort();
const siteManifestSha256 = createHash('sha256').update(`${manifestLines.join('\n')}\n`).digest('hex');

const version = await fetch(`${cdpOrigin}/json/version`).then((response) => response.json());
const tabs = await fetch(`${cdpOrigin}/json`).then((response) => response.json());
const pageTarget = tabs.find((tab) => tab.type === 'page');
if (!pageTarget) throw new Error('No CDP page target');
const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
let events = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  events.push(message);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setViewport = (width, height = 900) => send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});
const navigate = async (route, wait = 120) => {
  events = [];
  const result = await send('Page.navigate', { url: `${origin}${route}` });
  if (result.errorText) throw new Error(`${route}: ${result.errorText}`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(25);
    if (await evaluate('document.readyState === "complete"')) break;
  }
  await sleep(wait);
};
const waitFor = async (expression, timeout = 6000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${expression}`);
};
const badEvents = () => {
  const failures = events.filter((event) => event.method === 'Network.loadingFailed' && !event.params.canceled)
    .map((event) => ({ kind: 'network', error: event.params.errorText, url: event.params.blockedReason || '' }));
  const exceptions = events.filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => ({ kind: 'exception', error: event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text }));
  const consoleErrors = events.filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    .map((event) => ({ kind: 'console', error: event.params.args?.map((arg) => arg.value || arg.description).join(' ') }));
  const external = events.filter((event) => event.method === 'Network.requestWillBeSent').map((event) => event.params.request.url)
    .filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank')
    .map((url) => ({ kind: 'external-request', url }));
  return [...failures, ...exceptions, ...consoleErrors, ...external];
};
const inspectDocument = () => evaluate(`(() => {
  const visible = (node) => node.checkVisibility ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const focusable = (node) => !node.disabled && node.tabIndex >= 0;
  const name = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.querySelector('img')?.alt || '').trim();
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((node) => Number(node.tagName[1]));
  return {
    path: location.pathname,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    visibleH1: [...document.querySelectorAll('h1')].filter(visible).length,
    visibleMain: [...document.querySelectorAll('main')].filter(visible).length,
    duplicateIds: [...document.querySelectorAll('[id]')].map((node) => node.id).filter((id, index, all) => all.indexOf(id) !== index),
    unnamedLinks: [...document.querySelectorAll('a[href]')].filter((node) => visible(node) && focusable(node) && !name(node)).map((node) => node.getAttribute('href')),
    headingJumps: headings.slice(1).map((level, index) => [headings[index], level]).filter(([left, right]) => right > left + 1),
    hiddenFocusable: [...document.querySelectorAll('[hidden] a[href],[hidden] button,[hidden] input,[hidden] select,[hidden] textarea')].filter(visible).length,
  };
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: false });
await send('Accessibility.enable');

const failures = [];
const routeMatrix = [];
const runFullRoutes = process.env.FOCUSED_ONLY !== '1';
for (const width of runFullRoutes ? [320, 1440] : []) {
  await setViewport(width, width < 600 ? 844 : 900);
  await send('Emulation.setScriptExecutionDisabled', { value: false });
  for (const route of routes) {
    try {
      await navigate(route, route.includes('/new-tetris/src/catalog/') ? 300 : 80);
      const state = await inspectDocument();
      const errors = [];
      if (state.scrollWidth > state.clientWidth + 1) errors.push(`overflow ${state.scrollWidth}>${state.clientWidth}`);
      if (state.visibleH1 !== 1) errors.push(`visible H1=${state.visibleH1}`);
      if (state.visibleMain !== 1) errors.push(`visible main=${state.visibleMain}`);
      if (state.duplicateIds.length) errors.push(`duplicate IDs=${state.duplicateIds.join(',')}`);
      if (state.unnamedLinks.length) errors.push(`unnamed links=${state.unnamedLinks.join(',')}`);
      if (state.headingJumps.length) errors.push(`heading jumps=${JSON.stringify(state.headingJumps)}`);
      if (state.hiddenFocusable) errors.push(`visible focusables under hidden=${state.hiddenFocusable}`);
      errors.push(...badEvents().map((error) => JSON.stringify(error)));
      if (errors.length) failures.push({ scenario: 'routes-js', width, route, errors });
      routeMatrix.push({ width, route, finalPath: state.path, status: errors.length ? 'fail' : 'pass' });
      if (routeMatrix.length % 25 === 0) {
        console.error(`JavaScript route checks: ${routeMatrix.length}/${routes.length * 2}`);
        await writeFile(path.join(outputRoot, 'routes-js.partial.json'), `${JSON.stringify(routeMatrix, null, 2)}\n`);
      }
    } catch (error) {
      failures.push({ scenario: 'routes-js', width, route, errors: [error.stack || String(error)] });
    }
  }
}

const noJsMatrix = [];
await setViewport(320, 844);
await send('Emulation.setScriptExecutionDisabled', { value: true });
for (const route of runFullRoutes ? routes : []) {
  try {
    await navigate(route, 50);
    const state = await inspectDocument();
    const errors = [];
    if (state.scrollWidth > state.clientWidth + 1) errors.push(`overflow ${state.scrollWidth}>${state.clientWidth}`);
    if (state.visibleH1 !== 1) errors.push(`visible H1=${state.visibleH1}`);
    if (state.visibleMain !== 1) errors.push(`visible main=${state.visibleMain}`);
    if (state.unnamedLinks.length) errors.push(`unnamed links=${state.unnamedLinks.join(',')}`);
    if (state.headingJumps.length) errors.push(`heading jumps=${JSON.stringify(state.headingJumps)}`);
    errors.push(...badEvents().map((error) => JSON.stringify(error)));
    if (errors.length) failures.push({ scenario: 'routes-no-js', width: 320, route, errors });
    noJsMatrix.push({ route, finalPath: state.path, status: errors.length ? 'fail' : 'pass' });
    if (noJsMatrix.length % 25 === 0) {
      console.error(`No-JavaScript route checks: ${noJsMatrix.length}/${routes.length}`);
      await writeFile(path.join(outputRoot, 'routes-no-js.partial.json'), `${JSON.stringify(noJsMatrix, null, 2)}\n`);
    }
  } catch (error) {
    failures.push({ scenario: 'routes-no-js', width: 320, route, errors: [error.stack || String(error)] });
  }
}

const focusedChecks = {};
await send('Emulation.setScriptExecutionDisabled', { value: false });
await setViewport(390, 844);
await navigate('/new-tetris/');
await waitFor('!document.querySelector("#game-machine").hidden');
focusedChecks.game = await evaluate(`({
  h1: document.querySelectorAll('h1').length,
  main: document.querySelectorAll('main').length,
  machineHidden: document.querySelector('#game-machine').hidden,
  cells: document.querySelectorAll('#board-grid td').length,
  boardName: document.querySelector('#board').getAttribute('aria-label')
})`);
if (focusedChecks.game.h1 !== 1 || focusedChecks.game.main !== 1 || focusedChecks.game.machineHidden || focusedChecks.game.cells !== 200) {
  failures.push({ scenario: 'game-ready', errors: [JSON.stringify(focusedChecks.game)] });
}

await navigate('/new-tetris/src/catalog/');
await waitFor('!document.querySelector("#catalog-machine").hidden');
focusedChecks.catalog = await evaluate(`(() => {
  const selectedSizes = [...document.querySelectorAll('[data-size][aria-pressed="true"]')].map((node) => node.dataset.size);
  const selectedFamilies = [...document.querySelectorAll('[data-family][aria-pressed="true"]')].map((node) => node.dataset.family);
  document.querySelector('.arrangement-data').open = true;
  return {
    h1: document.querySelectorAll('h1').length,
    main: document.querySelectorAll('main').length,
    machineHidden: document.querySelector('#catalog-machine').hidden,
    selectedSizes,
    selectedFamilies,
    gridRows: document.querySelectorAll('#family-grid-body tr').length,
    gridCells: document.querySelectorAll('#family-grid-body td').length,
    boardName: document.querySelector('#family-board').getAttribute('aria-label'),
    caption: document.querySelector('#family-grid-caption').textContent,
  };
})()`);
if (focusedChecks.catalog.h1 !== 1 || focusedChecks.catalog.main !== 1 || focusedChecks.catalog.machineHidden ||
    focusedChecks.catalog.selectedSizes.length !== 1 || focusedChecks.catalog.selectedFamilies.length !== 1 ||
    focusedChecks.catalog.gridRows !== 4 || focusedChecks.catalog.gridCells !== 16 || !focusedChecks.catalog.boardName.includes('step')) {
  failures.push({ scenario: 'catalog-ready', errors: [JSON.stringify(focusedChecks.catalog)] });
}
const catalogTree = await send('Accessibility.getFullAXTree');
focusedChecks.catalogAx = {
  tables: catalogTree.nodes.filter((node) => node.role?.value === 'table').map((node) => node.name?.value),
  unnamedControls: catalogTree.nodes.filter((node) => ['button', 'link', 'textbox', 'combobox'].includes(node.role?.value) && !(node.name?.value || '').trim()).length,
};
if (!focusedChecks.catalogAx.tables.some((name) => name?.includes('arrangement')) || focusedChecks.catalogAx.unnamedControls) {
  failures.push({ scenario: 'catalog-ax', errors: [JSON.stringify(focusedChecks.catalogAx)] });
}

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await navigate('/new-tetris/src/catalog/');
await waitFor('!document.querySelector("#catalog-machine").hidden');
focusedChecks.catalogReducedMotion = await evaluate(`(async () => {
  const step = document.querySelector('#step');
  step.value = '0';
  document.querySelector('#play').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { value: step.value, max: step.max, status: document.querySelector('#catalog-status').textContent };
})()`, true);
if (focusedChecks.catalogReducedMotion.value !== focusedChecks.catalogReducedMotion.max || !focusedChecks.catalogReducedMotion.status.includes('reduced motion')) {
  failures.push({ scenario: 'catalog-reduced-motion', errors: [JSON.stringify(focusedChecks.catalogReducedMotion)] });
}
await send('Emulation.setEmulatedMedia', { features: [] });

await send('Network.setBlockedURLs', { urls: ['*data-4.js*'] });
await navigate('/new-tetris/src/catalog/?failure-test=1', 300);
focusedChecks.catalogFailure = await evaluate(`({
  machineHidden: document.querySelector('#catalog-machine').hidden,
  loadingHidden: document.querySelector('#catalog-loading').hidden,
  message: document.querySelector('#catalog-loading').textContent
})`);
if (!focusedChecks.catalogFailure.machineHidden || focusedChecks.catalogFailure.loadingHidden || !focusedChecks.catalogFailure.message.includes('could not start')) {
  failures.push({ scenario: 'catalog-init-failure', errors: [JSON.stringify(focusedChecks.catalogFailure)] });
}
await send('Network.setBlockedURLs', { urls: [] });

await send('Network.setBlockedURLs', { urls: ['*catalog.js*'] });
await navigate('/new-tetris/src/catalog/?entry-failure-test=1', 400);
focusedChecks.catalogEntryFailure = await evaluate(`({
  machineHidden: document.querySelector('#catalog-machine').hidden,
  loadingHidden: document.querySelector('#catalog-loading').hidden,
  message: document.querySelector('#catalog-loading').textContent
})`);
if (!focusedChecks.catalogEntryFailure.machineHidden || focusedChecks.catalogEntryFailure.loadingHidden || !focusedChecks.catalogEntryFailure.message.includes('could not start')) {
  failures.push({ scenario: 'catalog-entry-failure', errors: [JSON.stringify(focusedChecks.catalogEntryFailure)] });
}
await send('Network.setBlockedURLs', { urls: [] });

await navigate('/new-tetris/src/catalog/?later-failure-test=1');
await waitFor('!document.querySelector("#catalog-machine").hidden');
await send('Network.setBlockedURLs', { urls: ['*data-6.js*'] });
events = [];
focusedChecks.catalogLaterFailure = await evaluate(`(async () => {
  document.querySelector('[data-size="6"]').click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    machineHidden: document.querySelector('#catalog-machine').hidden,
    selectedSizes: [...document.querySelectorAll('[data-size][aria-pressed="true"]')].map((node) => node.dataset.size),
    familyCount: document.querySelectorAll('[data-family]').length,
    familyText: document.querySelector('#family-list').textContent,
    busy: document.querySelector('#family-list').getAttribute('aria-busy'),
    status: document.querySelector('#catalog-status').textContent,
    visibleError: document.querySelector('#catalog-error').textContent,
    errorHidden: document.querySelector('#catalog-error').hidden,
  };
})()`, true);
focusedChecks.catalogLaterFailure.exceptions = events.filter((event) => event.method === 'Runtime.exceptionThrown').length;
if (focusedChecks.catalogLaterFailure.machineHidden || focusedChecks.catalogLaterFailure.selectedSizes.join(',') !== '4' ||
    focusedChecks.catalogLaterFailure.familyCount === 0 || focusedChecks.catalogLaterFailure.familyText.includes('Loading piece mixes') ||
    focusedChecks.catalogLaterFailure.busy !== null || !focusedChecks.catalogLaterFailure.status.includes('could not load') ||
    focusedChecks.catalogLaterFailure.errorHidden || !focusedChecks.catalogLaterFailure.visibleError.includes('try this size again') ||
    focusedChecks.catalogLaterFailure.exceptions !== 0) {
  failures.push({ scenario: 'catalog-later-failure', errors: [JSON.stringify(focusedChecks.catalogLaterFailure)] });
}
await send('Network.setBlockedURLs', { urls: [] });
events = [];
focusedChecks.catalogRecovery = await evaluate(`(async () => {
  document.querySelector('[data-size="6"]').click();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.querySelector('[data-size="6"]').getAttribute('aria-pressed') === 'true') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    selectedSizes: [...document.querySelectorAll('[data-size][aria-pressed="true"]')].map((node) => node.dataset.size),
    familyTotal: document.querySelector('#family-total').textContent,
    familyCount: document.querySelectorAll('[data-family]').length,
    busy: document.querySelector('#family-list').getAttribute('aria-busy'),
    errorHidden: document.querySelector('#catalog-error').hidden,
  };
})()`, true);
focusedChecks.catalogRecovery.retryRequests = events.filter((event) => event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('data-6.js') && event.params.request.url.includes('retry=')).length;
focusedChecks.catalogRecovery.exceptions = events.filter((event) => event.method === 'Runtime.exceptionThrown').length;
if (focusedChecks.catalogRecovery.selectedSizes.join(',') !== '6' || focusedChecks.catalogRecovery.familyTotal !== '1,467' ||
    focusedChecks.catalogRecovery.familyCount === 0 || focusedChecks.catalogRecovery.busy !== null || !focusedChecks.catalogRecovery.errorHidden ||
    focusedChecks.catalogRecovery.retryRequests !== 1 || focusedChecks.catalogRecovery.exceptions !== 0) {
  failures.push({ scenario: 'catalog-recovery', errors: [JSON.stringify(focusedChecks.catalogRecovery)] });
}

await send('Emulation.setScriptExecutionDisabled', { value: true });
for (const [name, route, machine] of [
  ['gameNoJs', '/new-tetris/', '#game-machine'],
  ['catalogNoJs', '/new-tetris/src/catalog/', '#catalog-machine'],
]) {
  await navigate(route);
  focusedChecks[name] = await evaluate(`(() => {
    const visible = (node) => node.checkVisibility ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    return {
      h1: [...document.querySelectorAll('h1')].filter(visible).length,
      main: [...document.querySelectorAll('main')].filter(visible).length,
      machineHidden: document.querySelector('${machine}').hidden,
      visibleControls: [...document.querySelectorAll('${machine} button,${machine} input,${machine} select')].filter(visible).length,
      notice: document.querySelector('noscript').textContent.trim(),
    };
  })()`);
  if (focusedChecks[name].h1 !== 1 || focusedChecks[name].main !== 1 || !focusedChecks[name].machineHidden || focusedChecks[name].visibleControls !== 0) {
    failures.push({ scenario: name, errors: [JSON.stringify(focusedChecks[name])] });
  }
}

await send('Emulation.setScriptExecutionDisabled', { value: false });
await send('Emulation.setEmulatedMedia', { media: 'print' });
for (const [name, route, selector, expected] of [
  ['rootPrint', '/', '.record-list > li', 8],
  ['writeupsPrint', '/WriteUps/', '.record-list > li', 8],
  ['archivePrint', '/archive.html', '[data-record]', 78],
]) {
  await navigate(route);
  focusedChecks[name] = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('${selector}')];
    return {
      count: nodes.length,
      visible: nodes.filter((node) => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0).length,
      skipLinkDisplay: getComputedStyle(document.querySelector('.skip-link')).display,
    };
  })()`);
  if (focusedChecks[name].count !== expected || focusedChecks[name].visible !== expected || focusedChecks[name].skipLinkDisplay !== 'none') {
    failures.push({ scenario: name, errors: [JSON.stringify(focusedChecks[name])] });
  }
}
await navigate('/new-tetris/');
focusedChecks.gamePrint = await evaluate(`({
  machineDisplay: getComputedStyle(document.querySelector('#game-machine')).display,
  noticeDisplay: getComputedStyle(document.querySelector('.print-only')).display
})`);
if (focusedChecks.gamePrint.machineDisplay !== 'none' || focusedChecks.gamePrint.noticeDisplay === 'none') {
  failures.push({ scenario: 'gamePrint', errors: [JSON.stringify(focusedChecks.gamePrint)] });
}
await navigate('/new-tetris/src/catalog/', 400);
focusedChecks.catalogPrint = await evaluate(`({
  filtersDisplay: getComputedStyle(document.querySelector('.filters')).display,
  indexDisplay: getComputedStyle(document.querySelector('.family-index')).display,
  arrangementDisplay: getComputedStyle(document.querySelector('.arrangement-scroll')).display
})`);
if (focusedChecks.catalogPrint.filtersDisplay !== 'none' || focusedChecks.catalogPrint.indexDisplay !== 'none' || focusedChecks.catalogPrint.arrangementDisplay === 'none') {
  failures.push({ scenario: 'catalogPrint', errors: [JSON.stringify(focusedChecks.catalogPrint)] });
}
await send('Emulation.setEmulatedMedia', { media: '', features: [] });

const spacingRoutes = ['/', '/archive.html', '/2024/01/28/inputrc.html', '/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html', '/new-tetris/', '/new-tetris/src/catalog/', '/new-tetris/src/scoring/'];
await setViewport(320, 844);
for (const route of process.env.SKIP_SPACING === '1' ? [] : spacingRoutes) {
  await navigate(route, route.includes('catalog') ? 300 : 100);
  await evaluate(`(() => { const style = document.createElement('style'); style.id = 'audit-spacing'; style.textContent = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}'; document.head.append(style); })()`);
  const state = await inspectDocument();
  if (state.scrollWidth > state.clientWidth + 1) failures.push({ scenario: 'text-spacing', route, errors: [`overflow ${state.scrollWidth}>${state.clientWidth}`] });
}

const pdfSpecs = [
  ['curvy-decryptor', '/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html'],
  ['root-home', '/'],
  ['writeups-home', '/WriteUps/'],
  ['inputrc', '/2024/01/28/inputrc.html'],
  ['n95', '/WriteUps/2020/HSCTF/miscellaneous/N-95/2020-06-06-HSCTF-2020-Misc-N95.html'],
  ['archive', '/archive.html'],
  ['error', '/404.html'],
  ['new-tetris-game', '/new-tetris/'],
  ['new-tetris-catalog', '/new-tetris/src/catalog/'],
  ['new-tetris-scoring', '/new-tetris/src/scoring/'],
];
const pdfs = [];
await setViewport(1280, 900);
for (const [name, route] of process.env.SKIP_PDFS === '1' ? [] : pdfSpecs) {
  try {
    await navigate(route, route.includes('catalog') ? 400 : 180);
    await evaluate('document.fonts.ready.then(() => true)', true);
    let result;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        result = await send('Page.printToPDF', {
          landscape: false,
          displayHeaderFooter: false,
          printBackground: false,
          preferCSSPageSize: false,
          generateTaggedPDF: false,
          generateDocumentOutline: false,
          paperWidth: 8.27,
          paperHeight: 11.69,
          marginTop: 0.5,
          marginBottom: 0.5,
          marginLeft: 0.5,
          marginRight: 0.5,
        });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await sleep(500);
      }
    }
    const bytes = Buffer.from(result.data, 'base64');
    const file = path.join(pdfRoot, `${name}.pdf`);
    await writeFile(file, bytes);
    const pageCount = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    pdfs.push({ name, route, file: path.relative(outputRoot, file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pages: pageCount });
    if (!pageCount || bytes.length < 1000) failures.push({ scenario: 'pdf', route, errors: [`bytes=${bytes.length} pages=${pageCount}`] });
  } catch (error) {
    failures.push({ scenario: 'pdf', route, errors: [error.stack || String(error)] });
  }
}

const result = {
  status: failures.length ? 'fail' : 'pass',
  sourceCommit: '4f6909c',
  siteManifestSha256,
  browser: version.Browser,
  protocolVersion: version['Protocol-Version'],
  htmlRoutes: routes.length,
  routeChecksWithJavaScript: routeMatrix.length,
  routeChecksWithoutJavaScript: noJsMatrix.length,
  widths: [320, 1440],
  focusedChecks,
  pdfs,
  failures,
};
await writeFile(path.join(outputRoot, 'matrix.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'routes-js.json'), `${JSON.stringify(routeMatrix, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'routes-no-js.json'), `${JSON.stringify(noJsMatrix, null, 2)}\n`);
console.log(JSON.stringify({ ...result, focusedChecks: undefined, pdfs: pdfs.map(({ name, pages, bytes }) => ({ name, pages, bytes })), failures: failures.slice(0, 20) }, null, 2));
socket.close();
if (failures.length) process.exitCode = 1;
