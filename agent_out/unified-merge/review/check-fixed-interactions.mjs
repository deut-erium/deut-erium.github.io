import { writeFile } from 'node:fs/promises';

const origin = 'http://127.0.0.1:4100';
const pages = await fetch('http://127.0.0.1:9238/json').then((response) => response.json());
const socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const navigate = async (path) => {
  await send('Page.navigate', { url: `${origin}${path}` });
  await new Promise((resolve) => setTimeout(resolve, 350));
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const results = {};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

await send('Emulation.setScriptExecutionDisabled', { value: true });
await navigate('/2021/07/25/injection.html');
results.noJsChallenge = await evaluate(`(() => {
  const form = document.querySelector('[data-flag-check]');
  const input = form.querySelector('[data-flag-input]');
  input.value = 'audit-secret';
  const before = location.href;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { before, after: location.href, disabled: form.querySelector('button').disabled, name: input.getAttribute('name') };
})()`);
assert(results.noJsChallenge.disabled, 'challenge submit remained enabled without JavaScript');
assert(results.noJsChallenge.name === null, 'challenge input retained a serializable name');
assert(results.noJsChallenge.before === results.noJsChallenge.after, 'challenge input entered the URL without JavaScript');

await navigate('/archive.html?tag=RSA');
results.noJsArchive = await evaluate(`({
  toolsHidden: document.querySelector('.js-archive-tools').hidden,
  rows: document.querySelectorAll('[data-record]').length,
  notice: document.querySelector('noscript').textContent.trim()
})`);
assert(results.noJsArchive.toolsHidden, 'archive controls remained visible without JavaScript');
assert(results.noJsArchive.rows === 78, 'no-JavaScript archive lost records');
assert(results.noJsArchive.notice.includes('complete archive'), 'archive no-JavaScript notice missing');

await send('Emulation.setScriptExecutionDisabled', { value: false });
await navigate('/2021/07/25/injection.html');
results.challenge = await evaluate(`(async () => {
  const form = document.querySelector('[data-flag-check]');
  const input = form.querySelector('[data-flag-input]');
  const button = form.querySelector('button');
  const output = form.querySelector('output');
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  input.value = 'wrong'; submit();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const wrongClass = output.className;
  input.value = ''; submit();
  const emptyClass = output.className;
  const emptyText = output.textContent;
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: () => Promise.reject(new DOMException('forced', 'OperationError')) });
  input.value = 'failure'; submit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failureClass = output.className;
  const failureText = output.textContent;
  return { enabled: !button.disabled, wrongClass, emptyClass, emptyText, failureClass, failureText };
})()`, true);
assert(results.challenge.wrongClass.includes('is-wrong'), 'wrong challenge result did not receive its state');
assert(results.challenge.emptyClass === 'flag-check__result', 'empty challenge retained stale state');
assert(results.challenge.emptyText.startsWith('Enter a flag'), 'empty challenge instruction missing');
assert(results.challenge.failureClass === 'flag-check__result', 'digest failure retained stale state');
assert(results.challenge.failureText.startsWith('The local check failed'), 'digest failure was not reported');
assert(results.challenge.enabled, 'challenge button did not recover after digest failure');

await navigate('/2021/07/25/injection.html');
results.challengeRace = await evaluate(`(async () => {
  const form = document.querySelector('[data-flag-check]');
  const input = form.querySelector('[data-flag-input]');
  const output = form.querySelector('output');
  const pending = [];
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: () => new Promise((resolve) => pending.push(resolve)) });
  const submit = (value) => { input.value = value; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
  submit('old'); submit('new');
  const expected = Uint8Array.from(form.dataset.sha256.match(/../g), (byte) => parseInt(byte, 16)).buffer;
  pending[1](new Uint8Array(32).buffer);
  await Promise.resolve(); await Promise.resolve();
  const afterNew = output.textContent;
  pending[0](expected);
  await Promise.resolve(); await Promise.resolve();
  return { afterNew, final: output.textContent, className: output.className };
})()`, true);
assert(results.challengeRace.afterNew.startsWith('Incorrect'), 'new challenge result was not applied');
assert(results.challengeRace.final.startsWith('Incorrect'), 'stale challenge result replaced the current result');
assert(results.challengeRace.className.includes('is-wrong'), 'challenge race ended with the wrong state class');

await navigate('/archive.html?tag=RSA');
results.archive = await evaluate(`({
  toolsHidden: document.querySelector('.js-archive-tools').hidden,
  visible: [...document.querySelectorAll('[data-record]')].filter((row) => !row.hidden).length,
  current: document.querySelectorAll('[data-filter][aria-current="true"]').length
})`);
assert(!results.archive.toolsHidden, 'archive script did not reveal controls');
assert(results.archive.visible === 16, 'RSA archive filter count drifted');
assert(results.archive.current > 0, 'RSA archive filter was not marked current');

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await navigate('/');
await evaluate(`localStorage.setItem('writeups-theme', 'sepia'); location.reload()`);
await new Promise((resolve) => setTimeout(resolve, 350));
const invalidInitial = await evaluate(`({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('writeups-theme') })`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await new Promise((resolve) => setTimeout(resolve, 100));
const invalidChanged = await evaluate(`document.documentElement.dataset.theme`);
results.invalidTheme = { invalidInitial, invalidChanged };
assert(invalidInitial.theme === 'dark' && invalidInitial.stored === null, 'invalid theme was not discarded');
assert(invalidChanged === 'light', 'system theme change remained blocked by invalid storage');

await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
await navigate('/404.html');
results.errorPage = await evaluate(`({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, preOverflow: getComputedStyle(document.querySelector('.code-frame pre')).overflowX })`);
assert(results.errorPage.scroll <= results.errorPage.width, '404 page still has horizontal document overflow');

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate('/2024/01/28/inputrc.html');
await send('Emulation.setEmulatedMedia', { media: 'print' });
results.printCode = await evaluate(`(() => { const node = document.querySelector('.code-frame__viewport > .highlight > pre'); return { width: node.getBoundingClientRect().width, viewport: document.documentElement.clientWidth, display: getComputedStyle(node.closest('.code-frame__viewport')).display }; })()`);
assert(results.printCode.display === 'block', 'print code viewport remained a grid');
assert(results.printCode.width > results.printCode.viewport * 0.7, 'print code remained collapsed');

await writeFile('agent_out/unified-merge/review/fixed-interactions.json', `${JSON.stringify({ status: 'pass', ...results }, null, 2)}\n`);
console.log(JSON.stringify({ status: 'pass', ...results }, null, 2));
socket.close();
