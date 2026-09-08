// Carry the include's content version into this adapter's module imports.
const dependency = file => import(new URL(file + new URL(import.meta.url).search, import.meta.url));
const { boundedCandidates, rankByAgreement, MAX_HISTORY } = await dependency('./inference.mjs');
const { integer } = await dependency('./core.mjs');

export const QUERY_CAP = MAX_HISTORY;
export const POLICIES = Object.freeze(['bounded', 'fields', 'replies']);
export const POLICY_LABELS = Object.freeze({
  bounded: 'Known-L whole-reply filter',
  fields: 'Field agreement (exact and total overlap)',
  replies: 'Whole-reply agreement',
});

export function checkDimensions(config) {
  if (!config || !((config.positions === 4 && config.colors === 6)
    || (config.positions === 3 && config.colors === 3))) {
    throw new RangeError('Choose 4 positions / 6 colors or 3 positions / 3 colors');
  }
}

export function checkPolicy(mode, policy) {
  if (!(mode === 'bounded' ? policy === 'bounded'
    : mode === 'misread' && ['fields', 'replies'].includes(policy))) {
    throw new RangeError('Policy does not match the game mode');
  }
}

// Pure query policy shared by the worker and save replay. No random tie-breaks,
// information-gain queries, minimax, Z3 or probabilistic inference.
export function chooseGuess(view, policy) {
  checkDimensions(view.config);
  checkPolicy(view.mode, policy);
  if (view.phase !== 'ready') throw new Error('A guess requires a ready referee');
  if (!Array.isArray(view.turns) || view.turns.length >= QUERY_CAP) throw new Error('Query cap reached');
  if (view.mode === 'bounded') integer(view.lieBudget, 'false-reply allowance', 0, 60);
  const candidates = view.mode === 'bounded'
    ? [...boundedCandidates(view.config, view.turns, view.lieBudget)]
      .sort((a, b) => a.disagreements - b.disagreements || lex(a.code, b.code))
    : rankByAgreement(view.config, view.turns, policy);
  if (!candidates.length) throw new Error('No candidate fits this transcript');
  return Object.freeze({
    guess: candidates[0].code,
    candidates: candidates.length,
    disagreements: candidates[0].disagreements,
  });
}

function lex(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
