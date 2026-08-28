# Rendering and interaction audit

Audit target: `unified-publishing` at `0a8cd613ef338cb2487d189b60d14745453cd877`.

## Result

The candidate has five confirmed interaction defects. The most important is the no-JavaScript challenge form fallback: submitting a flag performs a native GET and puts the candidate in the URL. The challenge checker also permits stale digest results to overwrite newer results.

The current code-frame, KaTeX, MathML, local-font, YouTube, JavaScript archive-filter, and valid-theme-persistence paths passed the checks described below. The existing Python verifiers pass despite the confirmed defects because they count markup and compare imported code text; they do not execute these interactions.

## Confirmed defects

### Challenge forms disclose the candidate through a no-JavaScript GET

The [shared form has no method or action and keeps an enabled submit button](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/checkflag.html#L2-L9). Its named `flag` input therefore participates in a native GET whenever the challenge script is unavailable.

Affected:

- All 10 forms on six generated pages use the shared markup.
- With script execution disabled in Chrome, the form reported `method=get`, its submit button remained enabled, and submitting `audit-secret` navigated from the article URL to the same URL with `?flag=audit-secret`.
- The `noscript` message explains that checking requires JavaScript, but it does not stop submission.

Impact:

- A candidate flag enters the address bar, browser history, the request URL, and potentially hosting logs. This contradicts the form's claim that the check runs locally.

Bounds:

- The [JavaScript submit handler calls `preventDefault()`](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/challenge.js#L8-L12), so the leak requires the script to be blocked, absent, or to fail before registration.
- CTF flags are not authentication credentials, but the page should not transmit arbitrary user input after promising a local check.

Fix:

- Render the submit button disabled, register the handler, then enable it as the last initialization step. Keep the no-JavaScript explanation visible. Removing the successful control's `name` would also prevent native GET serialization, but the script would need a different input lookup.

### Challenge results are not ordered and digest failures are unhandled

The [async submit handler awaits Web Crypto without an attempt token or exception handling](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/challenge.js#L9-L26).

Affected:

- In Chrome, two controlled digest promises were resolved out of order. The newer submission first displayed `Incorrect`; the older promise then resolved and replaced it with `Correct`.
- A forced `OperationError` from `crypto.subtle.digest()` produced an unhandled promise rejection and left the initial output unchanged.

Impact:

- Rapid or delayed submissions can report the result for an older candidate as if it belonged to the current input. A digest failure provides no actionable status.

Bounds:

- SHA-256 over these short flags normally finishes quickly, so the natural race window is small. It remains reachable through repeated submission and becomes more likely on delayed or instrumented Web Crypto implementations.
- Missing `crypto.subtle` is handled before the await. Rejection after the API-presence check is not handled.

Fix:

- Maintain a monotonically increasing attempt number per form and update output only when the completed attempt is still current. Catch digest and encoding failures and show a neutral local-check error. Disabling the button during a digest can reduce duplicate submissions but should not replace stale-result protection.

### Challenge validation branches retain stale result styling

The [empty-input and missing-Web-Crypto branches only replace text](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/challenge.js#L13-L22); the [success and failure branches assign the classes](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/challenge.js#L23-L26).

Affected:

- After an incorrect check, submitting an empty value displayed `Enter a flag before checking.` while retaining `flag-check__result is-wrong`.
- After the same incorrect check, forcing Web Crypto to be unavailable changed the message but retained the wrong-result class. The symmetric path retains the success class after a correct result.

Impact:

- Neutral instructions and capability errors remain visually marked as a success or failure. This is misleading state, although the text itself is correct.

Fix:

- Reset the output to its base class at the start of every submission, then add a result class only after a completed comparison.

### Archive filter controls remain active but do nothing without JavaScript

The [filter input and tag links are emitted as active controls](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_layouts/archive.html#L11-L30), while all filtering is implemented by the [deferred archive script](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/archive.js#L12-L59).

Affected:

- With script execution disabled, `/archive.html?tag=RSA` showed all 78 records and the static count `78`; the search input remained enabled.
- A no-JavaScript user can type in the search field with no result, and tag links reload an unfiltered archive while leaving the tag in the URL.

Impact:

- Filtering is presented as available when it is not. All records remain accessible, so this is degraded usability rather than content loss.

Fix:

- Mark the controls unavailable in static markup and enable or reveal them after the script initializes. Add a short `noscript` note that the complete archive is shown.

### An invalid saved theme blocks later system-theme changes

Initial theme selection [accepts only `dark` or `light`](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/theme.js#L7-L25), but the [system change handler treats every nonempty stored string as an explicit valid choice](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/theme.js#L42-L50).

Affected:

- With `writeups-theme=sepia` and an initial dark system preference, the page correctly fell back to dark. Changing the emulated system preference to light left the page dark because `sepia` was truthy.

Fragile:

- The site's own toggle writes only valid values. This requires stale, corrupted, manually edited, or extension-modified storage.

Impact:

- A user without a valid explicit preference stops following system changes until the invalid key is removed or the toggle overwrites it.

Fix:

- Use the same `dark` or `light` validation in both paths. Remove or ignore every other stored value.

## Verifier blind spots

Affected:

- [The site verifier counts forms, script references, code frames, and MathML nodes](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/verify-site.py#L124-L141). It does not exercise form submission, asynchronous ordering, archive behavior, clipboard fallback, wrapping, or theme transitions. It passed with every defect above present.
- [Code parity is limited to the WriteUps manifest](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/verify-code-parity.py#L12-L13) and [compares code-text hashes for those routes](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/verify-code-parity.py#L46-L64). It covers 311 of 328 code frames. The other 17 frames, all `data-lines` values, and every rendered `data-source-sha256` attribute are outside that comparison.
- The [synthetic Ruby frame test checks generated hashes](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/test-code-frames.rb#L28-L35), and [CI runs that test before building](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/.github/workflows/site-check.yml#L38-L42). It does not validate every rendered frame or any browser interaction.

Fragile:

- The [KaTeX pruning script uses a fixed three-font allowlist](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/prune-katex-css.py#L7-L26); it does not derive required families from rendered math. The current corpus needs only those faces, but a future `mathbb`, calligraphic, large-operator, or similar expression could fall back to a system font while the pruning check still passes.
- The [KaTeX stylesheet is selected by front matter](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/head.html#L23-L25), not by detected output. Current scoping is exact, but the verifier checks only the global MathML count and does not enforce a per-page stylesheet-to-math relationship.

Fix:

- Add browser smoke tests for the interaction mutations in this report.
- Extend generated-site validation to all 328 frames and compare decoded code text with `data-lines` and `data-source-sha256`.
- Validate each page's KaTeX output against stylesheet presence and map rendered font classes to published font faces.

## Checked behavior

### Code frames, copy, wrapping, lines, and hashes

Checked:

- A static sweep decoded all 328 generated frames. Every [server-generated line count and source hash](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/code_frames.rb#L47-L58) matched the rendered code text and [frame metadata](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/code_frames.rb#L74-L100).
- The imported WriteUps parity verifier passed: 61 pages and 311 blocks.
- Chrome at a 360 px viewport produced 18 gutter entries for an 18-line frame. The frame stayed within the document with no page-level horizontal overflow. The unwrapped pre had a 793 px scroll width in a 204 px client width and received keyboard focusability.
- [Runtime copy reads `code.textContent`](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/article.js#L16-L28). A browser-computed SHA-256 matched the frame attribute, and successful clipboard copy was byte-for-byte equal to that text.
- Clipboard absence, a throwing clipboard getter, and a rejected `NotAllowedError` all reached the [manual textarea fallback](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/article.js#L55-L104). Its value was exact, the complete range was selected, focus moved to it, and only one fallback remained.
- Out-of-order copy completions respected [the copy-attempt guard](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/article.js#L55-L60). A latest success survived a stale failure, and a latest failure survived a stale success.
- The [wrap toggle](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/article.js#L107-L114) set `aria-pressed`, hid the gutter, removed stale scroll focusability, and reduced the tested pre to equal 265 px scroll and client widths. Unwrapping restored the gutter and scroll focusability.
- Without JavaScript, copy and wrap remained hidden and disabled, no synthetic gutter was added, and the highlighted source remained readable and horizontally scrollable.

### KaTeX, MathML, and fonts

Checked:

- The four source pages marked for math were exactly the four generated pages loading KaTeX CSS. They contained 106 expressions: 11, 33, 1, and 61 per page. No expression was outside `.prose`.
- Every expression contained one `<math>`, `<semantics>`, and TeX annotation. Every visual `.katex-html` tree had `aria-hidden=true`.
- Chrome exposed the MathML tree in its accessibility tree. The tested MathML nodes were not ignored despite the [display-MathML containment rule](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/css/main.css#L1411-L1445).
- At a 320 px viewport, the 12 display expressions in Curvy Decryptor stayed within 227 px containers and caused no page-level horizontal overflow.
- Chrome loaded and decoded Atkinson Hyperlegible 400/700, Silkscreen 400/700, KaTeX Main 400/700, and KaTeX Math Italic. All seven requests were same-origin and completed without a loading failure. `fc-scan` also reported the intended family, style, and weight metadata.
- All CSS font URLs resolve in both source and `_site`. The built CSS and JavaScript assets are byte-identical to their source counterparts.

### YouTube opt-in

Checked:

- The generated corpus has 11 YouTube watch links on eight pages, zero iframes, and zero YouTube embed URLs.
- The CTF tutorial rendered four [plain opt-in links](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/extensions/youtube.html#L1-L3). Chrome made no YouTube request before activation and loaded no external resource. External links were not activated during the audit.

### Archive filtering with JavaScript

Checked:

- All 130 normalized row tags have matching filter links; all `data-search` values are lowercase.
- `?tag=RSA` normalized to `rsa`, marked the matching controls current, showed 16 records, and hid empty year groups.
- Adding the text query `hsctf` intersected with the RSA tag and showed three records. Escape cleared and blurred the query and restored 16.
- Selecting All removed the query and restored all 78 records. An unknown tag showed zero records, hid all year groups, and exposed the empty state.

### Theme persistence and checker baseline

Checked:

- With no saved theme, an emulated dark preference selected dark before interaction and exposed a correctly labeled pressed toggle.
- Toggling to light stored `writeups-theme=light`; a navigation retained light even while the system preference remained dark.
- Removing the key restored system-following behavior. Storage exceptions are caught, and the selected theme still applies for the current view.
- With JavaScript disabled, the theme control remains hidden and CSS supplies the light default.
- All 10 challenge forms contain a 64-character lowercase hexadecimal hash. Normal Web Crypto checks produced the expected correct and incorrect messages.

## Test bounds

- Static checks ran against the local source and existing `_site` at the named commit. The audit did not rebuild because the task was read-only.
- `python3 -B script/verify-site.py _site` passed with 138 HTML pages, 328 code frames, 106 math expressions, and 10 challenge forms. `python3 -B script/verify-code-parity.py _site` passed with 61 pages and 311 blocks.
- Browser checks used headless Chrome for Testing 152.0.7977.54 over localhost at 320 px and 360 px viewports. Runtime conditions changed only in the local test session to force clipboard, digest, stored-theme, media-preference, no-JavaScript, and out-of-order completion paths.
- Ruby was unavailable in this environment, so `script/test-code-frames.rb` was inspected but not executed locally. CI is configured to run it with Ruby 3.3.7.
- No Firefox or Safari engine was available. No external link was activated, and no deployment, push, source edit, staging, or commit occurred.
