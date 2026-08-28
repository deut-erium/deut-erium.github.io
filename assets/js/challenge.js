(() => {
  'use strict';

  const hex = (buffer) => [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  document.querySelectorAll('[data-flag-check]').forEach((form) => {
    const input = form.querySelector('[data-flag-input]');
    const button = form.querySelector('button[type="submit"]');
    const output = form.querySelector('output');
    if (!input || !button || !output) return;

    let currentAttempt = 0;
    const report = (message, state = '') => {
      output.textContent = message;
      output.className = `flag-check__result${state ? ` ${state}` : ''}`;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const attempt = ++currentAttempt;
      const candidate = input.value.trim();
      report('Checking locally...');

      if (!candidate) {
        report('Enter a flag before checking.');
        button.disabled = false;
        input.focus();
        return;
      }
      if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) {
        report('This browser does not provide the local SHA-256 API.');
        button.disabled = false;
        return;
      }

      button.disabled = true;
      try {
        const bytes = new TextEncoder().encode(candidate);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        if (attempt !== currentAttempt) return;
        const correct = hex(digest) === form.dataset.sha256;
        report(
          correct ? 'Correct. The flag matches.' : 'Incorrect. Check the exact spelling and case.',
          correct ? 'is-correct' : 'is-wrong',
        );
      } catch (_) {
        if (attempt === currentAttempt) {
          report('The local check failed. Try again or use another browser.');
        }
      } finally {
        if (attempt === currentAttempt) button.disabled = false;
      }
    });

    button.disabled = false;
  });
})();
