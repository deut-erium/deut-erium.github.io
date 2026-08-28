# CI and release-gate postfix audit

Reviewed commit `87f3de8bdac521ab9d9505042c2370611d51789b`. No network access was used. The index, refs, commits, and tracked source remained unchanged. Temporary archive checks ran under `/tmp` and were removed. The checkout already contained unrelated untracked review artifacts; they were not used as source evidence except for `final-ci.md` and the requested local gate.

## Verdict

The reviewed release gate is not blocked. The executable-mode failure from the prior audit is resolved, and the current local gate is bound to the exact bytes at HEAD. Dependency installation, full-history verification, two complete builds, deterministic artifact comparison, output verification, and read-only workflow permissions all pass.

Summary: 0 affected blockers, 5 retained fragilities, 8 checked control groups, and 1 repository setting needing confirmation.

## Executable build command

Checked:

- [The workflow](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L57-L74) directly executes the wrapper twice and stops on either failure.
- [The wrapper](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/build-site.sh#L1-L28) is recorded by Git as `100755`; the other 510 tracked files are `100644`.
- A fresh `git archive HEAD` contained the wrapper as `-rwxrwxr-x` (`0775`). Direct execution from its extraction with HEAD's committer time reached `bundle` and exited 127 because this audit host has no Ruby or Bundler. It did not fail with exit 126 or `Permission denied`.
- The local gate's extracted source reports mode `0777` because it resides on the permissive `/mnt/d` mount. That value alone is not proof of the Git mode; the Git tree and fresh Linux archive provide that proof.

Impact:

- The prior Linux checkout blocker is resolved. CI can reach both build invocations.

## Current source binding and two-build determinism

Checked:

- `/mnt/d/files/n00b/github/WriteUps/agent_out/unified-87-final-gate/summary.txt` names the exact reviewed commit and records 516 files, 24,307,318 regular-file bytes, and manifest digest `bab8921d0b33dd691bf8596d6ddadb06f938e159e4356fe9f60a4bef312cdce6`.
- A new archive contained 511 tracked files. Every file byte matched `unified-87-final-gate/source` after excluding only the `node_modules` directory created by the locked npm install: no missing files, extra files, or mismatches.
- Both build logs end in successful Jekyll 4.4.1 completion. Each output contains 516 regular files and 24,307,318 bytes.
- The two 516-line manifests are byte-identical and have the summary's digest. Independently recomputing each manifest from its corresponding output matched the stored manifest. The outputs contain no symlinks, FIFOs, sockets, or other unmanifested non-regular files.
- [The workflow timestamp](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L57-L70) is derived once from HEAD and shared by both builds. The root feed contains `2026-08-28T14:45:05+05:30`, the Asia/Kolkata rendering of HEAD's `2026-08-28T09:15:05+00:00` committer time.
- The three static files changed by HEAD and copied to the site match the corresponding HEAD blobs byte-for-byte. This independently binds the output to the latest source change rather than only to a self-reported commit string.
- Fresh reruns of the current site, code-parity, heading-parity, imported-content, and static-app verifiers passed against the gate source or first output. The retained gate results also report passes for the Ruby code-frame unit test and both builds.

Fragile:

- [The comparison](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L68-L70) covers regular-file paths and bytes, not modes, directory metadata, symlinks, or mtimes. No tracked or generated symlink exists now, so this does not create a current gap.
- [The injected time](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/build-site.sh#L9-L28) makes determinism commit-specific. A commit that changes only audit material still changes time-bearing output.

Impact:

- The old stale-evidence blocker is resolved for this review. The older in-repository gate artifacts remain historical and should not be cited as evidence for HEAD; the requested `unified-87-final-gate` is the current evidence.

Fix:

- No release fix is required. Include entry type and mode in the manifests only if those properties become part of the artifact contract.

## Dependency locks and pinned setup

Checked:

- [The workflow environment and Ruby setup](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L15-L19) set `BUNDLE_FROZEN=true` before [Ruby 3.3.7 and the Bundler cache](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L32-L36) install dependencies.
- [Gemfile.lock](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/Gemfile.lock#L1-L96) fixes every resolved gem, the `x86_64-linux` platform, and Bundler 2.2.22. The gate's `bundle check` says the dependencies are satisfied, and both builds completed from the exact archived source.
- [The Node setup and install](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L38-L45) fix Node at 24.19.0 and use `npm ci --ignore-scripts --no-audit --no-fund`.
- [package.json](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/package.json#L1-L12) and [package-lock.json](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/package-lock.json#L1-L42) agree on the exact KaTeX 0.18.1 dependency. Lockfile version 3 fixes the two installed packages and includes registry integrity hashes.
- `npm ci --offline` passed in the fresh archive using the local cache. Regenerating KaTeX assets then left both lockfiles and every file under `assets/katex` unchanged, matching [the clean generated-dependency check](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L47-L55).
- All three `uses:` references are complete 40-hex commit IDs. Their upstream tag identities were not queried because this review prohibited network access.

Fragile:

- `ubuntu-24.04` is a mutable runner label, and the workflow does not select a Python patch version. The Ruby lock contains only Linux x86-64 artifacts. These choices match the current job but do not define a portable macOS or ARM archive build.

Impact:

- No dependency-lock blocker was reproduced. The exact archive used by the current gate satisfies both locked dependency sets.

## Full-history checkout and sanitization gate

Checked:

- [Checkout](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L26-L30) uses `fetch-depth: 0`. The reviewed checkout reports `false` for `--is-shallow-repository`.
- A live [history verifier](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/verify-history-sanitization.py#L19-L44) run matched the local gate result: pass across 621 commits, 4,429 reachable objects, 1,915 blobs, and 26,975,734 blob bytes, with zero forbidden-value matches.
- All four [required ancestors](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/history-sanitization.json#L3-L8) are ancestors of HEAD. Both forbidden tips and all nine forbidden blob IDs are absent from the object database. Full fsck reported no unreachable or dangling objects.
- Every current local ref is an ancestor of HEAD, so the present `HEAD`-reachable scan covers all fetched refs.
- The three attachment merges retain their first parent's tree and use the required WriteUps, sanitized CTF tutorial, and sanitized Ramblings tips as their second parent. This topology was checked independently; it is not enforced by the verifier.
- [Required-ancestor checks](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/verify-history-sanitization.py#L25-L44) preserve the prior fail-closed behavior for a depth-one checkout.

Fragile:

- [Object enumeration](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/verify-history-sanitization.py#L19-L23) scans objects reachable from HEAD, not every fetched ref. A future side branch or tag outside HEAD would not be scanned.
- [Known-value matching](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/verify-history-sanitization.py#L46-L90) checks the listed hashes only in reachable blobs. It does not scan commit or tag messages and is not a general secret scanner. The known incidents were blob-content exposures, so the current pass remains valid.

Not applicable:

- A `git archive` has no object database, so the history verifier exits 1 there. This is expected and retained from the prior report. CI provides full history; the local gate combines an independently run full-checkout history result with builds from archive-clean source.

Fix:

- If policy expands from deployable HEAD ancestry to every fetched object, enumerate all refs and scan commit and tag payloads.

## Output leak exclusions

Checked:

- [Jekyll exclusions](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/_config.yml#L35-L52) omit audit data, dependency directories, source-history stores, scripts, lockfiles, and repository documents.
- The current 516-file output contains no `.git`, `.github`, `agent_out`, `script`, `node_modules`, `vendor`, `_legacy_blobs`, or `_legacy_authored` path component. It has no top-level Gemfile, lockfile, package manifest, LICENSE, README, or CONTRIBUTING file.
- [The output verifier](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/script/verify-site.py#L470-L474) passed its source-map and build-leak checks. An independent scan found zero matches for the six known forbidden credential hashes in all 24,307,318 output bytes.
- OpenSSH private-key markers remain only in the intentionally published [RACTF challenge fixture](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/_posts/WriteUps/2020/ractf/crypto/Mysterious_Masquerading_Message/id_rsa.txt#L3). The built fixture matches that source file; it is not repository or CI key material.

Impact:

- The current artifact does not expose the repository metadata, audit records, dependency trees, or known sanitized credentials reviewed here.

## Non-deployment permissions

Checked:

- There is exactly one tracked workflow. [Its permissions](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L8-L9) grant only `contents: read`; unlisted scopes receive no access.
- [Checkout credentials](https://github.com/deut-erium/deut-erium.github.io/blob/87f3de8bdac521ab9d9505042c2370611d51789b/.github/workflows/site-check.yml#L26-L30) are not persisted.
- The workflow contains no Pages configuration, artifact upload, release, publish, or deployment step. Build output stays under `RUNNER_TEMP`.

Needs confirmation:

- Offline repository review cannot determine the GitHub Pages repository setting. A branch-source Pages deployment configured outside this workflow could still exist.

## Disposition of every prior finding

- Resolved: the build wrapper changed from Git mode `100644` to `100755`; a fresh archive is executable and both current gate builds complete.
- Resolved for current evidence: the old in-repository summaries still describe earlier commits, but the requested local gate is byte-bound to HEAD and has matching current history counts and two-build manifests.
- Retained: full-history checkout and known-history checks pass; HEAD-only object enumeration, blob-only known-value scanning, and unenforced attachment-merge topology remain documented limitations.
- Retained: dependency locks, full-SHA action pins, and read-only permissions pass; the mutable runner/Python environment and Linux-only Ruby platform remain portability limits.
- Retained: timestamp injection and two-build comparison pass; regular-file-only comparison and commit-specific time remain the defined determinism boundary.
- Retained by design: an archive cannot run the history verifier and requires explicit `BUILD_TIME` plus installed locked dependencies. The current local gate supplies those build conditions separately from the full-checkout history check.
- Retained: current output exclusions pass and the challenge private key is intentional; GitHub Pages settings remain outside offline source evidence.
