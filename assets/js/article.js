(() => {
  'use strict';

  const article = document.querySelector('.js-article-content');
  if (!article) return;

  article.querySelectorAll('.highlight').forEach((block) => {
    const code = block.querySelector('code[data-lang]');
    if (code) block.dataset.lang = code.dataset.lang;
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
