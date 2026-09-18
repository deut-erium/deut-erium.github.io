/* Local SHA-256 checkers and editable, answer-free progress. */
(() => {
'use strict';
if (window.DeuteriumChallengeEngine) { window.DeuteriumChallengeEngine.init(document); return; }
const D = document, K = 'deuterium-solves', A = 'deuterium-attempts', H = 'deuterium-hints';
const M = 'deuterium-challenge-mute', P = 'flag-check__', T = ' \u2713', ce = t => D.createElement(t);
const MAX_RECORDS = 2048, MAX_JSON = 1024 * 1024, MAX_COUNT = Number.MAX_SAFE_INTEGER;
const dict = () => Object.create(null);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)
  && !['__proto__', 'prototype', 'constructor'].includes(id);
const dateOK = at => {
  if (typeof at !== 'string') return false;
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/.exec(at);
  if (!parts) return false;
  const calendar = parts[1] + '.' + (parts[2] || '').padEnd(3, '0') + 'Z';
  const localTime = Date.parse(calendar), time = Date.parse(at);
  return Number.isFinite(localTime) && new Date(localTime).toISOString() === calendar
    && Number.isFinite(time) && time >= 0 && time <= Date.now() + 300000;
};
const countOK = n => Number.isSafeInteger(n) && n >= 0;
const hintsOK = h => Array.isArray(h) && h.length <= 3 && h.every(n => Number.isInteger(n) && n >= 1 && n <= 3)
  && new Set(h).size === h.length;
const getRaw = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const get = (k, fallback) => {
  try { const raw = getRaw(k); return raw !== null && raw.length <= MAX_JSON ? JSON.parse(raw) : fallback; }
  catch (_) { return fallback; }
};
const solveRecord = value => {
  const at = typeof value === 'string' ? value : record(value) ? value.at : null;
  if (!dateOK(at)) return null;
  // Legacy flags are discarded, never used to seed the optional tab session.
  return { at, verified: record(value) && !Object.hasOwn(value, 'flag') && value.verified === true };
};
const cleanMap = (value, kind) => {
  const out = dict();
  if (!record(value)) return out;
  for (const [id, v] of Object.entries(value).slice(0, MAX_RECORDS)) {
    if (!idOK(id)) continue;
    if (kind === K) { const r = solveRecord(v); if (r) out[id] = r; }
    else if (kind === A && countOK(v)) out[id] = v;
    else if (kind === H && hintsOK(v)) out[id] = [...v].sort();
  }
  return out;
};
const readMap = kind => {
  const raw = getRaw(kind);
  let parsed;
  try { parsed = raw !== null && raw.length <= MAX_JSON ? JSON.parse(raw) : null; } catch (_) { parsed = null; }
  const clean = cleanMap(parsed, kind);
  // Scrub all legacy answers, including records unrelated to this page.
  if (raw !== null && raw !== JSON.stringify(clean) && !put(kind, clean)) {
    // If a quota error prevents migration, try deleting the legacy payload.
    try { localStorage.removeItem(kind); } catch (_) { /* Blocked storage cannot be repaired here. */ }
  }
  return clean;
};
const memory = { [K]: dict(), [A]: dict(), [H]: dict() };
const betterSolve = (a, b) => !a ? b : !b ? a : a.verified !== b.verified ? (a.verified ? a : b)
  : Date.parse(a.at) <= Date.parse(b.at) ? a : b;
const refresh = kind => {
  const disk = readMap(kind), prior = memory[kind];
  for (const [id, v] of Object.entries(prior)) {
    if (!Object.hasOwn(disk, id) && Object.keys(disk).length >= MAX_RECORDS) continue;
    if (kind === A) disk[id] = Math.max(disk[id] ?? 0, v);
    else if (kind === H) disk[id] = [...new Set([...(disk[id] || []), ...v])].sort();
    else disk[id] = betterSolve(disk[id], v);
  }
  memory[kind] = disk;
  return disk;
};
const room = (map, id) => Object.hasOwn(map, id) || Object.keys(map).length < MAX_RECORDS;
const increment = id => {
  const map = refresh(A);
  if (!room(map, id)) throw new Error('Progress record limit reached');
  const count = Math.min(MAX_COUNT, (map[id] ?? 0) + 1);
  map[id] = count; put(A, map);
  return count;
};
const hex = buf => [...new Uint8Array(buf)].map(v => v.toString(16).padStart(2, '0')).join('');
const metadataOK = (hash, salt) => typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash)
  && typeof salt === 'string' && (salt === '' || /^(?:[0-9a-f]{16}|[0-9a-f]{32})$/i.test(salt));
