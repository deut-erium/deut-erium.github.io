import { writeFile } from 'node:fs/promises';

const tabs = await fetch('http://127.0.0.1:9239/json').then((response) => response.json());
const socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const events = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else {
    events.push(message);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const navigate = async () => {
  await send('Page.navigate', { url: 'http://127.0.0.1:4100/new-tetris/' });
  await new Promise((resolve) => setTimeout(resolve, 700));
};
const assert = (value, message) => { if (!value) throw new Error(message); };

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Accessibility.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await navigate();

const ready = await evaluate(`({
  machineHidden: document.querySelector('#game-machine').hidden,
  loadingHidden: document.querySelector('#game-loading').hidden,
  rows: document.querySelectorAll('#board-grid tr').length,
  cells: document.querySelectorAll('#board-grid td').length,
  boardState: document.querySelector('#board-state').textContent,
  boardLabel: document.querySelector('#board').getAttribute('aria-label'),
  holdLabel: document.querySelector('#hold').getAttribute('aria-label'),
  nextLabel: document.querySelector('#next').getAttribute('aria-label')
})`);
assert(!ready.machineHidden && ready.loadingHidden, 'game readiness state is wrong');
assert(ready.rows === 20 && ready.cells === 200, 'accessible board dimensions are wrong');
assert(ready.boardState.includes('Active piece') && ready.boardState.includes('Next pieces'), 'board summary is incomplete');
assert(ready.boardLabel.includes('Active piece'), 'board canvas label is static');
assert(ready.holdLabel.includes('Held piece:'), 'hold label is static');
assert(ready.nextLabel.includes('Next pieces:'), 'queue label is static');

const before = ready.boardState;
await evaluate(`document.querySelector('[data-action="hardDrop"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 100));
const after = await evaluate(`({
  pieces: document.querySelector('#pieces').textContent,
  boardState: document.querySelector('#board-state').textContent,
  announcement: document.querySelector('#game-announcement').textContent,
  occupied: [...document.querySelectorAll('#board-grid td')].filter((cell) => cell.textContent !== 'empty').length
})`);
assert(after.pieces === '1', 'hard drop did not place one piece');
assert(after.boardState !== before && after.occupied > 0, 'accessible board did not update');
assert(after.announcement.includes('New'), 'piece event was not announced');

const tree = await send('Accessibility.getFullAXTree');
const roles = tree.nodes.map((node) => node.role?.value);
const tableNames = tree.nodes.filter((node) => node.role?.value === 'table').map((node) => node.name?.value);
assert(tableNames.includes('Current board cells'), 'accessible board table is absent from the AX tree');
assert(roles.filter((role) => role === 'cell').length >= 200, 'accessible board cells are absent from the AX tree');

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const motion = await evaluate(`(() => {
  const flash = document.querySelector('#square-flash');
  flash.classList.add('fire');
  const style = getComputedStyle(flash);
  return { animation: style.animationName, transform: style.transform };
})()`);
assert(motion.animation === 'none' && motion.transform === 'none', 'reduced motion did not suppress the square flash');

await send('Emulation.setScriptExecutionDisabled', { value: true });
await navigate();
const noJs = await evaluate(`({
  machineHidden: document.querySelector('#game-machine').hidden,
  notice: document.querySelector('noscript').textContent.trim(),
  controlsVisible: [...document.querySelectorAll('#game-machine button')].some((button) => button.getClientRects().length > 0),
  noticeY: document.querySelector('noscript').getBoundingClientRect().top
})`);
assert(noJs.machineHidden && !noJs.controlsVisible, 'dead controls remain available without JavaScript');
assert(noJs.notice.startsWith('This game needs JavaScript'), 'no-JavaScript notice is missing');
assert(noJs.noticeY < 300, 'no-JavaScript notice appears after the game');

const failed = events.filter((message) => message.method === 'Network.loadingFailed' && !message.params.canceled);
const exceptions = events.filter((message) => message.method === 'Runtime.exceptionThrown');
assert(failed.length === 0, `network failures: ${failed.length}`);
assert(exceptions.length === 0, `runtime exceptions: ${exceptions.length}`);

const result = { status: 'pass', ready, after, tableNames, accessibleCells: roles.filter((role) => role === 'cell').length, motion, noJs };
await writeFile('agent_out/unified-merge/review/tetris-accessibility.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
socket.close();
