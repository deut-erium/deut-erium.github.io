(() => {
  'use strict';

  const hex = (buffer) => [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  document.querySelectorAll('[data-flag-check]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.elements.flag;
      const output = form.querySelector('output');
      const candidate = input.value.trim();
      if (!candidate) {
        output.textContent = 'Enter a flag before checking.';
        input.focus();
        return;
      }
      if (!globalThis.crypto?.subtle) {
        output.textContent = 'This browser does not provide the local SHA-256 API.';
        return;
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate));
      const correct = hex(digest) === form.dataset.sha256;
      output.textContent = correct ? 'Correct. The flag matches.' : 'Incorrect. Check the exact spelling and case.';
      output.className = correct ? 'flag-check__result is-correct' : 'flag-check__result is-wrong';
    });
  });
})();
