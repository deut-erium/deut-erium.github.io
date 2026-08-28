import { mkdir, writeFile } from 'node:fs/promises';

const origin = 'http://127.0.0.1:4100';
const tabs = await fetch('http://127.0.0.1:9240/json').then((response) => response.json());
const socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
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
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const navigate = async (path) => {
  await send('Page.navigate', { url: `${origin}${path}` });
  await new Promise((resolve) => setTimeout(resolve, 100));
};
const screenshot = async (name) => {
  const data = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(`agent_out/unified-merge/review/browser-fixed/${name}.png`, Buffer.from(data.data, 'base64'));
};

await mkdir('agent_out/unified-merge/review/browser-fixed', { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate('/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html');
await screenshot('writeup-desktop');
await navigate('/assets/index.html');
await screenshot('legacy-profile-desktop');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await navigate('/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html');
await screenshot('writeup-mobile');
await navigate('/WriteUps/404.html');
await screenshot('writeups-404-mobile');

const paths = await fetch(`${origin}/sitemap.xml`).then((response) => response.text()).then((xml) => [...xml.matchAll(/<loc>https:\/\/deut-erium\.github\.io([^<]*)<\/loc>/g)].map((match) => match[1] || '/'));
const shellPaths = paths.filter((path) => !path.startsWith('/new-tetris/') && !/\.(?:pdf|png|jpe?g|gif|svg|ico|txt|py|sage|zip|7z|tar|woff2?)$/i.test(path));
for (const path of ['/404.html', '/WriteUps/404.html', '/ramblings/404.html', '/ctf-tutorials/404.html']) {
  if (!shellPaths.includes(path)) shellPaths.push(path);
}
const failures = [];
for (const path of shellPaths) {
  await navigate(path);
  const geometry = await evaluate(`({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    h1: document.querySelectorAll('h1').length,
    main: document.querySelectorAll('main').length
  })`);
  if (geometry.scroll > geometry.client || geometry.h1 !== 1 || geometry.main !== 1) failures.push({ path, ...geometry });
}
const result = { status: failures.length ? 'fail' : 'pass', width: 390, pages: shellPaths.length, failures };
await writeFile('agent_out/unified-merge/review/viewport-results.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
socket.close();
