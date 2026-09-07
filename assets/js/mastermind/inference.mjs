import {
  configuration, code, reply, enumerateCodes, score, sameCode, integer,
  wholeReplyCost, fieldDisagreementCost,
} from './core.mjs';

function transcript(turns, config) {
  if (!Array.isArray(turns)) throw new TypeError('Turn history must be an array');
  return Array.from(turns, (turn, index) => {
    if (!turn || !['not-solved', 'solved'].includes(turn.outcome)) {
      throw new RangeError('Each turn needs a trusted referee outcome');
    }
    const guess = code(turn.guess, config);
    if (turn.outcome === 'solved') {
      if (index !== turns.length - 1 || turn.reply !== null) {
        throw new RangeError('A solved turn must be terminal and have no noisy reply');
      }
      return { guess, outcome: turn.outcome, reply: null };
    }
    if (turn.reply === null && index !== turns.length - 1) {
      throw new RangeError('Only the current turn may await a reply');
    }
    return { guess, outcome: turn.outcome, reply: turn.reply === null ? null : reply(turn.reply, config.positions) };
  });
}

function agreesWithReferee(candidate, turns) {
  return turns.every(turn => sameCode(candidate, turn.guess) === (turn.outcome === 'solved'));
}

// Trusted non-wins are observations too. The actual spent budget is private.
export function boundedCandidates(options, turns, lieBudget) {
  const config = configuration(options);
  integer(lieBudget, 'false-reply allowance', 0, 60);
  const history = transcript(turns, config);
  const candidates = [];
  for (const candidate of enumerateCodes(config)) {
    if (!agreesWithReferee(candidate, history)) continue;
    let disagreements = 0;
    for (const turn of history) {
      if (turn.reply !== null) disagreements += wholeReplyCost(score(candidate, turn.guess, config), turn.reply);
    }
    if (disagreements <= lieBudget) candidates.push(Object.freeze({ code: candidate, disagreements }));
  }
  return Object.freeze(candidates);
}

// These scores explain old replies; they are not probabilities or query policies.
// Equal scores retain lexicographic code order for repeatable comparisons.
export function rankByAgreement(options, turns, objective = 'fields') {
  const config = configuration(options);
  if (!['fields', 'replies'].includes(objective)) throw new RangeError('Unknown agreement objective');
  const history = transcript(turns, config);
  const cost = objective === 'fields' ? fieldDisagreementCost : wholeReplyCost;
  const candidates = [];
  for (const candidate of enumerateCodes(config)) {
    if (!agreesWithReferee(candidate, history)) continue;
    const disagreements = history.reduce((sum, turn) => sum + (turn.reply === null ? 0
      : cost(score(candidate, turn.guess, config), turn.reply)), 0);
    candidates.push(Object.freeze({ code: candidate, disagreements }));
  }
  return Object.freeze(candidates.sort((a, b) => a.disagreements - b.disagreements));
}