const grade = async (meta, answer) => {
  const salt = meta.salt === undefined ? '' : meta.salt;
  if (!metadataOK(meta.sha256, salt)) throw new Error('Invalid checker metadata');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(answer + salt));
  return hex(digest) === meta.sha256.toLowerCase();
};
const readProgress = () => ({ solves: refresh(K), attempts: refresh(A), hints: refresh(H) });
const exportJSON = known => {
  const data = readProgress();
  if (Array.isArray(known)) {
    const ids = new Set(known.flatMap(entry => [entry.id, ...(entry.aliases || [])]));
    for (const field of ['solves', 'attempts', 'hints']) {
      data[field] = Object.fromEntries(Object.entries(data[field]).filter(([id]) => ids.has(id)));
    }
  }
  return JSON.stringify({ version: 3, ...data });
};
const importJSON = async (text, known) => {
  // Validate the entire file before writing anything. Imported assertions of
  // verification are not evidence; only a supplied legacy flag can be checked.
  const invalid = () => { throw new Error('Invalid progress schema, ID, date, count or hints. Nothing was imported.'); };
  if (typeof text !== 'string' || text.length > MAX_JSON) invalid();
  let data; try { data = JSON.parse(text); } catch (_) { invalid(); }
  if (!record(data) || ![2, 3].includes(data.version)
      || Object.keys(data).sort().join(',') !== 'attempts,hints,solves,version') invalid();
  const byId = new Map();
  if (!Array.isArray(known) || known.length > MAX_RECORDS) invalid();
  for (const entry of known) {
    if (!record(entry) || !idOK(entry.id)) invalid();
    const aliases = entry.aliases === undefined ? [] : entry.aliases;
    if (!Array.isArray(aliases) || aliases.length > MAX_RECORDS) invalid();
    for (const id of [entry.id, ...aliases]) {
      if (!idOK(id) || (byId.has(id) && byId.get(id) !== entry)) invalid();
      byId.set(id, entry);
      if (byId.size > MAX_RECORDS) invalid();
    }
  }
  const incoming = { [K]: dict(), [A]: dict(), [H]: dict() }, pending = [];
  for (const [field, kind] of [['solves', K], ['attempts', A], ['hints', H]]) {
    const part = data[field];
    if (!record(part) || Object.keys(part).length > MAX_RECORDS) invalid();
    for (const [id, value] of Object.entries(part)) {
      if (!idOK(id) || !byId.has(id)) invalid();
      const entry = byId.get(id), canonical = entry.id;
      if (kind === K) {
        let at, flag;
        if (data.version === 2 && typeof value === 'string') at = value;
        else {
          if (!record(value)) invalid();
          const keys = Object.keys(value).sort().join(',');
          if (keys === 'at,verified' && typeof value.verified === 'boolean') at = value.at;
          else if (data.version === 2 && keys === 'at') at = value.at;
          else if (data.version === 2 && keys === 'at,flag' && typeof value.flag === 'string'
                   && value.flag.length > 0 && value.flag.length <= 4096) { at = value.at; flag = value.flag; }
          else invalid();
        }
        if (!dateOK(at)) invalid();
        const r = { at, verified: false };
        pending.push({ entry, canonical, r, flag });
      } else if (kind === A) {
        if (!countOK(value)) invalid();
        incoming[A][canonical] = Math.max(incoming[A][canonical] ?? 0, value);
      } else {
        if (!hintsOK(value)) invalid();
        incoming[H][canonical] = [...new Set([...(incoming[H][canonical] || []), ...value])].sort();
      }
    }
  }
  for (const { entry, canonical, r, flag } of pending) {
    if (flag !== undefined) {
      if (!await grade(entry, flag)) throw new Error('A legacy answer did not match its checker. Nothing was imported.');
      r.verified = true;
    }
    incoming[K][canonical] = betterSolve(incoming[K][canonical], r);
  }
  // Refresh after hashing, so concurrent page activity is not overwritten.
  const merged = dict();
  for (const kind of [K, A, H]) {
    const target = Object.assign(dict(), refresh(kind));
    for (const [id, v] of Object.entries(incoming[kind])) {
      if (!room(target, id)) invalid();
      if (kind === K) target[id] = betterSolve(target[id], v);
      else if (kind === A) target[id] = Math.max(target[id] ?? 0, v);
      else target[id] = [...new Set([...(target[id] || []), ...v])].sort();
    }
    merged[kind] = target;
  }
  let persisted = true;
  for (const kind of [K, A, H]) { memory[kind] = merged[kind]; if (!put(kind, merged[kind])) persisted = false; }
  return { imported: Object.keys(incoming[K]).length, verified: Object.values(incoming[K]).filter(r => r.verified).length, persisted };
};
// Load and migrate even when this page has no checker.
readProgress();
const css = D.currentScript?.src ? new URL('../css/features/challenge.css', D.currentScript.src) : null;
const storedMute = get(M, false);
let styled = false, ac, mute = storedMute === true || storedMute === 1;
const Q = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion:reduce)') : { matches: true };
const chime = () => {
  if (mute || Q.matches) return;
  try {
    ac = ac || new globalThis.AudioContext();
    const t0 = ac.currentTime + .02;
    [660, 880].forEach((hz, n) => {
      const t = t0 + n * .15, o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = hz; g.gain.setValueAtTime(.2, t); g.gain.linearRampToValueAtTime(1e-4, t + .3);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .32);
    });
  } catch (_) { /* Audio is optional. */ }
};
const burst = box => {
  const s = getComputedStyle(D.documentElement), colors = ['--shell', '--pink', '--yellow'].map(n => s.getPropertyValue(n));
  const d = devicePixelRatio || 1, w = innerWidth, h = innerHeight, c = ce('canvas');
  c.className = 'confetti'; c.width = w * d; c.height = h * d; D.body.appendChild(c);
  const x = c.getContext('2d'); if (!x) { c.remove(); return; } x.scale(d, d);
  const r = box.getBoundingClientRect(), particles = [];
  for (let n = 0; n < 110; n++) {
    const a = -1.57 + (Math.random() - .5) * 2.4, v = 4 + Math.random() * 9;
    particles.push([r.left + r.width / 2, r.top + r.height / 3, Math.cos(a) * v, Math.sin(a) * v,
      5 + Math.random() * 6, 0, .2 * (Math.random() - .5), colors[n % colors.length]]);
  }
  let t0;
  const tick = t => {
    const elapsed = t - (t0 ??= t); x.clearRect(0, 0, w, h);
    for (const p of particles) {
      p[0] += p[2]; p[1] += p[3]; p[3] += .3; p[5] += p[6];
      x.save(); x.translate(p[0], p[1]); x.rotate(p[5]); x.fillStyle = p[7];
      x.fillRect(-p[4] / 2, -p[4] / 4, p[4], p[4] / 2); x.restore();
    }
    elapsed < 1400 && !Q.matches ? requestAnimationFrame(tick) : c.remove();
  };
  requestAnimationFrame(tick);
};
const flair = () => {
  const head = D.querySelector('.record-head');
  if (head && !head.querySelector('.solved-badge')) {
    const b = ce('p'); b.className = 'solved-badge'; b.textContent = 'challenge cleared locally'; head.appendChild(b);
  }
  if (!D.title.endsWith(T)) D.title += T;
};
const done = (f, v, o, at, live) => {
  v.textContent = 'CLEARED - ' + new Date(at).toLocaleString(); v.className = P + 'verdict is-clear';
  o.textContent = live ? 'Correct.' : 'Previously checked on this device. Local progress is editable.';
  o.className = P + 'result is-correct'; f.classList.add('is-solved');
  initialized.get(f).reenter.hidden = false;
  flair();
  if (live) {
    if (Q.matches) f.classList.add('is-ribbon');
    else { try { burst(f); } catch (_) { /* Decoration must not suppress solve events. */ } }
    chime();
  }
};
const initialized = new WeakMap();
const session = () => window.DeuteriumChainSession;
const paintControls = (f, enabled) => {
  const state = initialized.get(f); if (!state) return;
  state.opt.checked = enabled; state.opt.disabled = !session();
  state.sound.textContent = Q.matches ? 'Sound off (reduced motion)' : mute ? 'Muted' : 'Sound';
  state.sound.setAttribute('aria-pressed', String(mute || Q.matches)); state.sound.disabled = Q.matches;
};
const syncControls = () => {
  const enabled = session()?.isEnabled() === true;
  for (const f of D.querySelectorAll('[data-flag-check]')) paintControls(f, enabled);
};
D.addEventListener('deuterium:chain-session', syncControls);
Q.addEventListener?.('change', syncControls);
const init = (root = D) => {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const forms = [...(root.matches?.('[data-flag-check]') ? [root] : []), ...root.querySelectorAll('[data-flag-check]')];
  if (forms.length && css && !styled) {
    css.searchParams.set('v', window.__deuteriumAssetVersion || '');
    D.head.appendChild(Object.assign(ce('link'), { rel: 'stylesheet', href: css.href })); styled = true;
  }
  for (const f of forms) {
    if (initialized.has(f)) continue;
    const i = f.querySelector('[data-flag-input]'), b = f.querySelector('button[type="submit"]'), o = f.querySelector('output');
    if (!i || !b || !o) continue;
    const id = f.dataset.challengeId || (i.id?.startsWith('flag-') ? i.id.slice(5) : f.dataset.sha256);
    const prefix = f.dataset.flagPrefix || 'flag', escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const format = new RegExp('^' + escaped + '\\{[^{}]+\\}$');
    const v = ce('p'); v.className = P + 'verdict'; v.setAttribute('role', 'status'); v.setAttribute('aria-live', 'polite');
    (o.parentElement || f).insertBefore(v, o);
    const sound = ce('button'); sound.type = 'button'; sound.className = P + 'sound';
    sound.onclick = () => { mute = !mute; put(M, mute); syncControls(); }; f.appendChild(sound);
    const controls = ce('div'); controls.className = P + 'session';
    const label = ce('label'), opt = ce('input'); opt.type = 'checkbox'; opt.setAttribute('data-chain-session-opt-in', '');
    label.appendChild(opt); const caption = ce('span'); caption.textContent = ' Keep correct answers in this tab for chained pages'; label.appendChild(caption);
    const warning = ce('p'); warning.textContent = 'Off by default. Answers in tab storage are readable by scripts on this site. Clearing turns this off, removes saved answers, and relocks an unlocked encrypted article on this page. It does not erase local progress, saved copies, or browser memory.';
    const clear = ce('button'); clear.type = 'button'; clear.textContent = 'Clear tab answers'; clear.setAttribute('data-chain-session-clear', '');
    const reenter = ce('button'); reenter.type = 'button'; reenter.className = P + 'reenter'; reenter.textContent = 'Enter answer again';
    reenter.setAttribute('data-flag-reenter', ''); reenter.hidden = true;
    const notice = ce('p'); notice.setAttribute('role', 'status');
    opt.onchange = () => { session()?.setEnabled(opt.checked); syncControls(); notice.textContent = opt.checked ? 'Tab answer storage enabled.' : 'Tab answer storage off.'; };
    clear.onclick = () => { const ok = session()?.clear(); notice.textContent = ok ? 'Tab answers cleared. Tab answer storage off.' : 'Tab storage is unavailable; saved answers may remain.'; syncControls(); };
    reenter.onclick = () => {
      if (busy || !f.classList.contains('is-solved')) return;
      // Reopen only this form; the receipt, attempt count and spent hints stay.
      f.classList.remove('is-solved', 'is-ribbon', 'is-shaking');
      v.className = P + 'verdict'; v.textContent = '';
      o.className = P + 'result'; o.textContent = 'Enter the answer again to check it. Local progress is unchanged.';
      notice.textContent = ''; reenter.hidden = true;
      i.value = ''; i.classList.remove('is-bad'); i.focus();
    };
    controls.appendChild(label); controls.appendChild(warning); controls.appendChild(clear); controls.appendChild(reenter); controls.appendChild(notice); f.appendChild(controls);
    initialized.set(f, { opt, sound, reenter });
    let hints = [...root.querySelectorAll('[data-hint-for]')].filter(h => h.dataset.hintFor === id);
    // init(form) can still find the form's sibling hints in its container.
    if (!hints.length && root === f) hints = [...(f.parentElement || D).querySelectorAll('[data-hint-for]')].filter(h => h.dataset.hintFor === id);
    if (!hints.length && forms.length === 1) hints = [...root.querySelectorAll('[data-hint]:not([data-hint-for])')];
    hints = hints.filter(h => /^[1-3]$/.test(h.dataset.hint)).sort((a, b) => +a.dataset.hint - +b.dataset.hint)
      .filter((h, n, all) => n === 0 || h.dataset.hint !== all[n - 1].dataset.hint).slice(0, 3);
    const strip = ce('div'); strip.className = P + 'hints';
    const tease = () => { hints.forEach(h => h.classList.add('is-highlighted')); strip.classList.add('is-highlighted'); };
    hints.forEach(h => {
      const k = Number(h.dataset.hint), t = ce('button'); t.type = 'button'; t.className = P + 'hint';
      t.textContent = 'hint ' + k + ' of ' + hints.length;
      const open = () => { h.hidden = false; h.classList.add('is-revealed'); t.classList.add('is-used'); t.disabled = true; t.textContent = 'hint ' + k + ' of ' + hints.length + ' - used'; };
      if ((refresh(H)[id] || []).includes(k)) open();
      t.onclick = () => {
        if (!idOK(id)) return;
        open(); const spent = refresh(H);
        if (room(spent, id)) { spent[id] = [...new Set([...(spent[id] || []), k])].sort(); put(H, spent); }
      };
      strip.appendChild(t);
    });
    if (hints.length) f.appendChild(strip);
    const wrong = (className, message) => {
      v.className = P + 'verdict ' + className; v.textContent = message; i.classList.add('is-bad');
      if (!Q.matches) { f.classList.remove('is-shaking'); void f.offsetWidth; f.classList.add('is-shaking'); }
    };
    let busy = false;
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const x = i.value.trim();
      if (!x) { v.className = P + 'verdict is-format'; v.textContent = 'Enter a flag first.'; i.focus(); return; }
      busy = true; const label = b.textContent; b.disabled = true; b.textContent = 'checking...';
      try {
        if (!idOK(id) || x.length > 4096) throw new Error('Invalid challenge ID or answer length');
        const ok = await grade(f.dataset, x), attempt = increment(id);
        D.dispatchEvent(new CustomEvent('deuterium:attempt', { detail: { id, attempt, correct: ok } }));
        if (ok) {
          const solves = refresh(K);
          if (!room(solves, id)) throw new Error('Progress record limit reached');
          const previous = solves[id], at = previous?.at || new Date().toISOString();
          solves[id] = { at, verified: true }; const persisted = put(K, solves);
          if (session()?.isEnabled()) session().remember(id, x);
          i.value = '';
          i.classList.remove('is-bad'); done(f, v, o, at, true);
          if (!persisted) o.textContent = 'Correct. Local progress could not be saved and may be lost when this page closes.';
          D.dispatchEvent(new CustomEvent('deuterium:solved', { detail: { id, at } }));
        } else if (!format.test(x)) {
          wrong('is-format', 'WRONG FORMAT - flags look like ' + prefix + '{...} (case-sensitive, one pair of braces). Attempt ' + attempt + '.');
          if (attempt > 2) tease();
        } else if (attempt > 2) { wrong('is-again', 'WRONG AGAIN - attempt ' + attempt + '.' + (hints.length ? ' A hint is available below.' : '')); tease(); }
        else wrong('is-wrong', 'WRONG FLAG - attempt ' + attempt + '.');
      } catch (_) { v.className = P + 'verdict is-format'; v.textContent = 'Could not check the flag. Try again.'; }
      finally { busy = false; b.disabled = false; b.textContent = label; }
    });
    i.addEventListener('input', () => {
      i.classList.remove('is-bad'); f.classList.remove('is-shaking');
      if (!v.classList.contains('is-clear')) { v.className = P + 'verdict'; v.textContent = ''; }
    });
    const saved = idOK(id) ? refresh(K)[id] : null;
    if (saved?.verified) done(f, v, o, saved.at, false);
    else if (saved) { o.textContent = 'Old local progress: ' + new Date(saved.at).toLocaleString() + '. Not verified; enter the flag to check.'; }
    b.disabled = false;
  }
  syncControls();
  const enabled = session()?.isEnabled() === true;
  for (const f of forms) paintControls(f, enabled); // Also paint a detached decrypted root.
};
window.DeuteriumChallengeEngine = Object.freeze({ init, progress: Object.freeze({ read: readProgress, exportJSON, importJSON }) });
init(D);
if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => init(D), { once: true });
})();
