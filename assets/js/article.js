(() => {
  'use strict';

  const content = document.querySelector('.js-article-content, .page-prose');
  if (!content) return;

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const initialOverflowUpdates = [];
  const announce = async (node, message, isCurrent = () => true) => {
    node.textContent = '';
    await nextFrame();
    if (!isCurrent()) return false;
    node.textContent = message;
    return true;
  };

  content.querySelectorAll('[data-code-frame]').forEach((frame) => {
    const highlight = frame.querySelector(':scope > .code-frame__viewport > .highlight, :scope > .highlight');
    const pre = highlight?.querySelector('pre');
    const code = pre?.querySelector('code');
    const copyButton = frame.querySelector('[data-copy-code]');
    const wrapButton = frame.querySelector('[data-wrap-code]');
    const status = frame.querySelector('.code-frame__status');
    if (!highlight || !pre || !code || !copyButton || !wrapButton || !status) return;

    const source = code.textContent;
    const lineSource = source.endsWith('\n') ? source.slice(0, -1) : source;
    const lineCount = lineSource.split('\n').length;
    const language = frame.dataset.language || 'plain text';
    if (!frame.querySelector(':scope > .code-frame__viewport')) {
      const viewport = document.createElement('div');
      const gutter = document.createElement('div');
      viewport.className = 'code-frame__viewport';
      gutter.className = 'code-frame__gutter';
      gutter.setAttribute('aria-hidden', 'true');
      gutter.textContent = Array.from({ length: lineCount }, (_, line) => line + 1).join('\n');
      highlight.before(viewport);
      viewport.append(gutter, highlight);
    }

    const updateOverflow = () => {
      const overflow = pre.scrollWidth > pre.clientWidth + 1;
      if (overflow) {
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', `${language} code; horizontally scrollable`);
      } else {
        pre.removeAttribute('tabindex');
        pre.removeAttribute('aria-label');
      }
    };
    if ('ResizeObserver' in window) new ResizeObserver(updateOverflow).observe(pre);
    else addEventListener('resize', updateOverflow);
    initialOverflowUpdates.push(updateOverflow);

    let copyAttempt = 0;
    const removeFallback = () => frame.querySelector('.code-frame__fallback')?.remove();
    const manualFallback = async (message, attempt) => {
      if (attempt !== copyAttempt) return;
      removeFallback();
      if (!await announce(status, message, () => attempt === copyAttempt)) return;
      const fallback = document.createElement('textarea');
      fallback.className = 'code-frame__fallback';
      fallback.readOnly = true;
      fallback.spellcheck = false;
      fallback.wrap = 'off';
      fallback.value = source;
      fallback.setAttribute('aria-label', 'Exact code selected for manual copy');
      fallback.setAttribute('aria-describedby', status.id);
      frame.append(fallback);
      fallback.focus({ preventScroll: true });
      fallback.select();
      fallback.setSelectionRange(0, fallback.value.length);
      fallback.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    };

    copyButton.disabled = false;
    copyButton.hidden = false;
    copyButton.addEventListener('click', async () => {
      const attempt = ++copyAttempt;
      let clipboard;
      let writeText;
      try {
        clipboard = navigator.clipboard;
        writeText = clipboard?.writeText;
      } catch (error) {
        await manualFallback(error?.name === 'NotAllowedError'
          ? 'Clipboard permission denied; exact code selected below.'
          : 'Clipboard unavailable; exact code selected below.', attempt);
        return;
      }
      if (typeof writeText !== 'function') {
        await manualFallback('Clipboard unavailable; exact code selected below.', attempt);
        return;
      }
      try {
        await writeText.call(clipboard, source);
        if (attempt !== copyAttempt) return;
        removeFallback();
        if (await announce(status, `Copied ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}.`, () => attempt === copyAttempt)) copyButton.focus();
      } catch (error) {
        await manualFallback(error?.name === 'NotAllowedError'
          ? 'Clipboard permission denied; exact code selected below.'
          : 'Clipboard unavailable; exact code selected below.', attempt);
      }
    });

    wrapButton.disabled = false;
    wrapButton.hidden = false;
    wrapButton.addEventListener('click', () => {
      const wrapped = frame.classList.toggle('is-wrapped');
      wrapButton.setAttribute('aria-pressed', String(wrapped));
      updateOverflow();
    });
  });

  requestAnimationFrame(() => {
    initialOverflowUpdates.forEach((update) => update());
  });

  const article = document.querySelector('.js-article-content');
  if (!article) return;

  article.querySelectorAll('.highlight').forEach((block) => {
    const frame = block.closest('[data-code-frame]');
    if (frame) block.dataset.lang = frame.dataset.language;
  });

  const headings = [...article.querySelectorAll('h2[id], h3[id], h4[id]')];
  headings.forEach((heading) => {
    const title = heading.textContent.trim();
    heading.dataset.tocTitle = title;
    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = `#${encodeURIComponent(heading.id)}`;
    anchor.setAttribute('aria-label', `Link to ${title}`);
    anchor.textContent = '#';
    heading.append(anchor);
  });

  const toc = document.querySelector('.js-toc-root');
  if (!toc || !headings.length) return;

  toc.textContent = '';
  const list = document.createElement('ol');
  headings.forEach((heading) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    item.className = `toc-${heading.tagName.toLowerCase()}`;
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.dataset.tocTitle;
    item.append(link);
    list.append(item);
  });
  toc.append(list);
})();
