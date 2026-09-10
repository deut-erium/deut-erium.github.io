/* Zero-cookie parody banner: one 1% draw per document. Dismissal lasts for
   this document only. No cookies or browser storage are read or written. */
(() => {
'use strict';
const D = document, sampled = Symbol.for('deuterium.cookieBannerSampled');
const B = D.getElementById('cookie-banner');
if (!B || D[sampled]) return;
D[sampled] = true;
if (!(Math.random() < 0.01)) { B.remove(); return; }
const reveal = () => { if (B.isConnected) B.hidden = false; };
const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
const dismiss = () => {
  clearTimeout(fallback);
  sheet.onload = null;
  D.removeEventListener('keydown', onKey, true);
  B.remove();
};
const sheet = D.createElement('link');
sheet.rel = 'stylesheet';
const css = D.currentScript?.src
  ? new URL('../../css/features/cookie-banner.css', D.currentScript.src)
  : null;
if (css) css.searchParams.set('v', window.__deuteriumAssetVersion || '');
sheet.href = css ? css.href : '/assets/css/features/cookie-banner.css?v=' + (window.__deuteriumAssetVersion || '');
sheet.onload = () => requestAnimationFrame(reveal);
D.head.appendChild(sheet);
const fallback = setTimeout(reveal, 400);
B.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || !B.contains(t)) return;
  if (t.hasAttribute('data-prefs')) {
    const panel = D.getElementById('cookie-banner-prefs');
    const open = t.getAttribute('aria-expanded') === 'true';
    t.setAttribute('aria-expanded', String(!open));
    if (panel) panel.hidden = open;
  } else {
    dismiss();
  }
});
D.addEventListener('keydown', onKey, true);
})();
