/* Optional answer handoff for this tab. Never writes answers to localStorage. */
(() => {
  'use strict';
  if (window.DeuteriumChainSession) return;
  const KEY = 'deuterium-chain-session';
  const MAX_ANSWERS = 32, MAX_ANSWER = 4096, MAX_CHARS = 160 * 1024;
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const idOK = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)
    && !['__proto__', 'prototype', 'constructor'].includes(id);
  const empty = () => ({ version: 1, enabled: true, answers: Object.create(null) });
  const remove = () => {
    try { sessionStorage.removeItem(KEY); return true; }
    catch (_) {
      // Scrub answers if possible, but do not report successful key removal.
      try { sessionStorage.setItem(KEY, '{"version":1,"enabled":false,"answers":{}}'); } catch (_) {}
      return false;
    }
  };
  const load = () => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw === null) return null;
      if (raw.length > MAX_CHARS) throw new Error('size');
      const data = JSON.parse(raw);
      if (!record(data) || Object.keys(data).sort().join(',') !== 'answers,enabled,version'
          || data.version !== 1 || typeof data.enabled !== 'boolean' || !record(data.answers)) throw new Error('shape');
      const pairs = Object.entries(data.answers);
      if (pairs.length > MAX_ANSWERS || (!data.enabled && pairs.length)) throw new Error('bounds');
      const clean = empty(); clean.enabled = data.enabled;
      for (const [id, answer] of pairs) {
        if (!idOK(id) || typeof answer !== 'string' || !answer.length || answer.length > MAX_ANSWER) throw new Error('answer');
        clean.answers[id] = answer;
      }
      return clean;
    } catch (_) { remove(); return null; }
  };
  let enabled = load()?.enabled === true;
  const notify = () => document.dispatchEvent(new CustomEvent('deuterium:chain-session', { detail: { enabled } }));
  const save = data => {
    try {
      const raw = JSON.stringify(data);
      if (raw.length > MAX_CHARS) throw new Error('size');
      sessionStorage.setItem(KEY, raw);
      return true;
    } catch (_) {
      remove();
      if (enabled) { enabled = false; notify(); }
      return false;
    }
  };
  const isEnabled = () => {
    if (enabled && load()?.enabled !== true) { enabled = false; notify(); }
    return enabled;
  };
  const setEnabled = value => {
    const next = value === true;
    if (!next) { enabled = false; remove(); }
    else if (!isEnabled()) enabled = save(empty());
    notify();
    return enabled;
  };
  const remember = (id, answer) => {
    if (!isEnabled() || !idOK(id) || typeof answer !== 'string' || !answer.length || answer.length > MAX_ANSWER) return false;
    const data = load();
    if (!data?.enabled) return false;
    delete data.answers[id]; // Replace the entry before enforcing the count limit.
    while (Object.keys(data.answers).length >= MAX_ANSWERS) delete data.answers[Object.keys(data.answers)[0]];
    data.answers[id] = answer;
    return save(data);
  };
  const recall = id => isEnabled() && idOK(id) ? load()?.answers[id] ?? null : null;
  const forget = id => {
    if (!isEnabled() || !idOK(id)) return false;
    const data = load();
    if (!data?.enabled) return false;
    delete data.answers[id];
    return save(data);
  };
  const clear = () => {
    const removed = remove();
    enabled = false;
    // Notify even when already off or removal failed: clients must cancel work
    // and relock content, without receiving answers in the event payload.
    notify();
    return removed;
  };
  window.DeuteriumChainSession = Object.freeze({ isEnabled, setEnabled, remember, recall, forget, clear });
})();
