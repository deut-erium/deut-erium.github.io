(() => {
  'use strict';

  const root = document.documentElement;
  const colorKey = 'deuterium-theme';
  const skinKey = 'deuterium-skin';
  const defaultSkin = 'rpn-garden';
  const skins = new Set([
    'rpn-garden', 'grid-meltdown', 'proof-bonbons', 'the-exploit-grimoire',
    'form-follows-failure', 'key-exchange-kiosk', 'cryptographic-blockbuster',
    'thirteen-orphans', 'orbiting-footnotes', 'pretty-ugly-proofs',
    'monsters-in-the-math', 'the-hash-crash', 'mercury-keyspace',
    'proof-by-confetti', 'cut-paste-factor', 'the-house-always-seeds',
    'cathedral-of-constraints', 'soft-shell-exploits', 'rsa-vs-the-world',
    'palace-of-excess', 'mutant-mathematics', 'the-impossible-proof',
    'the-boundary-repeats', 'edge-conditions', 'maximum-gain',
    'exploit-in-b-flat', 'root-in-seven', 'high-lonesome-protocol',
    'sam-at-sunrise', 'unknown-at-rf-0-73', 'collision-atlas',
    'stack-underflow', 'the-undecidable-register', 'the-fat-tail-register',
    'the-interlocking', 'the-clause-exchange', 'margin-of-error', 'layer-shift',
    'root-access', 'gravity-glove-evidence', 'presence-check', 'weak-joints',
    'riff-atlas', 'the-pit-index', 'the-descent', 'magnetic-index',
    'twin-blades', 'crowd-signal'
  ]);
  const system = matchMedia('(prefers-color-scheme: dark)');

  const skinFiles = {
    'grid-meltdown': '01-grid-meltdown.css',
    'proof-bonbons': '02-proof-bonbons.css',
    'the-exploit-grimoire': '03-the-exploit-grimoire.css',
    'form-follows-failure': '04-form-follows-failure.css',
    'key-exchange-kiosk': '05-key-exchange-kiosk.css',
    'cryptographic-blockbuster': '06-cryptographic-blockbuster.css',
    'thirteen-orphans': '07-thirteen-orphans.css',
    'orbiting-footnotes': '08-orbiting-footnotes.css',
    'pretty-ugly-proofs': '09-pretty-ugly-proofs.css',
    'monsters-in-the-math': '10-monsters-in-the-math.css',
    'the-hash-crash': '11-the-hash-crash.css',
    'mercury-keyspace': '12-mercury-keyspace.css',
    'proof-by-confetti': '13-proof-by-confetti.css',
    'cut-paste-factor': '14-cut-paste-factor.css',
    'the-house-always-seeds': '15-the-house-always-seeds.css',
    'cathedral-of-constraints': '16-cathedral-of-constraints.css',
    'soft-shell-exploits': '17-soft-shell-exploits.css',
    'rsa-vs-the-world': '18-rsa-vs-the-world.css',
    'palace-of-excess': '19-palace-of-excess.css',
    'mutant-mathematics': '20-mutant-mathematics.css',
    'the-impossible-proof': '21-the-impossible-proof.css',
    'the-boundary-repeats': '22-the-boundary-repeats.css',
    'edge-conditions': '23-edge-conditions.css',
    'maximum-gain': '24-maximum-gain.css',
    'exploit-in-b-flat': '25-exploit-in-b-flat.css',
    'root-in-seven': '26-root-in-seven.css',
    'high-lonesome-protocol': '27-high-lonesome-protocol.css',
    'sam-at-sunrise': '28-sam-at-sunrise.css',
    'unknown-at-rf-0-73': '29-unknown-at-rf-0-73.css',
    'collision-atlas': '30-collision-atlas.css',
    'stack-underflow': '31-stack-underflow.css',
    'the-undecidable-register': '32-the-undecidable-register.css',
    'the-fat-tail-register': '33-the-fat-tail-register.css',
    'the-interlocking': '34-the-interlocking.css',
    'the-clause-exchange': '35-the-clause-exchange.css',
    'margin-of-error': '36-margin-of-error.css',
    'layer-shift': '37-layer-shift.css',
    'root-access': '38-root-access.css',
    'gravity-glove-evidence': '39-gravity-glove-evidence.css',
    'presence-check': '40-presence-check.css',
    'weak-joints': '41-weak-joints.css',
    'riff-atlas': '42-riff-atlas.css',
    'the-pit-index': '43-the-pit-index.css',
    'the-descent': '44-the-descent.css',
    'magnetic-index': '45-magnetic-index.css',
    'twin-blades': '46-twin-blades.css',
    'crowd-signal': '47-crowd-signal.css'
  };

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
    button.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
    button.textContent = dark ? 'Light' : 'Dark';
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
    stylesheet.href = stylesheet.dataset.skinBase + filename;
    stylesheet.disabled = false;
  };

  const applySkin = (id) => {
    const skin = skins.has(id) ? id : defaultSkin;
    if (skin === defaultSkin) {
      delete root.dataset.skin;
    } else {
      root.dataset.skin = skin;
    }
    loadSkin(skin);
    const picker = document.querySelector('#skin-picker');
    if (picker) picker.value = skin;
    const summary = document.querySelector('.skin-menu summary');
    if (summary) summary.textContent = 'Theme: ' + skinName(skin);
  };

  const savedColor = stored(colorKey);
  applyColor(savedColor === 'dark' || savedColor === 'light' ? savedColor : system.matches ? 'dark' : 'light');
  applySkin(skins.has(stored(skinKey)) ? stored(skinKey) : defaultSkin);

  addEventListener('DOMContentLoaded', () => {
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
      });
    }
  });

  system.addEventListener?.('change', (event) => {
    if (!stored(colorKey)) applyColor(event.matches ? 'dark' : 'light');
  });
})();
