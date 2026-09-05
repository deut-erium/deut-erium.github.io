/*
 * Isolation worker for the /rooms/ Z3 escape room.
 *
 * Same job as playground/coi-serviceworker.js, copied rather than shared so
 * each harness stays self-contained: the vendored Z3 wasm build
 * (assets/vendor/z3/, see SOURCE.txt there) runs long operations on
 * pthreads, so the page must be cross-origin isolated: its own response
 * needs COOP same-origin plus COEP. Static hosts such as GitHub Pages
 * cannot send those headers, so this worker serves the page under /rooms/
 * (its scope) with them instead.
 *
 * Only document navigations are rewritten. Subresource responses are passed
 * through untouched: the embedder policy lives on the document, and tagging
 * subresources with COOP/COEP gets classic worker scripts (the Emscripten
 * pthread workers re-fetch z3-built.js) blocked with ERR_BLOCKED_BY_RESPONSE
 * in Chromium.
 *
 * Approach adapted from coi-serviceworker v0.1.7 by Guido Zuidhof (MIT),
 * https://github.com/gzuidhof/coi-serviceworker
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.status === 0) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    })
  );
});
