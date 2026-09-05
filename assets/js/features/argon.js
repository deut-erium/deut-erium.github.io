/* Encrypted writeups (argon): unlock an AES-256-GCM payload with a flag.
   Loaded only on pages marked body[data-argon] by the locked layout. */
(() => {
'use strict';
const D = document;
if (!D.body || !D.body.hasAttribute('data-argon')) return;
const box = D.querySelector('.argon');
if (!box) return;
const link = D.createElement('link');
link.rel = 'stylesheet';
link.href = '/assets/css/features/argon.css?v=' + (window.__deuteriumAssetVersion || '');
D.head.appendChild(link);

const raw = atob(box.textContent.replace(/\s+/g, ''));
const ct = new Uint8Array(raw.length);
for (let i = 0; i < raw.length; i++) ct[i] = raw.charCodeAt(i);
const needs = box.dataset.needs || '';

/* Cipher block placeholder: the payload bytes as a quiet hex rain. */
const rain = D.createElement('div');
rain.className = 'argon-rain';
rain.setAttribute('aria-hidden', 'true');
for (let i = 0; i < ct.length && rain.children.length < 14; i += 12) {
  const row = D.createElement('span');
  row.className = 'argon-rain__row';
  row.style.setProperty('--i', String(rain.children.length));
  row.textContent = Array.from(ct.slice(i, i + 12), v => v.toString(16).padStart(2, '0')).join(' ');
  rain.appendChild(row);
}
box.appendChild(rain);

/* Unlock controls: input + button only, deliberately no form element. */
const ui = D.createElement('div');
ui.className = 'argon-unlock';
const label = D.createElement('label');
label.htmlFor = 'argon-key';
label.textContent = needs ? 'Unlock with the previous flag' : 'Unlock with the flag';
const input = D.createElement('input');
input.id = 'argon-key';
input.type = 'text';
input.autocomplete = 'off';
input.autocapitalize = 'none';
input.spellcheck = false;
const button = D.createElement('button');
button.type = 'button';
button.textContent = 'Unlock';
const note = D.createElement('p');
note.className = 'argon-note';
note.setAttribute('role', 'status');
note.textContent = 'Client-side lock: the bytes are all on this page, the key is not.';
ui.append(label, input, button, note);
box.after(ui);

const wrong = () => {
  note.textContent = 'wrong key';
  note.classList.add('is-wrong');
  ui.classList.remove('is-shaking');
  void ui.offsetWidth;
  ui.classList.add('is-shaking');
  input.focus();
  input.select();
};
const unlock = async () => {
  const value = input.value.trim();
  if (!value) { wrong(); return; }
  button.disabled = true;
  try {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveKey']);
    const salt = new Uint8Array((box.dataset.salt || '').match(/.{2}/g).map(byte => parseInt(byte, 16)));
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: 120000 }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, key, ct.slice(12));
    box.dataset.state = 'open';
    box.innerHTML = new TextDecoder().decode(plain);
    ui.remove();
    try { sessionStorage.setItem('argon-opened:' + location.pathname, '1'); } catch (_) {}
  } catch (_) {
    wrong();
  } finally {
    button.disabled = false;
  }
};
button.addEventListener('click', unlock);
input.addEventListener('keydown', event => { if (event.key === 'Enter') unlock(); });

/* ARG chain: the challenge engine never ships flags in its events, so a
   solved predecessor only confirms the hint and focuses the input; the
   reader still types the flag. */
const solved = id => { try { return !!JSON.parse(localStorage.getItem('deuterium-solves') || '{}')[id]; } catch (_) { return false; } };
const promptChain = () => {
  if (needs && solved(needs)) {
    note.textContent = 'previous challenge cleared - enter its flag to open';
    note.classList.remove('is-wrong');
    input.focus();
  }
};
D.addEventListener('deuterium:solved', event => {
  if (needs && event.detail && event.detail.id === needs) promptChain();
});
promptChain();
})();
