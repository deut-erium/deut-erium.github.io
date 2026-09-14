/* Locked articles: legacy PBKDF2/AES-GCM and authenticated v2 envelopes. */
(() => {
'use strict';
const D = document;
// currentScript is only available during this synchronous invocation.
const scriptSrc = D.currentScript && D.currentScript.src;
if (!D.body || !D.body.hasAttribute('data-argon')) return;
const box = D.querySelector('.argon');
if (!box || box.dataset.argonReady === 'true') return;
box.dataset.argonReady = 'true';
if (scriptSrc) {
  const css = new URL('../../css/features/argon.css', scriptSrc);
  css.searchParams.set('v', window.__deuteriumAssetVersion || '');
  const link = D.createElement('link');
  link.rel = 'stylesheet';
  link.href = css.href;
  D.head.appendChild(link);
}

const MAX_BYTES = 24 * 1024 * 1024; // Includes the 12-byte nonce and 16-byte tag.
const MAX_BASE64 = 4 * Math.ceil(MAX_BYTES / 3);
const FAILURE = 'Could not unlock the article. Check the flag and try again.';
const UNSUPPORTED = 'Unlocking is unavailable. Use an up-to-date browser over HTTPS (or localhost).';
const needs = box.getAttribute('data-needs') || '';

function readEnvelope() {
  const version = box.getAttribute('data-version');
  const iterations = box.getAttribute('data-iterations');
  // Only an entirely unversioned header is legacy. Never infer a downgrade.
  const legacy = version === null && iterations === null;
  if (!legacy && (version !== '2' || iterations !== '200000')) throw new Error('Envelope');
  const saltHex = box.getAttribute('data-salt') || '';
  if (saltHex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(saltHex)) throw new Error('Envelope');
  const text = box.textContent;
  if (text.length > MAX_BASE64 * 2) throw new Error('Envelope');
  // Allow HTML ASCII whitespace for historic wrapped payloads, not Unicode whitespace.
  const encoded = text.replace(/[\t\n\f\r ]/g, '');
  if (!encoded.length || encoded.length > MAX_BASE64 || encoded.length % 4) throw new Error('Envelope');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const body = encoded.slice(0, encoded.length - padding);
  if (/[^A-Za-z0-9+/]/.test(body)) throw new Error('Envelope');
  const size = encoded.length / 4 * 3 - padding;
  if (size < 28 || size > MAX_BYTES) throw new Error('Envelope');
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(body.slice(-1));
  if ((padding === 2 && (last & 15)) || (padding === 1 && (last & 3))) throw new Error('Envelope');
  const raw = atob(encoded); // Validation and bounds precede decoding and WebCrypto.
  if (raw.length !== size) throw new Error('Envelope');
  const cipher = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) cipher[i] = raw.charCodeAt(i);
  const salt = Uint8Array.from(saltHex.match(/../g), byte => parseInt(byte, 16));
  return { cipher, salt, iterations: legacy ? 120000 : 200000,
    aad: legacy ? null : JSON.stringify(['deuterium-argon', 2, 200000, saltHex.toLowerCase(), needs]) };
}

let envelope = null;
try { envelope = readEnvelope(); } catch (_) { /* Malformed input uses the same failure UI. */ }
// Replace visible base64 only in JS. The source remains intact for no-JS readers.
const rain = D.createElement('div');
rain.className = 'argon-rain';
rain.setAttribute('aria-hidden', 'true');
if (envelope) {
  for (let i = 0; i < envelope.cipher.length && rain.children.length < 14; i += 12) {
    const row = D.createElement('span');
    row.className = 'argon-rain__row';
    row.style.setProperty('--i', String(rain.children.length));
    row.textContent = Array.from(envelope.cipher.subarray(i, i + 12), v => v.toString(16).padStart(2, '0')).join(' ');
    rain.appendChild(row);
  }
}
const lockedLabel = D.createElement('p');
lockedLabel.className = 'argon-locked-label';
lockedLabel.textContent = 'Encrypted article';
const metadata = box.hasAttribute('data-chain-position') ? box : D.body;
const position = metadata.getAttribute('data-chain-position') || '';
const length = metadata.getAttribute('data-chain-length') || '';
if (/^[1-9][0-9]{0,5}$/.test(position) && /^[1-9][0-9]{0,5}$/.test(length) && +position <= +length) {
  lockedLabel.textContent += ' - chain step ' + position + ' of ' + length;
}
box.replaceChildren(lockedLabel, rain);
box.dataset.state = 'locked';

const ui = D.createElement('form');
ui.className = 'argon-unlock';
ui.autocomplete = 'off';
const fields = D.createElement('div');
fields.className = 'argon-unlock__fields';
const label = D.createElement('label');
label.htmlFor = 'argon-key';
label.textContent = needs ? 'Unlock with the previous flag' : 'Unlock with the flag';
const input = D.createElement('input');
input.id = 'argon-key';
input.type = 'password';
input.autocomplete = 'off';
input.autocapitalize = 'none';
input.spellcheck = false;
input.setAttribute('aria-describedby', 'argon-note');
const button = D.createElement('button');
button.type = 'submit';
button.textContent = 'Unlock';
fields.append(label, input, button);
const settings = D.createElement('div');
settings.className = 'argon-session';
const rememberLabel = D.createElement('label');
rememberLabel.className = 'argon-session__choice';
const remember = D.createElement('input');
remember.type = 'checkbox';
remember.id = 'argon-remember';
rememberLabel.htmlFor = remember.id;
const rememberText = D.createElement('span');
rememberText.textContent = 'Remember answers in this tab';
rememberLabel.append(remember, rememberText);
const clear = D.createElement('button');
clear.type = 'button';
clear.textContent = 'Clear saved answers and lock';
const lock = D.createElement('button');
lock.type = 'button';
lock.textContent = 'Relock';
settings.append(rememberLabel, clear, lock);
const privacy = D.createElement('p');
privacy.className = 'argon-privacy';
privacy.textContent = 'Optional: other pages on this site can use saved answers in this tab. Relocking does not erase saved answers.';
const note = D.createElement('p');
note.id = 'argon-note';
note.className = 'argon-note';
note.setAttribute('role', 'status');
note.setAttribute('aria-live', 'polite');
ui.append(fields, settings, privacy, note);
box.after(ui);

// Storage may be absent or blocked. It is never required for manual decryption.
const sessionCall = (method, ...args) => {
  try {
    const session = window.DeuteriumChainSession;
    return session && typeof session[method] === 'function' ? session[method](...args) : false;
  } catch (_) { return false; }
};
const sessionEnabled = () => sessionCall('isEnabled') === true;
const syncSession = () => { remember.checked = sessionEnabled(); };
let inflight = false, opened = false, generation = 0, autoSuppressed = false, pageActive = true;
let savingAnswer = false;
const message = (text, wrong = false) => {
  note.textContent = text;
  note.classList.toggle('is-wrong', wrong);
};
const paint = () => {
  fields.hidden = opened;
  input.disabled = inflight || opened;
  button.disabled = inflight || opened;
  button.textContent = inflight ? 'Unlocking...' : 'Unlock';
  lock.hidden = !inflight && !opened;
  lock.textContent = opened ? 'Relock' : 'Cancel unlock';
  box.setAttribute('aria-busy', String(inflight && !opened));
  rain.hidden = opened || D.hidden || !pageActive;
};
const relock = (focus = false) => {
  ++generation;
  autoSuppressed = true;
  opened = false;
  input.value = '';
  box.dataset.state = 'locked';
  box.replaceChildren(lockedLabel, rain);
  paint();
  message('Article locked.');
  if (focus && !inflight) input.focus();
};

async function unlock(value, automatic = false) {
  if (inflight || opened || !pageActive) return;
  if (!value.trim()) { if (!automatic) { message('Enter the flag first.', true); input.focus(); } return; }
  if (!envelope) { message(FAILURE, true); return; }
  if (!globalThis.crypto || !crypto.subtle || typeof crypto.subtle.importKey !== 'function' ||
      typeof crypto.subtle.deriveKey !== 'function' || typeof crypto.subtle.decrypt !== 'function' ||
      typeof TextEncoder !== 'function' || typeof TextDecoder !== 'function') {
    message(UNSUPPORTED, true);
    return;
  }
  inflight = true;
  const ticket = ++generation;
  const current = () => {
    // A clear/forget without an event must also invalidate an automatic attempt.
    const permitted = !automatic || (sessionEnabled() && sessionCall('recall', needs) === value);
    return permitted && ticket === generation && pageActive;
  };
  paint();
  message(automatic ? 'Trying the answer saved in this tab...' : 'Unlocking...');
  let passwordBytes, plaintextBytes;
  try {
    passwordBytes = new TextEncoder().encode(value.trim());
    const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    passwordBytes.fill(0);
    if (!current()) return;
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: envelope.salt,
      iterations: envelope.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    if (!current()) return;
    const algorithm = { name: 'AES-GCM', iv: envelope.cipher.subarray(0, 12), tagLength: 128 };
    if (envelope.aad !== null) algorithm.additionalData = new TextEncoder().encode(envelope.aad);
    plaintextBytes = new Uint8Array(await crypto.subtle.decrypt(algorithm, key, envelope.cipher.subarray(12)));
    if (!current()) return;
    const html = new TextDecoder('utf-8', { fatal: true }).decode(plaintextBytes);
    // Only authenticated, valid UTF-8 reaches this author-trusted HTML sink.
    box.innerHTML = html;
    opened = true;
    box.dataset.state = 'open';
    input.value = '';
    paint();
    message('Article unlocked.');
    if (!automatic && needs) {
      // The shared module can synchronously disable itself when a write fails.
      // That notification must not undo a successful manual decryption. User
      // clear/relock actions still invalidate the ticket, including reentrant ones.
      savingAnswer = true;
      try {
        if (sessionEnabled() && sessionCall('remember', needs, value.trim()) === false && ticket === generation) {
          message('Article unlocked. The answer could not be saved in this tab.');
        }
      } finally { savingAnswer = false; }
    }
    if (!current() || !opened) return; // A synchronous session clear may have relocked it.
    try {
      if (window.DeuteriumChallengeEngine && typeof window.DeuteriumChallengeEngine.init === 'function') {
        window.DeuteriumChallengeEngine.init(box);
      }
    } catch (_) { message('Article unlocked. Private challenge controls could not be initialized.', true); }
  } catch (error) {
    if (current()) message(error && error.name === 'NotSupportedError' ? UNSUPPORTED : FAILURE, true);
  } finally {
    if (passwordBytes) passwordBytes.fill(0);
    if (plaintextBytes) plaintextBytes.fill(0);
    // Relock invalidates the result but keeps the guard until WebCrypto settles.
    inflight = false;
    if (automatic && !opened && ticket === generation && !current()) relock();
    paint();
  }
}

const recall = () => {
  if (!needs || autoSuppressed || inflight || opened || !pageActive || !sessionEnabled()) return;
  const value = sessionCall('recall', needs);
  if (typeof value === 'string' && value.trim()) return unlock(value, true);
};
ui.addEventListener('submit', event => { event.preventDefault(); return unlock(input.value); });
lock.addEventListener('click', () => relock(true));
clear.addEventListener('click', () => {
  relock(true); // Invalidate work and empty the input even if storage throws.
  const result = sessionCall('clear');
  if (sessionEnabled()) sessionCall('setEnabled', false);
  syncSession();
  message(result === false || remember.checked
    ? 'Article locked. Saved answers could not be cleared; tab storage is unavailable.'
    : 'Article locked. Saved answers cleared.');
});
remember.addEventListener('change', () => {
  const enabled = remember.checked;
  if (!enabled) relock();
  else autoSuppressed = false;
  sessionCall('setEnabled', enabled);
  syncSession();
  if (enabled && !remember.checked) message('Tab storage is unavailable. You can still unlock manually.');
  else if (enabled) return recall();
});
D.addEventListener('deuterium:chain-session', event => {
  const wasEnabled = remember.checked;
  syncSession();
  if (savingAnswer) return;
  if (!event.detail || event.detail.enabled !== true || !remember.checked) relock();
  else {
    if (!wasEnabled) autoSuppressed = false;
    return recall();
  }
});
D.addEventListener('deuterium:solved', event => {
  // Progress is editable. Only an opted-in answer followed by GCM verification can open the article.
  if (event.detail && event.detail.id === needs) return recall();
});
D.addEventListener('visibilitychange', paint);
window.addEventListener('pagehide', () => { pageActive = false; relock(); });
window.addEventListener('pageshow', () => { pageActive = true; paint(); });
syncSession();
paint();
if (!envelope) message(FAILURE, true);
else if (!globalThis.crypto || !crypto.subtle || typeof TextDecoder !== 'function' || typeof TextEncoder !== 'function') message(UNSUPPORTED, true);
else recall();
})();
