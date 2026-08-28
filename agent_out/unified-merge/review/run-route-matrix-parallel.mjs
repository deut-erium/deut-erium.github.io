import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4100';
const cdpOrigin = 'http://127.0.0.1:9241';
const siteRoot = path.resolve('_site-next');
const outputRoot = path.resolve('agent_out/unified-merge/review/current-browser');
const concurrency = Number(process.env.CONCURRENCY || (process.env.RESUME === '1' ? 2 : 6));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error('invalid CONCURRENCY');
await mkdir(outputRoot, { recursive: true });

async function filesBelow(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(full));
    else found.push(full);
  }
  return found;
}
const siteFiles = (await filesBelow(siteRoot)).sort();
const htmlFiles = siteFiles.filter((file) => file.endsWith('.html'));
const routes = htmlFiles.map((file) => {
  const relative = path.relative(siteRoot, file).split(path.sep).join('/');
  return relative.endsWith('/index.html') ? `/${relative.slice(0, -'index.html'.length)}` : `/${relative}`;
});
const desktopRoutes = [
  '/', '/archive.html', '/about.html', '/404.html', '/WriteUps/', '/WriteUps/archive.html',
  '/ramblings/', '/ctf-tutorials/', '/2024/01/28/inputrc.html',
  '/WriteUps/2020/HSCTF/miscellaneous/N-95/2020-06-06-HSCTF-2020-Misc-N95.html',
  '/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html',
  '/new-tetris/', '/new-tetris/src/catalog/', '/new-tetris/src/scoring/',
];
let tasks = [
  ...routes.map((route) => ({ route, width: 320, javaScript: true })),
  ...routes.map((route) => ({ route, width: 320, javaScript: false })),
  ...desktopRoutes.map((route) => ({ route, width: 1440, javaScript: true })),
];
let initialResults = [];
if (process.env.RESUME === '1') {
  initialResults = JSON.parse(await readFile(path.join(outputRoot, 'route-matrix.partial.json'), 'utf8'));
  const completedKeys = new Set(initialResults.map((item) => `${item.route}\n${item.width}\n${item.javaScript}`));
  tasks = tasks.filter((item) => !completedKeys.has(`${item.route}\n${item.width}\n${item.javaScript}`));
}
const totalChecks = initialResults.length + tasks.length;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const siteManifest = execFileSync('python3', ['script/artifact_manifest.py', siteRoot]);
const siteManifestSha256 = createHash('sha256').update(siteManifest).digest('hex');
const version = await fetch(`${cdpOrigin}/json/version`).then((response) => response.json());

