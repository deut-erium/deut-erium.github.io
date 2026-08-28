import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4100';
const cdpOrigin = 'http://127.0.0.1:9241';
const siteRoot = path.resolve('_site-next');
const outputRoot = path.resolve('agent_out/unified-merge/review/current-browser');
const pdfRoot = path.join(outputRoot, 'pdf');
await mkdir(pdfRoot, { recursive: true });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const siteManifest = execFileSync('python3', ['script/artifact_manifest.py', siteRoot]);
const siteManifestSha256 = createHash('sha256').update(siteManifest).digest('hex');
const version = await fetch(`${cdpOrigin}/json/version`).then((response) => response.json());
const specs = [
  ['curvy-decryptor', '/WriteUps/2023/nullcon_hackim/crypto/curvy_decryptor/2023-08-21-Nullcon-HackIM-Curvy-Decryptor.html'],
  ['root-home', '/'],
  ['about', '/about.html'],
  ['writeups-home', '/WriteUps/'],
  ['inputrc', '/2024/01/28/inputrc.html'],
  ['n95', '/WriteUps/2020/HSCTF/miscellaneous/N-95/2020-06-06-HSCTF-2020-Misc-N95.html'],
  ['archive', '/archive.html'],
  ['error', '/404.html'],
  ['new-tetris-game', '/new-tetris/'],
  ['new-tetris-catalog', '/new-tetris/src/catalog/'],
  ['new-tetris-scoring', '/new-tetris/src/scoring/'],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timed = (promise, label, ms = 60000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)),
]);

async function openClient() {
  const target = await fetch(`${cdpOrigin}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
    const result = await timed(send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }), 'evaluation');
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await timed(send('Page.enable'), 'Page.enable');
  await timed(send('Runtime.enable'), 'Runtime.enable');
  return { target, socket, send, evaluate };
}
async function closeClient(client) {
  if (!client) return;
  client.socket.close();
  await fetch(`${cdpOrigin}/json/close/${client.target.id}`, { method: 'PUT' }).catch(() => {});
}

const rows = [];
const failures = [];
for (const [name, route] of specs) {
  let completed = false;
  for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
    let client;
    try {
      client = await openClient();
      const navigation = await timed(client.send('Page.navigate', { url: `${origin}${route}` }), 'navigation');
      if (navigation.errorText) throw new Error(navigation.errorText);
      await sleep(route.includes('/new-tetris/') ? 1800 : 1000);
      await client.evaluate('document.fonts.ready.then(() => true)', true);
      const result = await timed(client.send('Page.printToPDF', {
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
      }), 'printing');
      const bytes = Buffer.from(result.data, 'base64');
      const file = path.join(pdfRoot, `${name}.pdf`);
      await writeFile(file, bytes);
      const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      if (!pages || bytes.length < 1000) throw new Error(`invalid PDF bytes=${bytes.length} pages=${pages}`);
      rows.push({ name, route, file: path.relative(outputRoot, file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pages });
      completed = true;
      console.error(`${name}: ${pages} pages, ${bytes.length} bytes`);
    } catch (error) {
      if (attempt === 2) failures.push({ name, route, error: error.stack || String(error) });
    } finally {
      await closeClient(client);
    }
  }
}
const result = {
  status: failures.length ? 'fail' : 'pass',
  sourceCommit,
  siteManifestSha256,
  browser: version.Browser,
  pageSize: 'A4',
  printBackground: false,
  files: rows,
  failures,
};
await writeFile(path.join(outputRoot, 'pdf-manifest.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
