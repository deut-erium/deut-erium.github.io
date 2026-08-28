(() => {
  'use strict';

  const root = document.documentElement;
  const key = 'writeups-theme';
  const diceKey = 'writeups-dice';
  const faces = ('01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24' +
    ' 25 26 27 28 29 30 32 33 34 35 36 37').split(' ');
  const diceId = (value) => (/^b\d{2}$/.test(value || '') && faces.includes(value.slice(1)) ? value : null);
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = (theme) => theme === 'dark' || theme === 'light';
  let saved = null;
  let savedDice = null;
  try {
    saved = localStorage.getItem(key);
    if (!valid(saved)) {
      localStorage.removeItem(key);
      saved = null;
    }
    savedDice = diceId(localStorage.getItem(diceKey));
  } catch (_) {
    saved = null;
    savedDice = null;
  }

  const apply = (theme) => {
    root.dataset.theme = theme;
    const button = document.querySelector('.theme-toggle:not(.dice-roll)');
    if (!button) return;
    const dark = theme === 'dark';
    button.hidden = false;
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
    button.textContent = dark ? 'Light' : 'Dark';
  };

  const applyDice = (face) => {
    if (face) root.dataset.dice = face;
    else root.removeAttribute('data-dice');
  };

  apply(valid(saved) ? saved : system.matches ? 'dark' : 'light');
  applyDice(savedDice);

  const rollDice = () => {
    const options = [null, ...faces.map((n) => `b${n}`)];
    let next = options[Math.floor(Math.random() * options.length)];
    if (next === (root.dataset.dice || null)) {
      next = options[Math.floor(Math.random() * options.length)];
    }
    applyDice(next);
    try {
      if (next) localStorage.setItem(diceKey, next);
      else localStorage.removeItem(diceKey);
    } catch (_) {
      // The rolled face still applies for this page view.
    }
    const diceButton = document.querySelector('.dice-roll');
    if (diceButton) diceButton.title = next ? `Theme ${next}` : 'Default theme';
  };

  addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme || 'light');
    if (savedDice) {
      const diceButton = document.querySelector('.dice-roll');
      if (diceButton) { diceButton.hidden = false; diceButton.title = `Theme ${savedDice}`; }
    }
    const button = document.querySelector('.theme-toggle:not(.dice-roll)');
    if (button) {
      button.addEventListener('click', () => {
        const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(key, theme);
        } catch (_) {
          // The selected theme still applies for this page view.
        }
        apply(theme);
      });
    }
    const diceButton = document.querySelector('.dice-roll');
    if (diceButton) {
      diceButton.hidden = false;
      diceButton.addEventListener('click', rollDice);
    }
  });

  system.addEventListener?.('change', (event) => {
    let explicit = null;
    try {
      explicit = localStorage.getItem(key);
    } catch (_) {
      explicit = null;
    }
    if (!valid(explicit)) apply(event.matches ? 'dark' : 'light');
  });
})();
