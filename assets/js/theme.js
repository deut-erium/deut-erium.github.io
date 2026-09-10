---
sitemap: false
---
(() => {
  'use strict';

  const root = document.documentElement;
  const config = window.__deuteriumTheme;
  if (!config || window.__dtThemeReady) return;
  window.__dtThemeReady = true;

  const { colorKey, skinKey, defaultSkin, skinFiles, skinBase } = config;
  const skins = new Set([defaultSkin, ...Object.keys(skinFiles)]);
  const system = matchMedia('(prefers-color-scheme: dark)');

  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };

  const save = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Preferences still apply for the current page view.
    }
  };

  const skinName = (id) => {
    const option = document.querySelector('#skin-picker option[value="' + id + '"]');
    return option ? option.textContent : 'RPN Garden';
  };

  const applyColor = (theme) => {
    root.dataset.theme = theme;
    const button = document.querySelector('.theme-toggle');
    if (!button) return;
    const dark = theme === 'dark';
    button.hidden = false;
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };

  const loadSkin = (skin) => {
    const stylesheet = document.querySelector('#skin-stylesheet');
    if (!stylesheet) return;
    if (skin === defaultSkin) {
      stylesheet.disabled = true;
      stylesheet.removeAttribute('href');
      return;
    }
    const filename = skinFiles[skin];
    if (!filename) return;
    // Entries are absolute, content-versioned paths; keep bare-filename
    // support so an unversioned map still resolves.
    const target = new URL(filename.startsWith('/') ? filename : skinBase + filename, document.baseURI).href;
    if (stylesheet.href !== target) stylesheet.href = target;
    stylesheet.disabled = false;
  };

  const applySkin = (id) => {
    const skin = skins.has(id) ? id : defaultSkin;
    if (skin === defaultSkin) delete root.dataset.skin;
    else root.dataset.skin = skin;
    loadSkin(skin);
    const picker = document.querySelector('#skin-picker');
    if (picker) picker.value = skin;
    const summary = document.querySelector('.skin-menu summary');
    if (summary) summary.textContent = 'Theme: ' + skinName(skin);
  };

  applyColor(root.dataset.theme || 'light');
  applySkin(root.dataset.skin || defaultSkin);

  const button = document.querySelector('.theme-toggle');
  if (button) {
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      save(colorKey, theme);
      applyColor(theme);
    });
  }

  const picker = document.querySelector('#skin-picker');
  if (picker) {
    picker.addEventListener('change', () => {
      save(skinKey, picker.value);
      applySkin(picker.value);
    });
  }

  const randomizer = document.querySelector('.skin-dice');
  if (randomizer && picker) {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let rollFrame = 0;
    let generation = 0;
    let away = false;
    let visible = !window.__dtDecorations;
    const stopRoll = () => {
      generation += 1;
      cancelAnimationFrame(rollFrame);
      rollFrame = 0;
      randomizer.classList.remove('is-rolling');
    };
    // This one-shot flourish is discarded when interrupted; skin selection
    // still works while hidden or with reduced motion enabled.
    window.__dtDecorations?.watch(randomizer, (running) => {
      visible = running;
      if (!running) stopRoll();
    });
    const canRoll = () => visible && !away && !document.hidden && !motion.matches;
    const checkRoll = () => { if (!canRoll()) stopRoll(); };
    document.addEventListener('visibilitychange', checkRoll);
    if (motion.addEventListener) motion.addEventListener('change', checkRoll);
    else motion.addListener?.(checkRoll);
    window.addEventListener('pagehide', () => { away = true; stopRoll(); });
    window.addEventListener('pageshow', () => { away = false; });
    randomizer.addEventListener('click', () => {
      const options = Array.from(picker.options).map((option) => option.value);
      const choices = options.filter((id) => id !== picker.value);
      const id = choices[Math.floor(Math.random() * choices.length)] || defaultSkin;
      save(skinKey, id);
      applySkin(id);
      stopRoll();
      if (!canRoll()) return;
      const ticket = generation;
      // Let the removal paint before restarting; no forced offsetWidth read.
      rollFrame = requestAnimationFrame(() => {
        if (ticket !== generation) return;
        rollFrame = requestAnimationFrame(() => {
          if (ticket !== generation) return;
          rollFrame = 0;
          if (canRoll()) randomizer.classList.add('is-rolling');
        });
      });
    });
    const endRoll = (event) => {
      // A cancellation from the previous roll must not cancel its replacement.
      if (!rollFrame && event.animationName === 'skin-dice-roll') stopRoll();
    };
    randomizer.addEventListener('animationend', endRoll);
    randomizer.addEventListener('animationcancel', endRoll);
  }

  system.addEventListener?.('change', (event) => {
    if (!stored(colorKey)) applyColor(event.matches ? 'dark' : 'light');
  });


})();
