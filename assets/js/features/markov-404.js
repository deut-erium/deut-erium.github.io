/* The build supplies public-title recombinations; this file only selects one. */
(() => {
  'use strict';

  const data = document.getElementById('markov-404-data');
  const title = document.getElementById('markov-404-title');
  const another = document.getElementById('markov-404-another');
  if (!data || !title || !another) return;

  let candidates;
  try {
    candidates = JSON.parse(data.textContent);
  } catch (_) {
    return;
  }
  if (!Array.isArray(candidates) || candidates.length > 32 ||
      candidates.some(value => typeof value !== 'string' || !value.trim() || value.length > 320)) return;
  candidates = [...new Set(candidates)];
  if (!candidates.length) return;

  let current = candidates.indexOf(title.textContent);
  const choose = () => {
    // Map a draw over n-1 slots around the current index, with no retry loop.
    const skip = current >= 0 && candidates.length > 1;
    let next = Math.floor(Math.random() * (candidates.length - (skip ? 1 : 0)));
    if (skip && next >= current) next++;
    title.textContent = candidates[next];
    current = next;
  };

  choose();
  if (candidates.length > 1) {
    another.addEventListener('click', choose);
    another.disabled = false;
    another.hidden = false;
  }
})();
