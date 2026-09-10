/* Footer owns activation; toybox owns effects and active/restore state. */
(() => {
  'use strict';

  const footer = document.getElementById('site-footer');
  if (!footer || footer.dataset.footerReady) return;
  const buttons = Array.from(footer.querySelectorAll('.site-footer__mystery'));
  const restore = footer.querySelector('.site-footer__restore');
  const status = footer.querySelector('.site-footer__status');
  const src = footer.dataset.toyboxSrc;
  if (!buttons.length || !restore || !status || !src) return;
  footer.dataset.footerReady = 'true';

  let loading = null;
  let lastButton = buttons[0];
  const api = () => typeof window.__dtToy?.go === 'function' ? window.__dtToy : null;
  const say = (message, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const run = (slot) => {
    delete window.__dtToyPending;
    try {
      api().go(slot);
      say('');
    } catch (_) {
      say('The page toy could not start. Try another button or put everything back.', true);
    }
  };

  const activate = (button) => {
    const slot = Number(button.dataset.toySlot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 2) return;
    lastButton = button;
    if (api()) {
      run(slot);
      return;
    }

    // One request per attempt. Toybox may consume this value during evaluation,
    // before the load event. Further clicks replace it rather than queue effects.
    window.__dtToyPending = slot;
    say('Loading page toys. Your latest button choice will run.');
    if (loading) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    loading = script;
    const settle = () => {
      loading = null;
      script.onload = null;
      script.onerror = null;
    };
    const fail = () => {
      if (loading !== script) return;
      settle();
      script.remove();
      delete window.__dtToyPending;
      say('Page toys could not load. Press a mystery button to retry.', true);
    };
    script.onerror = fail;
    script.onload = () => {
      if (loading !== script) return;
      if (!api()) {
        fail();
        return;
      }
      settle();
      say('');
      // Older toybox builds consume pending themselves; API-only builds may not.
      if (typeof window.__dtToyPending === 'number') run(window.__dtToyPending);
    };
    try {
      document.head.appendChild(script);
    } catch (_) {
      fail();
    }
  };

  // Capture stops legacy toybox target listeners from firing a second time.
  // Native buttons still provide keyboard activation; links are untouched.
  footer.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !footer.contains(button) || button.disabled) return;
    if (buttons.includes(button)) {
      event.stopPropagation();
      activate(button);
    } else if (button === restore && !restore.hidden) {
      event.stopPropagation();
      delete window.__dtToyPending;
      const hadFocus = document.activeElement === restore;
      try {
        if (typeof window.__dtToy?.restore !== 'function') throw new Error('Missing restore API');
        window.__dtToy.restore();
        say('');
        if (restore.hidden && hadFocus) lastButton.focus();
      } catch (_) {
        say('The page could not be restored. Reload to put everything back.', true);
      }
    }
  }, true);

  // The lazy script may finish while this document is in the back/forward
  // cache. Keep the download, but never replay a choice from before departure.
  window.addEventListener('pagehide', () => {
    delete window.__dtToyPending;
    say('');
  });

  buttons.forEach((button) => { button.disabled = false; });
  say('');
})();
