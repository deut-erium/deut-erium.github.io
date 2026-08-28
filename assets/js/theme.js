(() => {
  'use strict';

  const root = document.documentElement;
  const key = 'writeups-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch (_) {
    saved = null;
  }

  const apply = (theme) => {
    root.dataset.theme = theme;
    const button = document.querySelector('.theme-toggle');
    if (!button) return;
    const dark = theme === 'dark';
    button.hidden = false;
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
    button.textContent = dark ? 'Light' : 'Dark';
  };

  apply(saved === 'dark' || saved === 'light' ? saved : system.matches ? 'dark' : 'light');

  addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme || 'light');
    const button = document.querySelector('.theme-toggle');
    if (!button) return;
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(key, theme);
      } catch (_) {
        // The selected theme still applies for this page view.
      }
      apply(theme);
    });
  });

  system.addEventListener?.('change', (event) => {
    let explicit = null;
    try {
      explicit = localStorage.getItem(key);
    } catch (_) {
      explicit = null;
    }
    if (!explicit) apply(event.matches ? 'dark' : 'light');
  });
})();
