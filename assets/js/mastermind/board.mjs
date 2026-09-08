// Keep the include's content version on every live dependency.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const { createGame, validateOptions, COLOR_NAMES } = await dependency('./game.mjs');
const { score } = await dependency('./core.mjs');
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const textScore = reply => `${reply.exact} exact, ${reply.misplaced} misplaced`;
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

export function mountMastermind(root) {
  if (root.dataset.mounted) return;
  const part = name => root.querySelector(`[data-part="${name}"]`);
  let options = { role: 'breaker', positions: 4, colors: 6, probability: .1, cap: 1, limit: 16 };
  let game, draft = [], selected = 0, opponentSeed = 0;
  let generation = 0, requestId = 0, worker = null;
  const error = message => { part('error').textContent = message?.message ?? message ?? ''; };
  const editable = view => ['guess', 'setup', 'reply'].includes(view.phase);
  const complete = () => draft.every(value => Number.isInteger(value));
  const changes = view => draft.reduce((sum, value, i) => sum + Number(value !== view.secret[i]), 0);

  function stopWorker() {
    if (!worker) return;
    const old = worker;
    worker = null;
    old.onmessage = old.onerror = old.onmessageerror = null;
    old.terminate();
  }
  function invalidate() {
    generation++;
    stopWorker();
    part('retry').hidden = true;
  }
  function peg(value) {
    const el = node('span', value ?? '-', `mst-peg ${value == null ? 'mst-peg-empty' : `mst-peg-${value}`}`);
    el.setAttribute('aria-label', value == null ? 'Empty' : `${value} ${COLOR_NAMES[value - 1]}`);
    return el;
  }
  function codeRow(code) {
    const row = node('div', undefined, 'mst-code');
    code.forEach(value => row.append(peg(value)));
    return row;
  }
  function feedback(reply, positions) {
    const el = node('div', undefined, 'mst-feedback');
    const pips = node('span', undefined, 'mst-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < positions; i++) {
      pips.append(node('span', undefined, `mst-pip${i < reply.exact ? ' mst-pip-exact' : i < reply.exact + reply.misplaced ? ' mst-pip-misplaced' : ''}`));
    }
    el.append(pips, node('span', textScore(reply), 'mst-counts'));
    return el;
  }
  function warning() {
    const n = Number(part('positions').value), m = Number(part('colors').value), t = Number(part('cap').value);
    part('cap').max = String(n);
    const notes = [];
    if (m ** n > 32768) notes.push('This size is available only in Breaker. Liar is limited to 32,768 possible codes.');
    if ((n === 4 && m === 6 && t >= 2) || t >= n - 1) {
      notes.push('At this cap, adversarial clues can carry no information beyond confirmed wrong guesses. The computer may have to search code by code.');
    }
    part('settings-warning').textContent = notes.join(' ');
  }
  function syncSettings() {
    for (const key of ['positions', 'colors', 'probability', 'cap', 'limit']) part(key).value = String(options[key]);
    warning();
  }
  function freshDraft(view) {
    draft = view.phase === 'reply' ? [...view.secret] : Array(view.positions).fill(null);
    selected = 0;
  }
  function start(nextOptions = options, focus = false) {
    // Build before cancelling: a rejected configuration must not damage a round.
    validateOptions(nextOptions);
    const seed = randomSeed();
    const next = createGame({ ...nextOptions, seed }); // Never pass a breaker secret.
    const nextOpponentSeed = randomSeed(); // Independent of the referee/noise RNG.
    invalidate();
    game = next;
    options = { ...nextOptions };
    opponentSeed = nextOpponentSeed;
    freshDraft(game.view());
    error('');
    part('review').open = false;
    syncSettings();
    render(focus);
  }
  function focusEditor() { part('editor').querySelectorAll('button')[selected]?.focus(); }
  function updateEditor(focus = false) {
    const view = game.view();
    if (!editable(view)) return;
    for (const [i, button] of [...part('editor').children].entries()) {
      button.replaceChildren(peg(draft[i]));
      button.setAttribute('aria-pressed', String(i === selected));
      const changed = view.phase === 'reply' && draft[i] !== view.secret[i];
      button.classList.toggle('mst-changed', changed);
      button.setAttribute('aria-label', `Position ${i + 1}: ${draft[i] == null ? 'empty' : `${draft[i]} ${COLOR_NAMES[draft[i] - 1]}`}${changed ? ', changed' : ''}`);
    }
    part('submit').disabled = !complete();
    part('edit-count').textContent = view.phase === 'reply' ? `${changes(view)} / ${view.cap} changed this turn` : `Position ${selected + 1} / ${view.positions}`;
    part('preview').hidden = view.phase !== 'reply';
    if (view.phase === 'reply') {
      const guess = view.turns.at(-1).guess;
      part('preview').replaceChildren(node('span', 'Clues the computer will receive'), feedback(score(draft, guess, view), view.positions));
    }
    if (focus) focusEditor();
  }
  function place(value, advance = true) {
    const view = game.view();
    if (!editable(view)) return;
    if (view.phase === 'reply') {
      const next = [...draft];
      next[selected] = value;
      if (next.reduce((sum, peg, i) => sum + Number(peg !== view.secret[i]), 0) > view.cap) {
        error(`Only ${view.cap} position${view.cap === 1 ? '' : 's'} may change this turn. Restore a changed peg first.`);
        return;
      }
    }
    error('');
    draft[selected] = value;
    if (advance) selected = Math.min(selected + 1, view.positions - 1);
    updateEditor(true);
  }
  function submit() {
    const view = game.view();
    if (!editable(view)) return;
    if (!complete()) { error('Fill every position before submitting.'); return; }
    try {
      if (view.phase === 'setup') game.lockSecret(draft);
      else if (view.phase === 'guess') game.guess(draft);
      else game.submitTemporary(draft);
      error('');
      freshDraft(game.view());
      render(true);
      if (game.view().phase === 'ready') requestComputer();
    } catch (err) { error(err); }
  }
  function requestComputer() {
    if (worker || game.view().phase !== 'ready') return;
    const epoch = generation, id = ++requestId;
    let active;
    const current = () => generation === epoch && worker === active && game.view().phase === 'ready';
    const failed = message => {
      if (!current()) return;
      stopWorker();
      part('thinking').hidden = true;
      part('retry').hidden = false;
      part('status').textContent = 'Computer paused. Retry this turn or end the round.';
      error(message);
    };
    try {
      active = new Worker(root.dataset.workerUrl, { type: 'module' });
      worker = active;
      part('retry').hidden = true;
      part('thinking').hidden = false;
      part('status').textContent = 'Computer is choosing a guess. Your secret stays locked.';
      active.onmessage = event => {
        if (!current()) return;
        const data = event.data;
        if (data?.requestId !== id || data?.generation !== epoch) return;
        if (data.type === 'error') { failed(data.message || 'The computer could not choose a guess.'); return; }
        if (data.type !== 'choice') { failed('The computer returned an invalid response.'); return; }
        try {
          const focus = document.activeElement === part('status');
          game.issueGuess(data.result?.guess); // Engine validates the returned code atomically.
          stopWorker();
          freshDraft(game.view());
          render(focus);
        } catch (err) { failed(err.message); }
      };
      active.onerror = event => { event.preventDefault(); failed('The computer could not load. Retry this turn.'); };
      active.onmessageerror = () => failed('The computer response could not be read.');
      // Whitelist at the engine boundary. No game view, secret, temporary code,
      // round seed or private annotations ever leave the referee for the worker.
      active.postMessage({ type: 'choose', requestId: id, generation: epoch, view: game.solverView(), seed: opponentSeed });
    } catch (err) {
      if (active) failed(err.message);
      else {
        part('thinking').hidden = true;
        part('retry').hidden = false;
        error('A background worker is unavailable. Retry or play Breaker.');
        part('status').textContent = 'Computer paused.';
      }
    }
  }
  function render(focus = false) {
    const view = game.view(), over = view.phase === 'over', liar = view.role === 'liar';
    root.dataset.phase = view.phase;
    root.dataset.role = view.role;
    root.style.setProperty('--mst-n', view.positions);
    part('breaker').setAttribute('aria-pressed', String(!liar));
    part('liar').setAttribute('aria-pressed', String(liar));
    part('intro').textContent = liar
      ? `Lock your secret, then change up to ${view.cap} peg${view.cap === 1 ? '' : 's'} in a temporary scoring row each turn.`
      : 'Place your pegs, then check the row. Clues can be wrong.';
    const turn = Math.min(view.limit, view.turns.length + (['guess', 'ready'].includes(view.phase) ? 1 : 0));
    part('turn').textContent = view.phase === 'setup' ? 'Set your secret' : over ? `${view.turns.length} / ${view.limit} guesses` : `Turn ${turn} / ${view.limit}`;
    part('rule').textContent = liar ? `Cap: ${view.cap} per turn` : `Noise: ${Number((100 * view.probability).toFixed(2))}% per peg`;
    part('secret-rack').hidden = view.phase === 'setup';
    part('secret-label').textContent = over ? 'Secret code / revealed' : liar ? 'Your secret / locked' : 'Secret code / sealed';
    const hidden = !view.secret;
    part('secret').classList.toggle('mst-sealed', hidden);
    part('secret').setAttribute('aria-label', hidden ? 'Secret code is hidden' : 'Fixed secret code');
    part('secret').replaceChildren(...(view.secret ?? Array(view.positions).fill(null)).map(value => {
      const el = peg(value);
      if (hidden) { el.textContent = '?'; el.setAttribute('aria-label', 'Hidden peg'); }
      return el;
    }));
    const rows = view.turns.map(turn => {
      const li = node('li');
      li.dataset.outcome = turn.outcome;
      li.setAttribute('aria-label', `Guess ${turn.number}${turn.outcome === 'win' ? ', actual match' : ''}`);
      li.append(node('span', String(turn.number).padStart(2, '0'), 'mst-turn-number'), codeRow(turn.guess));
      li.append(turn.reply ? feedback(turn.reply, view.positions) : node('span', turn.outcome === 'win' ? 'Code matched' : 'Awaiting your clues', 'mst-counts'));
      return li;
    });
    part('history').replaceChildren(...rows);
    part('history').tabIndex = rows.length ? 0 : -1;
    part('history').scrollTop = part('history').scrollHeight;
    part('thinking').hidden = view.phase !== 'ready';
    part('editor-panel').hidden = !editable(view);
    part('giveup').disabled = over || view.phase === 'setup';
    part('giveup').textContent = liar ? 'Concede round' : 'Give up & reveal';
    part('ending').hidden = !over;
    part('review').hidden = !over;
    if (editable(view)) {
      const title = view.phase === 'setup' ? 'Choose your secret' : view.phase === 'reply' ? 'Your temporary scoring row' : 'Your guess';
      part('editor-title').textContent = title;
      part('editor').setAttribute('aria-label', title);
      part('submit').textContent = view.phase === 'setup' ? 'Lock secret & play' : view.phase === 'reply' ? 'Send clues' : 'Check guess';
      part('clear').textContent = view.phase === 'reply' ? 'Restore secret' : 'Clear row';
      part('editor').replaceChildren(...draft.map((_, index) => {
        const button = node('button', undefined, 'mst-slot');
        button.type = 'button';
        button.dataset.position = String(index + 1);
        button.addEventListener('click', () => { selected = index; updateEditor(); });
        button.addEventListener('focus', () => { if (selected !== index) { selected = index; updateEditor(); } });
        return button;
      }));
      part('palette').replaceChildren(...Array.from({ length: view.colors }, (_, i) => {
        const button = node('button', undefined, 'mst-color');
        button.type = 'button';
        button.dataset.color = String(i + 1);
        button.setAttribute('aria-label', `${i + 1} ${COLOR_NAMES[i]}`);
        const disc = peg(i + 1);
        disc.setAttribute('aria-hidden', 'true');
        button.append(disc, node('span', COLOR_NAMES[i]));
        button.addEventListener('click', () => place(i + 1));
        return button;
      }));
      root.querySelector('#mst-keyboard').textContent = `1-${view.colors}: colors. Left/Right: select. Enter: submit.`;
      updateEditor();
    }
    if (over) {
      stopWorker();
      const win = view.ending.winner === 'player', gaveUp = view.ending.reason === 'giveup';
      part('ending').dataset.result = win ? 'win' : 'loss';
      part('result-mark').textContent = gaveUp ? 'ENDED' : win ? 'WIN' : 'LOSS';
      part('end-title').textContent = gaveUp ? 'Round conceded' : win ? liar ? 'You kept the secret' : 'Code cracked' : liar ? 'The computer cracked it' : 'Out of guesses';
      part('end-copy').textContent = gaveUp ? 'The fixed secret is revealed above. Review the clues or try a fresh round.'
        : view.ending.reason === 'solved' ? `${liar ? 'The computer found your code' : 'You found the code'} in ${view.turns.length} guess${view.turns.length === 1 ? '' : 'es'}.`
          : liar ? `The computer used all ${view.limit} guesses without finding your code.` : `You used all ${view.limit} guesses. Compare the reported clues with the truth below.`;
      part('review-rows').replaceChildren(...(view.review ?? []).map(turn => {
        const li = node('li');
        li.append(node('strong', `Guess ${turn.number}: true score ${textScore(turn.truth)}`));
        const played = view.turns[turn.number - 1];
        if (played.reply) li.append(node('p', `Reported clues: ${textScore(played.reply)}.`));
        if (turn.temporary) {
          li.append(node('p', `Temporary scoring row; ${turn.changedPositions} changed position${turn.changedPositions === 1 ? '' : 's'}.`), codeRow(turn.temporary));
        } else li.append(node('p', played.outcome === 'win' ? 'Actual match. No temporary row was scored.' : 'Round ended before clues were sent.'));
        return li;
      }));
      part('status').textContent = part('end-title').textContent + '. Secret revealed.';
    } else if (view.phase === 'setup') part('status').textContent = 'Choose your fixed secret. You can edit it until you lock it.';
    else if (view.phase === 'reply') part('status').textContent = `The computer missed. Your temporary row starts fresh: up to ${view.cap} changes this turn.`;
    else if (view.phase === 'ready') part('status').textContent = 'Computer is choosing a guess. Your secret stays locked.';
    else {
      const last = view.turns.at(-1);
      part('status').textContent = !last ? 'Choose colors for your first guess.'
        : last.reply.exact === view.positions ? 'All-exact clue, but not the fixed code. Keep playing.' : `Guess ${last.number}: ${textScore(last.reply)} reported. Try another row.`;
    }
    if (focus) {
      if (over) part('ending').focus();
      else if (editable(view)) focusEditor();
      else { part('status').tabIndex = -1; part('status').focus({ preventScroll: true }); }
    }
  }

  part('submit').addEventListener('click', submit);
  part('clear').addEventListener('click', () => { freshDraft(game.view()); error(''); updateEditor(true); });
  for (const role of ['breaker', 'liar']) part(role).addEventListener('click', () => {
    if (game.view().role === role) return;
    try { start({ ...options, role }, true); } catch (err) { error(err); }
  });
  for (const name of ['reset', 'again']) part(name).addEventListener('click', () => {
    try { start(options, true); } catch (err) { error(err); }
  });
  part('giveup').addEventListener('click', () => {
    if (game.view().phase === 'over') return;
    invalidate();
    game.giveUp();
    error('');
    render(true);
  });
  part('retry').addEventListener('click', () => { error(''); requestComputer(); });
  part('settings-form').addEventListener('input', warning);
  part('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const next = { ...options };
    for (const key of ['positions', 'colors', 'probability', 'cap', 'limit']) next[key] = Number(part(key).value);
    try { start(next, true); part('settings').open = false; } catch (err) { error(err); }
  });
  part('editor-panel').addEventListener('keydown', event => {
    if (!editable(game.view()) || event.ctrlKey || event.metaKey || event.altKey) return;
    // Buttons outside the editor/palette retain native Enter/Space behavior.
    if (!event.target.closest('[data-part="editor"], [data-part="palette"]')) return;
    const view = game.view();
    if (/^[1-6]$/.test(event.key) && Number(event.key) <= view.colors) { event.preventDefault(); place(Number(event.key)); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); selected = (selected + (event.key === 'ArrowLeft' ? -1 : 1) + view.positions) % view.positions; updateEditor(true);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); place(((draft[selected] ?? (event.key === 'ArrowUp' ? 0 : 2)) - 1 + (event.key === 'ArrowUp' ? 1 : -1) + view.colors) % view.colors + 1, false);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      if (view.phase !== 'reply' && draft[selected] === null) selected = Math.max(0, selected - 1);
      draft[selected] = view.phase === 'reply' ? view.secret[selected] : null;
      error(''); updateEditor(true);
    } else if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });
  // Page departure terminates work too. A bfcache return can retry the same turn.
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('pageshow', () => {
    if (game?.view().phase === 'ready' && !worker) requestComputer();
  });
  try { start(); root.dataset.mounted = 'true'; } catch (err) { error(err); }
}

for (const root of document.querySelectorAll('[data-mastermind]')) mountMastermind(root);
