// Carry the include's content version into this adapter's module imports.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const { score } = await dependency('./core.mjs');
const { createSession, restoreSession, MAX_SAVE_BYTES } = await dependency('./session.mjs');
const { POLICY_LABELS, QUERY_CAP } = await dependency('./policies.mjs');
const { createSolverClient } = await dependency('./transport.mjs');

export const COLOR_LABELS = Object.freeze(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']);
export const STORAGE_KEY = 'mastermind-reference-v1';
const textReply = r => `${r.exact} exact, ${r.misplaced} misplaced`;

export function mountMastermind(root) {
  if (root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const part = name => root.querySelector(`[data-part="${name}"]`);
  const client = createSolverClient({ url: root.dataset.workerUrl });
  let session = null;
  let generation = 0;
  let busy = false;
  let playing = false;
  let restoring = false;
  let timer = null;
  let detail = '';
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function codeRow(code) {
    const row = node('div', undefined, 'mst-code');
    code.forEach(value => row.append(node('span', `${value} ${COLOR_LABELS[value - 1]}`, `mst-peg mst-peg-${value}`)));
    return row;
  }
  const error = value => { part('error').textContent = value?.message ?? value ?? ''; };
  function invalidate() {
    generation++;
    clearTimeout(timer);
    timer = null;
    client.cancel();
    playing = busy = restoring = false;
  }
  function buildSecret(values = null) {
    const [positions, colors] = part('size').value.split('x').map(Number);
    const container = part('secret-inputs');
    container.replaceChildren();
    for (let i = 0; i < positions; i++) {
      const label = node('label', `Secret position ${i + 1}`);
      const select = node('select');
      select.dataset.position = String(i + 1);
      for (let color = 1; color <= colors; color++) {
        const option = node('option', `${color} ${COLOR_LABELS[color - 1]}`);
        option.value = String(color);
        select.append(option);
      }
      select.value = String(values?.[i] ?? [1, 2, 1, 3][i]);
      label.append(select);
      container.append(label);
    }
  }
  function modeControls() {
    const noise = part('mode').value === 'misread';
    part('noise-settings').hidden = !noise;
    part('bounded-settings').hidden = noise;
    part('allowance').disabled = noise;
    for (const name of ['probability', 'policy', 'noise']) part(name).disabled = !noise;
  }
  function initialFromForm() {
    const [positions, colors] = part('size').value.split('x').map(Number);
    const mode = part('mode').value;
    return { positions, colors, mode,
      secret: [...part('secret-inputs').querySelectorAll('select')].map(el => Number(el.value)),
      seed: Number(part('seed').value),
      policy: mode === 'bounded' ? 'bounded' : part('policy').value,
      lieBudget: mode === 'bounded' ? Number(part('allowance').value) : null,
      noiseModel: mode === 'misread' ? part('noise').value : null,
      probability: mode === 'misread' ? Number(part('probability').value) : null,
    };
  }
  function showInitial(initial) {
    part('size').value = `${initial.positions}x${initial.colors}`;
    part('mode').value = initial.mode;
    part('seed').value = String(initial.seed);
    if (initial.mode === 'bounded') part('allowance').value = String(initial.lieBudget);
    else {
      part('noise').value = initial.noiseModel;
      part('probability').value = String(initial.probability);
      part('policy').value = initial.policy;
    }
    buildSecret(initial.secret);
    modeControls();
  }
  function counts(positions) {
    for (const name of ['exact', 'misplaced']) {
      part(name).replaceChildren(...Array.from({ length: positions + 1 }, (_, i) => node('option', String(i))));
    }
  }
  function render() {
    const view = session?.solverView();
    const oracle = session?.oracleView();
    const end = session?.ending();
    const watch = view?.mode === 'misread';
    const live = Boolean(session && !end);
    const ready = live && view.phase === 'ready';
    const pending = live && view.phase === 'awaiting-reply';
    part('setup').disabled = Boolean(session) || restoring;
    part('next').hidden = Boolean(watch);
    part('next').disabled = !ready || busy || restoring;
    for (const name of ['step', 'play', 'pause']) part(name).hidden = !watch;
    part('step').disabled = !live || busy || playing || restoring;
    part('play').disabled = !live || busy || playing || restoring;
    part('pause').disabled = !(playing || busy) || restoring;
    part('cancel').disabled = !live;
    for (const name of ['download', 'save-local']) part(name).disabled = !session || restoring;
    part('reply-form').hidden = !(pending && !watch);
    for (const name of ['reply', 'honest', 'exact', 'misplaced']) part(name).disabled = busy || restoring || !pending;
    part('active-guess').replaceChildren();
    if (view?.turns.length) {
      const turn = view.turns.at(-1);
      part('active-guess').append(node('p', `${pending ? 'Awaiting reply to' : 'Last issued'} guess ${turn.turnId}:`), codeRow(turn.guess));
    }
    if (pending && !watch) {
      part('truth').textContent = `Truth for your locked secret: ${textReply(oracle.truth)}. False replies remaining: ${oracle.remainingBudget}. An invented all-exact reply cannot win.`;
      part('legal').textContent = `Attainable replies (exact, misplaced): ${oracle.legalReplies.map(r => `(${r.exact}, ${r.misplaced})`).join('; ')}.`;
    }
    if (!session) part('session-info').textContent = 'No active session.';
    else {
      const initial = session.initial;
      const setting = watch
        ? `${initial.noiseModel}, per-position event probability ${initial.probability}; actual per-position change probability ${Number((initial.probability * (initial.noiseModel === 'redraw' ? (initial.colors - 1) / initial.colors : 1)).toFixed(6))}; seed ${initial.seed}.`
        : `Known allowance L = ${initial.lieBudget}; ${oracle.remainingBudget} false replies remaining.`;
      part('session-info').textContent = `${initial.positions} positions / ${initial.colors} colors. ${POLICY_LABELS[initial.policy]}. ${setting}`;
    }
    part('status').textContent = restoring ? 'Restoring the saved game. Reset cancels this.'
      : !session ? 'Choose a mode and lock your secret.'
        : end === 'solved' ? `Found the code in ${view.turns.length} ${view.turns.length === 1 ? 'guess' : 'guesses'}. Review below.`
          : end === 'capped' ? `Stopped after ${QUERY_CAP} guesses without finding the code. Review below.`
            : end === 'cancelled' ? `Cancelled after ${view.turns.length} guesses. Review below.`
              : busy ? 'Computing the next guess...'
                : pending ? `Guess ${view.turns.length} is not the secret. ${watch ? 'Step or Play to sample its reply.' : 'Send an attainable reply; past replies stay fixed.'}`
                  : `${view.turns.length} / ${QUERY_CAP} queries used. ${watch ? playing ? 'Playing; Pause stops pending computation and playback.' : 'Paused. Step one turn or Play.' : 'Ask the next guess.'}${detail ? ` ${detail}` : ''}`;
    part('history').replaceChildren();
    for (const turn of view?.turns ?? []) {
      const item = node('li');
      item.append(codeRow(turn.guess), node('p', turn.outcome === 'solved'
        ? 'Correct code.'
        : `Not the code. ${turn.reply ? `Reported: ${textReply(turn.reply)}.` : 'Awaiting a reply.'}`));
      part('history').append(item);
    }
    const review = part('review');
    review.hidden = !end;
    review.replaceChildren();
    if (end) {
      const data = session.review();
      review.append(node('h3', 'Game review'), node('p', 'Fixed secret:'), codeRow(data.secret));
      if (watch) {
        const changedPositions = data.annotations.reduce((n, a) => n + a.changedPositions, 0);
        const changedReplies = data.annotations.filter(a => a.changedReply).length;
        review.append(node('p', `${changedPositions} changed positions across ${data.annotations.length} sampled replies; ${changedReplies} incorrect whole replies. Changed pegs can still produce a truthful reply.`));
      } else review.append(node('p', `${data.spent} of ${session.initial.lieBudget} false replies spent.`));
      const list = node('ol');
      for (const turn of data.turns) {
        const item = node('li');
        const annotation = data.annotations.find(a => a.turnId === turn.turnId);
        item.append(codeRow(turn.guess), node('p', `Truth: ${textReply(score(data.secret, turn.guess, data.config))}. ${turn.reply ? `Reported: ${textReply(turn.reply)}.` : 'No reply submitted.'}`));
        if (annotation) {
          item.append(node('p', annotation.changedReply ? 'Incorrect whole reply.' : 'Truthful whole reply.'));
          if (watch) item.append(node('p', `Noise events: ${annotation.attempted}; changed positions: ${annotation.changedPositions}. Temporary row:`), codeRow(annotation.temporary));
        }
        list.append(item);
      }
      review.append(list);
    }
  }

  async function advance() {
    if (!session || session.ending() || busy || restoring) return false;
    const current = session;
    const token = generation;
    busy = true;
    error('');
    render();
    try {
      if (current.solverView().phase === 'ready') {
        const result = await client.request(current.solverView(), current.initial.policy);
        if (generation !== token || current !== session) return false;
        current.issueGuess(result.guess);
        counts(current.initial.positions);
        detail = `${result.candidates} candidates before this guess; selected disagreement score ${result.disagreements}.`;
      }
      if (generation !== token || current !== session) return false;
      if (current.initial.mode === 'misread' && current.solverView().phase === 'awaiting-reply') current.sampleReply();
      return true;
    } catch (failure) {
      if (generation === token && current === session && failure.name !== 'AbortError') {
        error(failure);
        playing = false;
      }
      return false;
    } finally {
      if (generation === token && current === session) {
        busy = false;
        if (current.ending()) playing = false;
        render();
        if (current.ending()) part('status').focus({ preventScroll: true });
        else if (current.initial.mode === 'bounded' && current.solverView().phase === 'awaiting-reply') {
          part('exact').focus({ preventScroll: true });
        }
      }
    }
  }
  async function playTurn(token) {
    if (!playing || token !== generation) return;
    const ok = await advance();
    if (ok && playing && token === generation && !session.ending()) {
      // Schedule only after the previous request and its reply have completed.
      timer = setTimeout(() => { timer = null; void playTurn(token); }, 700);
    }
  }
  part('setup-form').addEventListener('submit', event => {
    event.preventDefault();
    if (session || restoring) return;
    try {
      const next = createSession(initialFromForm());
      invalidate();
      session = next;
      detail = '';
      error('');
      counts(session.initial.positions);
      render();
      if (session.initial.mode === 'bounded') void advance();
    } catch (failure) { error(failure); }
  });
  part('size').addEventListener('change', () => buildSecret());
  part('mode').addEventListener('change', modeControls);
  part('next').addEventListener('click', () => void advance());
  part('step').addEventListener('click', () => void advance());
  part('play').addEventListener('click', () => {
    if (playing || busy || restoring || !session || session.ending()) return;
    playing = true;
    render();
    void playTurn(generation);
  });
  part('pause').addEventListener('click', () => { invalidate(); detail = ''; render(); });
  part('cancel').addEventListener('click', () => {
    invalidate();
    if (session && !session.ending()) session.cancel();
    error('');
    render();
  });
  part('reset').addEventListener('click', () => {
    invalidate();
    session = null;
    detail = '';
    error('');
    render();
  });
  function answer(truth) {
    if (!session || busy || restoring || session.ending()) return;
    try {
      if (truth) session.sendTruth();
      else session.submitReply({ exact: Number(part('exact').value), misplaced: Number(part('misplaced').value) });
      error('');
      detail = '';
      render();
      part(session.ending() ? 'status' : 'next').focus({ preventScroll: true });
    } catch (failure) { error(failure); }
  }
  part('reply-form').addEventListener('submit', event => { event.preventDefault(); answer(false); });
  part('honest').addEventListener('click', () => answer(true));

  function renderExercise() {
    const mixed = part('exercise').value === 'mixed';
    part('learn-secret').replaceChildren(codeRow([1, 2, 1, 3]));
    part('learn-guess').replaceChildren(codeRow(mixed ? [1, 3, 4, 1] : [1, 1, 1, 1]));
    part('learn-result').textContent = 'Score the guess using the visible secret.';
  }
  part('exercise').addEventListener('change', renderExercise);
  part('learn-form').addEventListener('submit', event => {
    event.preventDefault();
    const mixed = part('exercise').value === 'mixed';
    const truth = score([1, 2, 1, 3], mixed ? [1, 3, 4, 1] : [1, 1, 1, 1], { positions: 4, colors: 6 });
    const correct = Number(part('learn-exact').value) === truth.exact && Number(part('learn-misplaced').value) === truth.misplaced;
    part('learn-result').textContent = `${correct ? 'Correct.' : 'Not quite.'} ${textReply(truth)}. ${mixed ? 'The first red is exact. Green and the other red are misplaced. Yellow is absent.' : 'The secret contains only two reds. Both are exact, so the extra reds earn no misplaced matches.'}`;
  });

  part('download').addEventListener('click', () => {
    if (!session || restoring) return;
    const url = URL.createObjectURL(new Blob([session.exportText()], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = 'mastermind-session.json';
    link.click();
    URL.revokeObjectURL(url);
    part('storage-status').textContent = 'Session download requested. The JSON includes your secret. No browser save was updated.';
  });
  part('save-local').addEventListener('click', () => {
    if (!session || restoring) return;
    try {
      localStorage.setItem(STORAGE_KEY, session.exportText());
      part('storage-status').textContent = 'Saved in this browser, including your secret. After reload, use Restore browser save. Later turns are not saved automatically.';
    } catch { part('storage-status').textContent = 'Browser storage is unavailable or full. No browser save was written; Download session is separate.'; }
  });
  async function restore(readText) {
    invalidate();
    const token = generation;
    restoring = true;
    error('');
    render();
    try {
      const text = await readText();
      if (token !== generation) return;
      const recovered = await restoreSession(text, {
        isCancelled: () => token !== generation,
        query: (view, policy) => client.request(view, policy),
      });
      if (token !== generation) return;
      session = recovered;
      detail = '';
      showInitial(session.initial);
      counts(session.initial.positions);
      part('storage-status').textContent = 'Session restored. Playback is paused; any unanswered guess is preserved.';
    } catch (failure) {
      if (token === generation) error(`Restore rejected: ${failure.message}. The current session was not replaced.`);
    } finally {
      if (token === generation) { restoring = false; render(); }
    }
  }
  part('restore-local').addEventListener('click', () => void restore(() => {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) throw new Error('No browser save exists');
    return text;
  }));
  part('file').addEventListener('change', () => {
    const file = part('file').files[0];
    part('file').value = '';
    if (!file) return;
    void restore(() => {
      if (file.size > MAX_SAVE_BYTES) throw new Error('File exceeds 256 KiB');
      return file.text();
    });
  });
  part('forget').addEventListener('click', () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      part('storage-status').textContent = 'Browser save deleted. The current session and downloaded files are unchanged.';
    } catch { part('storage-status').textContent = 'Browser storage is unavailable; deletion could not be confirmed.'; }
  });
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('pageshow', () => render());
  buildSecret();
  modeControls();
  renderExercise();
  render();
}

if (typeof document !== 'undefined') document.querySelectorAll('[data-mastermind]').forEach(mountMastermind);