class Client {
  constructor(socket, target) {
    this.socket = socket;
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else {
        this.events.push(message);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}
async function openClient() {
  const target = await fetch(`${cdpOrigin}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const client = new Client(socket, target);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: false });
  return client;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timed = (promise, label, ms = 10000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)),
]);
const inspectExpression = `(() => {
  const visible = (node) => node.checkVisibility ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const focusable = (node) => !node.disabled && node.tabIndex >= 0;
  const name = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.querySelector('img')?.alt || '').trim();
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((node) => Number(node.tagName[1]));
  return {
    path: location.pathname,
    ready: document.readyState,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    visibleH1: [...document.querySelectorAll('h1')].filter(visible).length,
    visibleMain: [...document.querySelectorAll('main')].filter(visible).length,
    duplicateIds: [...document.querySelectorAll('[id]')].map((node) => node.id).filter((id, index, all) => all.indexOf(id) !== index),
    unnamedLinks: [...document.querySelectorAll('a[href]')].filter((node) => visible(node) && focusable(node) && !name(node)).map((node) => node.getAttribute('href')),
    headingJumps: headings.slice(1).map((level, index) => [headings[index], level]).filter(([left, right]) => right > left + 1),
  };
})()`;

let nextTask = 0;
let completed = initialResults.length;
const results = [...initialResults];
const failures = [];
async function closeClient(client) {
  if (!client) return;
  client.socket.close();
  await fetch(`${cdpOrigin}/json/close/${client.target.id}`, { method: 'PUT' }).catch(() => {});
}
async function worker(number) {
  let client = await openClient();
  let lastWidth = null;
  let lastScript = null;
  try {
    while (true) {
      const taskIndex = nextTask++;
      if (taskIndex >= tasks.length) break;
      const task = tasks[taskIndex];
      let errors = [];
      let state = null;
      for (let attempt = 1; attempt <= 3 && !state; attempt += 1) {
        try {
          if (lastWidth !== task.width) {
            await timed(client.send('Emulation.setDeviceMetricsOverride', { width: task.width, height: task.width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: false }), 'viewport');
            lastWidth = task.width;
          }
          if (lastScript !== task.javaScript) {
            await timed(client.send('Emulation.setScriptExecutionDisabled', { value: !task.javaScript }), 'script mode');
            lastScript = task.javaScript;
          }
          client.events = [];
          const nav = await timed(client.send('Page.navigate', { url: `${origin}${task.route}` }), 'navigation');
          if (nav.errorText) throw new Error(nav.errorText);
          await sleep(350 + attempt * 100);
          state = await timed(client.evaluate(inspectExpression), 'inspection');
        } catch (error) {
          errors = [`attempt ${attempt}: ${error.stack || String(error)}`];
          await closeClient(client);
          client = await openClient();
          lastWidth = null;
          lastScript = null;
        }
      }
      if (state) {
        errors = [];
        if (state.scrollWidth > state.clientWidth + 1) errors.push(`overflow ${state.scrollWidth}>${state.clientWidth}`);
        if (state.visibleH1 !== 1) errors.push(`visible H1=${state.visibleH1}`);
        if (state.visibleMain !== 1) errors.push(`visible main=${state.visibleMain}`);
        if (state.duplicateIds.length) errors.push(`duplicate IDs=${state.duplicateIds.join(',')}`);
        if (state.unnamedLinks.length) errors.push(`unnamed links=${state.unnamedLinks.join(',')}`);
        if (state.headingJumps.length) errors.push(`heading jumps=${JSON.stringify(state.headingJumps)}`);
        const eventErrors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown')
          .map((event) => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text);
        const consoleErrors = client.events.filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
          .map((event) => event.params.args?.map((arg) => arg.value || arg.description).join(' '));
        const external = client.events.filter((event) => event.method === 'Network.requestWillBeSent')
          .map((event) => event.params.request.url)
          .filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank');
        errors.push(...eventErrors.map((error) => `exception: ${error}`), ...consoleErrors.map((error) => `console: ${error}`), ...external.map((url) => `external request: ${url}`));
        results.push({ ...task, finalPath: state.path, status: errors.length ? 'fail' : 'pass' });
      } else {
        results.push({ ...task, status: 'error' });
      }
      if (errors.length) failures.push({ ...task, errors });
      completed += 1;
      if (completed % 25 === 0 || completed === totalChecks) {
        console.error(`Route checks: ${completed}/${totalChecks}`);
        await writeFile(path.join(outputRoot, 'route-matrix.partial.json'), `${JSON.stringify(results, null, 2)}\n`);
      }
    }
  } finally {
    await closeClient(client);
  }
}
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
results.sort((left, right) => Number(right.javaScript) - Number(left.javaScript) || left.width - right.width || left.route.localeCompare(right.route));
const result = {
  status: failures.length ? 'fail' : 'pass',
  sourceCommit,
  siteManifestSha256,
  browser: version.Browser,
  htmlRoutes: routes.length,
  workers: concurrency,
  checks: results.length,
  scenarios: {
    javascript320: results.filter((item) => item.javaScript && item.width === 320).length,
    javascript1440Representative: results.filter((item) => item.javaScript && item.width === 1440).length,
    noJavaScript320: results.filter((item) => !item.javaScript && item.width === 320).length,
  },
  failures,
};
await writeFile(path.join(outputRoot, 'route-matrix.json'), `${JSON.stringify({ ...result, results }, null, 2)}\n`);
console.log(JSON.stringify({ ...result, failures: failures.slice(0, 30) }, null, 2));
if (failures.length) process.exitCode = 1;
