# Public browser-practice test fixtures

CI restores only files listed in manifest.json to agent_out/challenge-runtime/ before running script/test-practice-*.mjs. Each file has a byte count and SHA-256 digest. The tracked source files live here; agent_out remains ignored scratch space.

These are local copies of the port workers' public test dependencies, not new downloads. They contain deterministic reference controls and public dummy rewards, not private event answers. Most suites compare generated vectors with JavaScript helpers and full interactions. Known entropy or state in a control does not establish an independent puzzle solve.

- b00tleg, IDEA, Law and Order, RandSubWare and the three simple ports use retained vectors. IDEA also checks its vector manifest. The suites hash the relevant mirrored source under assets/challenges/.
- Blokechain uses its retained vectors and AST-only reference-functions.py snapshot. Its source hash and extraction boundary remain in the vector metadata. The optional original extracted source is not needed by CI.
- The simple-port suite also hashes sources/cheater-challenge.py. Its bytes were checked against challenge.py inside the mirrored cheater-mind player handout. Tests hash this file but do not run its top-level loop or secret import.
- Bloom regenerates its reference results from the two mirrored Python sources using reference.py and murmur3-reference.c. It needs Python 3 and a C compiler, not mmh3 or other Python packages. The reference selects AST definitions and supplies the public dummy reward before any extracted method can import it.
- Session fixtures provide a worker_threads bridge, a computation-only termination fixture, and a public chaos collision witness. They load the production Worker and ports without a network connection. Fake Worker tests cover lifecycle failures separately.

Original download provenance and licenses remain in the public catalog and assets/challenges/licenses/. The fixture files are copied unchanged; manifest.json records the retained bytes.
