---
# Skin font preloads, split out of the inline theme bootstrap so default-skin
# visitors never download the per-skin font map. Rendered by Jekyll from
# _data/theme_font_preloads.yml; the global asset version digests that data,
# so editing the map always produces a fresh URL for this file.
---
/* Loads only when a non-default skin is active (see _includes/theme-bootstrap.html). */
(() => {
  'use strict';
  const config = window.__deuteriumTheme;
  if (!config || !config.skin || config.skin === config.defaultSkin) return;
  const preloads = {{ site.data.theme_font_preloads | jsonify }};
  const head = document.head;
  for (const fontHref of preloads[config.skin] || []) {
    if (head.querySelector('link[rel="preload"][href="' + fontHref + '"]')) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = fontHref.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    link.crossOrigin = '';
    link.href = fontHref;
    head.appendChild(link);
  }
})();
