(() => {
  'use strict';

  const query = document.querySelector('.js-archive-query');
  const rows = [...document.querySelectorAll('[data-record]')];
  const groups = [...document.querySelectorAll('[data-year-group]')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  const count = document.querySelector('.js-result-count');
  const empty = document.querySelector('.js-archive-empty');
  if (!query || !rows.length) return;

  let tag = (new URLSearchParams(location.search).get('tag') || '').toLowerCase();

  function apply() {
    const text = query.value.trim().toLowerCase();
    let visible = 0;

    rows.forEach((row) => {
      const tags = (row.dataset.tags || '').split('|');
      const matchesTag = !tag || tags.includes(tag);
      const matchesText = !text || (row.dataset.search || '').includes(text);
      row.hidden = !(matchesTag && matchesText);
      if (!row.hidden) visible += 1;
    });

    groups.forEach((group) => {
      group.hidden = !group.querySelector('[data-record]:not([hidden])');
    });
    filters.forEach((filter) => {
      if ((filter.dataset.filter || '') === tag) filter.setAttribute('aria-current', 'true');
      else filter.removeAttribute('aria-current');
    });

    count.textContent = String(visible);
    empty.hidden = visible !== 0;
  }

  document.addEventListener('click', (event) => {
    const filter = event.target.closest('[data-filter]');
    if (!filter) return;
    event.preventDefault();
    tag = filter.dataset.filter || '';
    const url = new URL(location.href);
    if (tag) url.search = `?tag=${encodeURIComponent(tag)}`;
    else url.search = '';
    history.replaceState(null, '', url);
    apply();
  });

  query.addEventListener('input', apply);
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      query.value = '';
      query.blur();
      apply();
    }
  });

  apply();
})();
