(() => {
  'use strict';

  const root = document.documentElement;
  const config = window.__deuteriumTheme;
  if (!config) return;

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
    randomizer.addEventListener('click', () => {
      const options = Array.from(picker.options).map((option) => option.value);
      const choices = options.filter((id) => id !== picker.value);
      const id = choices[Math.floor(Math.random() * choices.length)] || defaultSkin;
      save(skinKey, id);
      applySkin(id);
      randomizer.classList.remove('is-rolling');
      requestAnimationFrame(() => randomizer.classList.add('is-rolling'));
    });
    randomizer.addEventListener('animationend', () => randomizer.classList.remove('is-rolling'));
  }

  system.addEventListener?.('change', (event) => {
    if (!stored(colorKey)) applyColor(event.matches ? 'dark' : 'light');
  });

  /* Print stylesheet on demand: it leaves the initial page load entirely and
     is fetched after window load. beforeprint is the safety net for an early
     Ctrl+P; the link is appended synchronously there, so most browsers still
     apply it in the preview. */
  const printHref = '/assets/css/print.css?v=52e91316';
  let printLink = null;
  const loadPrint = () => {
    if (printLink) return;
    printLink = document.createElement('link');
    printLink.rel = 'stylesheet';
    printLink.media = 'print';
    printLink.href = printHref;
    document.head.appendChild(printLink);
  };
  if (document.readyState === 'complete') loadPrint();
  else window.addEventListener('load', loadPrint, { once: true });
  window.addEventListener('beforeprint', loadPrint);
})();
