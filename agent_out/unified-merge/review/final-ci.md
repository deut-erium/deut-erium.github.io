# Final CI and clean-build re-audit

Reviewed branch `unified-publishing` at commit `7996024a684838aa4cf154aa3dca2b237e771657`. The checkout is full and clean. No network access was used, and no source, refs, index entries, or commits were changed.

## Verdict

The gate is blocked. The attached histories and known-credential checks pass in the full checkout, and the only workflow has read-only permissions with no deployment step. However, the workflow cannot reach either Jekyll build on a normal Linux checkout: it executes a file recorded by Git as non-executable. The retained clean-build evidence also describes an older commit and does not reproduce this permission failure.

## Release blocker: the checked-in CI build command is not executable

[Build invocation](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L57-L70): directly executes `script/build-site.sh` twice.

Affected:

- [Build script](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/build-site.sh#L1-L28): is stored as mode `100644`, not `100755`. All 500 tracked files have mode `100644`.
- A temporary `git archive HEAD` extraction on a Linux filesystem gave the script mode `0664`; direct execution exited 126 with `Permission denied`.
- The mounted working tree reports mode `0777` despite Git recording `100644`. A local gate run on this mount can therefore hide the failure that `actions/checkout` will reproduce on the Ubuntu runner.

Impact:

- The job can install dependencies and run source checks, but it stops at the first build command. It never performs the second build, hash comparison, or output verifiers.

Fix:

- Record the script as executable in Git, or invoke it as `sh script/build-site.sh` in both CI and the documented build command. No fix was applied in this audit.

## Attached-history checkout and verifier

[Full-history checkout](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L26-L30): uses `fetch-depth: 0`, which is required by the history gate.

Checked:

- The current full checkout is not shallow. All four [required source tips](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/history-sanitization.json#L3-L8) are ancestors of `HEAD`.
- A current run of [the verifier](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/verify-history-sanitization.py#L19-L44) passed across 614 commits, 4,350 reachable objects, 1,884 blobs, and 26,577,011 blob bytes, with zero forbidden-value matches.
- The two original unsafe tips and all nine listed forbidden blob IDs are absent from the local object database. `git fsck --full --no-reflogs --unreachable --dangling` produced no findings.
- The three attachment merges have the required sanitized tip as their second parent and preserve their first parent's tree. This topology was checked manually; the CI verifier itself does not check unchanged-tree merge structure.
- A local depth-one clone contained one commit and failed closed, reporting all four required ancestors missing. A shallow checkout cannot pass accidentally.

Fragile:

- [Object enumeration](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/verify-history-sanitization.py#L19-L23) covers objects reachable from `HEAD`, not every fetched ref. All current refs are ancestors of `HEAD`, so there is no present coverage gap. A future side branch or tag fetched by the full checkout would be outside the scan.
- [Credential matching](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/verify-history-sanitization.py#L46-L90) checks the nine known blob IDs and six hashed values in reachable blobs. It does not scan commit or tag messages and is not a general secret scanner. The known exposures were blob content, so this limitation does not invalidate the current pass.

Fix:

- If the intended boundary is the entire fetched repository, enumerate `--all` and include commit and tag payloads. If the boundary is only deployable ancestry, document that narrower claim.

## Dependency locks, action pins, and permissions

Checked:

- [Job environment](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L15-L19) sets `BUNDLE_FROZEN=true` before `ruby/setup-ruby` performs its cached install. Ruby is fixed at 3.3.7, and [Gemfile.lock](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/Gemfile.lock#L84-L96) records the Linux platform and Bundler 2.2.22.
- [Node setup and install](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L38-L45) fix Node at 24.19.0 and use `npm ci --ignore-scripts`. A temporary package/lock mismatch made `npm ci` exit 1 as expected.
- [Generated dependency check](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L47-L55) regenerates KaTeX assets and rejects changes to both lockfiles and `assets/katex`.
- All three `uses:` references are full 40-hex commit SHAs. Their upstream tag identities were not queried because network access was prohibited.
- [Workflow permissions](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L8-L9) grant only `contents: read`; [checkout credentials](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L26-L30) are not persisted.

Fragile:

- `ubuntu-24.04` and its Python installation are not pinned to an image digest or Python patch release. The Ruby lock is Linux x86-64 only, which matches this job but not a portable archive build on macOS or ARM.

## Timestamping and deterministic comparison

Checked:

- [CI timestamp injection](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/.github/workflows/site-check.yml#L57-L70) exports the ISO 8601 committer time of `HEAD` once and uses it for both builds.
- [Build wrapper](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/build-site.sh#L9-L28) requires an explicit timestamp outside Git, injects it as Jekyll `site.time`, fixes locale and timezone defaults, and disables the Jekyll disk cache.
- The workflow hashes every regular output file in sorted path order and compares the two manifests byte-for-byte.

Fragile:

- The comparison covers file bytes and paths, not modes, directories, symlinks, or mtimes. No tracked symlink or submodule exists, so this has no current source-side effect.
- Determinism is per commit, not per unchanged public source tree. An audit-only commit changes `HEAD`'s committer time and therefore changes time-bearing output such as the root feed.

Affected:

- [Retained gate summary](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/gate/summary.txt#L1-L4) records source commit `80352dbe...`, while current `HEAD` is `7996024a...`. Its two 506-line manifests are internally identical and their recorded digest is correct, but they are not evidence for the current commit.
- [Retained history result](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/gate/history-sanitization.json#L1-L14) records 612 commits and 4,331 objects; the current verifier sees 614 and 4,350.

Impact:

- The stored clean-build evidence cannot establish that current `HEAD` builds or that its artifact matches the old manifest. The live workflow would be the current proof, but it is blocked by the executable mode error.

## Artifact exclusions and deployment absence

Checked:

- [Jekyll exclusions](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_config.yml#L35-L52) omit `agent_out`, legacy source stores, dependency directories, scripts, lockfiles, and repository documents.
- The retained 506-file output contains no `.git`, `.github`, `agent_out`, `script`, `node_modules`, `vendor`, lockfile, manifest, workflow, or history-sanitization path. This is supporting evidence from an older output, not a fresh current build.
- The private-key marker in the output belongs to the intentionally published [RACTF challenge fixture](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_posts/WriteUps/2020/ractf/crypto/Mysterious_Masquerading_Message/id_rsa.txt), not repository or CI key material.
- The attached histories live under `.git`, which `git archive` omits and Jekyll does not publish.
- There is one workflow. It has no Pages configuration, artifact upload, release, or deploy action, and its output remains under `RUNNER_TEMP` until job teardown.

Needs confirmation:

- Repository-controlled CI is non-deploying. Offline source review cannot establish the GitHub Pages repository setting; a separately configured branch-source Pages deployment could exist outside this workflow.

## Clean archive divergence from CI

Affected:

- A `git archive` has no Git database. [The history verifier's `git rev-list HEAD`](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/verify-history-sanitization.py#L19-L23) therefore exits 1 with a traceback in an archive, while CI supplies full history.
- The archive preserves the non-executable build script, exposing the same command failure as Linux CI. The retained gate's source path was on the permissive mounted filesystem, so it did not test Git's executable mode faithfully.
- Calling the wrapper through `sh` in the archive proceeds to its explicit [missing BUILD_TIME check](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/build-site.sh#L9-L17). CI derives the value from Git before invoking the wrapper.
- CI acquires Ruby through its pinned setup action. This audit host has no Ruby, Bundler, Jekyll, container runtime, or retained Ruby cache, so a fresh Jekyll build and independent artifact comparison could not be run without network access.

A clean archive can test the source build only when the caller supplies `BUILD_TIME` and locked dependencies. History verification must run separately in a full checkout. The current checked commands do not provide one local gate that reproduces both CI conditions.

## Local command results

- Shell syntax for `script/build-site.sh`: pass.
- Python compilation for `script/verify-history-sanitization.py`: pass.
- Current full-history verifier: pass.
- Depth-one history verifier: fail closed as intended.
- Archive direct build invocation: exit 126, permission denied.
- Archive history verification: exit 1, no Git repository.
- npm lock consistency and mismatch rejection: pass.
- Working tree after review: clean except for this requested report.
