(() => {
  'use strict';

  const root = document.documentElement;
  const key = 'writeups-theme';
  const skinKey = 'writeups-skin';
  const skins = ('01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24' +
    ' 25 26 27 28 29 30 32 33 34 35 36 37').split(' ');
  const validSkin = (value) => (/^b\d{2}$/.test(value || '') && skins.includes(value.slice(1)) ? value : null);
  const system = matchMedia('(prefers-color-scheme: dark)');
  const valid = (theme) => theme === 'dark' || theme === 'light';
  let saved = null;
  let savedSkin = null;
  try {
    saved = localStorage.getItem(key);
    if (!valid(saved)) {
      localStorage.removeItem(key);
      saved = null;
    }
    savedSkin = validSkin(localStorage.getItem(skinKey));
  } catch (_) {
    saved = null;
    savedSkin = null;
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

  let skinLink = null;
  const applySkin = (skin) => {
    if (skinLink) {
      skinLink.remove();
      skinLink = null;
    }
    if (skin) {
      skinLink = document.createElement('link');
      skinLink.rel = 'stylesheet';
      skinLink.dataset.skin = skin;
      skinLink.href = `/assets/css/skins/${skin}.css`;
      document.head.appendChild(skinLink);
    }
    if (skin) root.dataset.skin = skin;
    else root.removeAttribute('data-skin');
  };

  apply(valid(saved) ? saved : system.matches ? 'dark' : 'light');
  applySkin(savedSkin);

  const rollDice = () => {
    const options = [null, ...skins.map((n) => `b${n}`)];
    let next = options[Math.floor(Math.random() * options.length)];
    if (next === (root.dataset.skin || null)) {
      next = options[Math.floor(Math.random() * options.length)];
    }
    applySkin(next);
    try {
      if (next) localStorage.setItem(skinKey, next);
      else localStorage.removeItem(skinKey);
    } catch (_) {
      // The rolled skin still applies for this page view.
    }
    const diceButton = document.querySelector('.dice-roll');
    if (diceButton) diceButton.title = next ? `Theme ${next}` : 'Default theme';
  };

  addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme || 'light');
    const diceButton = document.querySelector('.dice-roll');
    if (diceButton) {
      diceButton.hidden = false;
      if (savedSkin) diceButton.title = `Theme ${savedSkin}`;
      diceButton.addEventListener('click', rollDice);
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
