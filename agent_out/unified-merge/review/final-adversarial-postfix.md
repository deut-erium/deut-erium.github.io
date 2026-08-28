# Catalog failure-handling adversarial reverify

Verdict: DISPUTED

The visible startup fallbacks, state preservation, busy-state cleanup, and exception containment work at HEAD bcd9f02. Same-document recovery does not. A transient failed dynamic import leaves Chrome's module entry rejected, so selecting 6x6 after unblocking immediately fails again. The runtime size-switch failure is also only announced through a screen-reader-only status; a sighted user sees the unchanged 4x4 catalog with no failure message.

## Scope and method

- Tested only `_site-next/new-tetris/src/catalog/` through the existing loopback preview, using a new Chrome CDP target and CDP URL blocking. No external requests were made.
- The generated `catalog.js` and `index.html` were byte-for-byte equal to the current worktree versions, and both source files matched HEAD.
- Each navigation disabled the HTTP cache. CDP `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`, request/failure events, and injected `error` and `unhandledrejection` listeners were collected independently of the existing browser result.

## Startup failure paths

Checked:

- [Entry-module fallback](https://github.com/deut-erium/deut-erium.github.io/blob/bcd9f02c64e0d5c5b9855c7a1c1d0f5572444b22/new-tetris/src/catalog/index.html#L120-L131): blocking `catalog.js` produced the visible text "The local square catalog could not start. The scoring guide and game links remain available above." The machine stayed hidden, none of its 15 controls were visible, all three size buttons retained `aria-pressed="false"`, no family was selected, family fields stayed at their placeholders, and `aria-busy` was absent. The blocked script generated one resource-load error, but no script exception or unhandled rejection.
- [Initial data rejection handling](https://github.com/deut-erium/deut-erium.github.io/blob/bcd9f02c64e0d5c5b9855c7a1c1d0f5572444b22/new-tetris/src/catalog/catalog.js#L342-L380): with only `data-4.js` blocked, request order showed successful `catalog.js` and `catalog-model.js` loads before the blocked data request. The same startup fallback was visible. The machine and all controls remained hidden; size `aria-pressed` values stayed false; no family data or selection appeared; and `aria-busy` was removed. The failed import was caught and logged to the console, with no `Runtime.exceptionThrown` event or unhandled rejection.

## Runtime size-switch failure

Affected:

- [Failure status](https://github.com/deut-erium/deut-erium.github.io/blob/bcd9f02c64e0d5c5b9855c7a1c1d0f5572444b22/new-tetris/src/catalog/catalog.js#L373-L380): after a successful 4x4 startup, blocking `data-6.js` set "The 6 by 6 piece mixes could not load. The current catalog remains available." The status retained class `sr-only`, a 1x1 box, and `clip: rect(0px, 0px, 0px, 0px)`, so no failure message was visually exposed.

Checked:

- The machine remained visible and the size controls remained enabled. The selected states stayed on size 4 and family T4; size 6 stayed unpressed.
- The full T4 state was preserved exactly: 24 families, 117 layouts, title T4, gold material, score 3,500, 24 family buttons, selected family T4, a 4-row/16-cell arrangement, and step 4 of 4.
- `aria-busy` was removed. The import failure was caught and logged, with no script exception or unhandled rejection.

## Recovery counterexample

Affected:

- [Rejected-load cache path](https://github.com/deut-erium/deut-erium.github.io/blob/bcd9f02c64e0d5c5b9855c7a1c1d0f5572444b22/new-tetris/src/catalog/catalog.js#L346-L352): after the first 6x6 failure completed, URL blocking was removed and 6x6 was selected again in the same document. The retry issued zero requests for `data-6.js`, immediately logged the same rejected-import `TypeError`, kept size 4/T4 selected, and left all preserved family data unchanged. Deleting the application `Map` entry does not evict Chrome's rejected module entry for the identical import URL.
- As a control, a fresh document after unblocking did request `data-6.js`, received HTTP 200 without cache use, and initialized size 6 with 1,467 families and O9 selected. This bounds the failure to same-document retry rather than the preview server or the unblock operation.

Impact:

- A transient chunk-load failure makes that catalog size unavailable until the page is reloaded. Sighted users receive no visible explanation when this happens after startup.

Fix:

- Make retries use a fresh module URL or a loading mechanism whose failed entry can be retried, and expose the runtime failure in a visible status while retaining the live-region announcement.
