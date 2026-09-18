(() => {
  'use strict';

  const root = document.querySelector('[data-cryptography-explorer]');
  if (!root) return;

  const search = root.querySelector('#search');
  const outline = root.querySelector('#outline');
  const empty = root.querySelector('#empty');
  const clear = root.querySelector('#clear');
  const collapse = root.querySelector('#collapse');
  if (!search || !outline || !empty || !clear || !collapse) return;

  const all = [...outline.querySelectorAll('details')];
  const normalize = value => value.normalize('NFKC').toLowerCase();
  let priorOpen = null;

  function directDetails(details) {
    return [...details.children].flatMap(child =>
      child.matches('details') ? [child] : [...child.children].filter(element => element.matches('details'))
    );
  }

  function filter() {
    const words = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    if (words.length && !priorOpen) priorOpen = new Set(all.filter(details => details.open));

    if (!words.length) {
      all.forEach(details => {
        details.hidden = false;
        if (priorOpen) details.open = priorOpen.has(details);
      });
      priorOpen = null;
      empty.hidden = true;
      return;
    }

    function visit(details, inheritedMatch) {
      const ownMatch = inheritedMatch || words.every(word =>
        normalize(details.dataset.search || '').includes(word)
      );
      let childMatch = false;
      for (const child of directDetails(details)) childMatch = visit(child, ownMatch) || childMatch;
      details.hidden = !(ownMatch || childMatch);
      details.open = !details.hidden;
      return !details.hidden;
    }

    let found = false;
    for (const details of [...outline.children].filter(element => element.matches('details'))) {
      found = visit(details, false) || found;
    }
    empty.hidden = found;
  }

  function revealHash() {
    const raw = location.hash.slice(1);
    let id = raw;
    try {
      if (raw.includes('=')) {
        const params = new URLSearchParams(raw);
        id = params.get('entry') || params.get('topic') || '';
        if (params.get('q')) {
          search.value = params.get('q');
          filter();
        }
      } else {
        id = decodeURIComponent(raw);
      }
    } catch (_error) {
      return;
    }

    const target = document.getElementById(id);
    if (!target || !root.contains(target)) return;

    let hiddenByFilter = false;
    for (let parent = target; parent && root.contains(parent); parent = parent.parentElement) {
      hiddenByFilter = hiddenByFilter || parent.hidden;
    }
    if (search.value && hiddenByFilter) {
      search.value = '';
      filter();
    }
    for (let parent = target; parent && root.contains(parent); parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') {
        parent.open = true;
        parent.hidden = false;
      }
    }
    target.scrollIntoView({ block: 'start' });
  }

  search.addEventListener('input', filter);
  clear.addEventListener('click', () => {
    search.value = '';
    filter();
    search.focus();
  });
  collapse.addEventListener('click', () => all.forEach(details => { details.open = false; }));
  window.addEventListener('hashchange', revealHash);
  revealHash();
})();
