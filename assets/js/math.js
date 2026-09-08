/* Native math scrolling, only when the rendered expression needs it. */
(() => {
  'use strict';
  const prose = [...document.querySelectorAll('.prose')];
  if (!prose.length) return;
  const owned = new WeakMap();
  const observed = new Set();
  let queued = false;

  function blockParent(element) {
    let parent = element.parentElement;
    while (parent && ['inline', 'contents'].includes(getComputedStyle(parent).display)) parent = parent.parentElement;
    return parent;
  }
  function setOwned(element, name, value) {
    let attributes = owned.get(element);
    if (!attributes) { attributes = new Map(); owned.set(element, attributes); }
    if (!element.hasAttribute(name) || element.getAttribute(name) === attributes.get(name)) {
      element.setAttribute(name, value);
      attributes.set(name, value);
    }
  }
  function update() {
    queued = false;
    const roots = [...document.querySelectorAll('.prose .katex')];
    const viewports = [...document.querySelectorAll('.prose .katex-display')];
    const targets = new Set();
    for (const root of roots) {
      if (root.parentElement.classList.contains('katex-display')) continue;
      const parent = blockParent(root);
      if (!parent) continue;
      const style = getComputedStyle(parent);
      const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const runs = [...root.querySelectorAll(':scope > .katex-html > .katex-base')];
      const tooWide = runs.some(run => run.getBoundingClientRect().width > available + 1);
      root.classList.toggle('math-scroll', tooWide);
      if (tooWide || root.querySelector('.mtable')) viewports.push(root);
      targets.add(parent);
    }
    for (const viewport of viewports) {
      targets.add(viewport);
      const horizontal = viewport.scrollWidth > viewport.clientWidth + 1;
      const vertical = viewport.scrollHeight > viewport.clientHeight + 1;
      if (horizontal || vertical) {
        setOwned(viewport, 'tabindex', '0');
        setOwned(viewport, 'role', 'group');
        setOwned(viewport, 'aria-label', horizontal && vertical ? 'Math formula; scroll horizontally and vertically' : horizontal ? 'Math formula; scroll horizontally' : 'Math formula; scroll vertically');
        setOwned(viewport, 'data-math-scroll', '');
      }
    }
    const overflowing = new Set(viewports.filter(v => v.scrollWidth > v.clientWidth + 1 || v.scrollHeight > v.clientHeight + 1));
    for (const element of [...roots, ...viewports]) {
      if (overflowing.has(element)) continue;
      for (const [name, value] of owned.get(element) ?? []) {
        if (element.getAttribute(name) === value) element.removeAttribute(name);
      }
      owned.delete(element);
    }
    if (resize) {
      for (const element of observed) if (!targets.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of targets) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
    }
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const content = new MutationObserver(schedule);
  prose.forEach(element => content.observe(element, { childList: true, subtree: true }));
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-theme', 'class', 'style'] });
  document.addEventListener('load', event => { if (event.target.tagName === 'LINK') schedule(); }, true);
  window.addEventListener('resize', schedule);
  document.fonts?.ready.then(schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  schedule();
})();
