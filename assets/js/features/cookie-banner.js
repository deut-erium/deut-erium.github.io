/* Zero-cookie parody banner (roadmap 12a): shows once per browser, every
   control dismisses identically, and the only thing stored is the dismissal
   flag. No cookie is ever written. */
(() => {
'use strict';
const D = document, K = 'deuterium-cookie-banner';
const B = D.getElementById('cookie-banner');
if (!B) return;
let seen = 0;
try { seen = localStorage.getItem(K) === '1'; } catch (_) {}
if (seen) { B.remove(); return; }
const reveal = () => { if (B.hidden) B.removeAttribute('hidden'); };
const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
const dismiss = () => {
  try { localStorage.setItem(K, '1'); } catch (_) {}
  D.removeEventListener('keydown', onKey, true);
  B.remove();
};
const sheet = D.createElement('link');
sheet.rel = 'stylesheet';
sheet.href = '/assets/css/features/cookie-banner.css?v=' + (window.__deuteriumAssetVersion || '');
sheet.onload = () => requestAnimationFrame(reveal);
D.head.appendChild(sheet);
setTimeout(reveal, 400); /* a stalled stylesheet must not hide the joke */
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
