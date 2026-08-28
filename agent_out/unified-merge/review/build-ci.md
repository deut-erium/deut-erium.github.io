# Build and CI audit

Reviewed commit `0a8cd613ef338cb2487d189b60d14745453cd877` on `unified-publishing`. The repository was not edited, staged, committed, pushed, or deployed. No network access was used.

## Verdict

**Not ready for a GitHub Pages cutover.** The checked-in workflow describes a credible custom Jekyll build and compares two builds after fixing `site.time`, but it is only a check workflow. There is no Pages artifact deployment workflow, and the source depends on custom plugins and a non-Pages Jekyll stack that native GitHub Pages cannot reproduce.

The clean archive passed the source-integrity checks and an offline `npm ci`. The full clean build and independent two-build comparison remain unverified because this host has no Ruby, Bundler, Ruby dependency cache, or container runtime. This is an audit-environment blocker, not proof that the repository build fails.

## Findings

### Release blocker: no compatible GitHub Pages publishing path

Affected:

- `.github/workflows/site-check.yml:1-68` checks source and output but never configures Pages, uploads a Pages artifact, or deploys it.
- `_config.yml:60-65` requires `jekyll-postfiles`; `_plugins/katex_math.rb:7-80`, `_plugins/legacy_paths.rb`, `_plugins/render_compatibility.rb`, and `_plugins/section_metadata.rb` supply required build behavior.
- `Gemfile:3-10` selects Jekyll 4.4.1 and plugins outside the native GitHub Pages dependency set.

The custom plugins are not optional presentation hooks. They assign section routes and layouts, publish postfiles and legacy aliases, render KaTeX, and transform code frames. A native safe-mode Pages build would omit or alter those outputs. No `.nojekyll`, prebuilt publication branch, or custom Pages deployment workflow exists at this commit.

Impact:

- A Pages configuration that builds the repository branch directly cannot be expected to produce the verified 505-file site.
- The check workflow can pass without publishing anything.

Fix:

- Add a separate custom Pages workflow that runs the frozen build and verifiers, then uploads and deploys the verified output. Keep deployment approval separate from this audit.
- Do not switch Pages to branch-source Jekyll for this candidate.

### High confidence: the release gate overstates its coverage

Affected:

- `agent_out/unified-merge/REPORT.md:58-68` says the gate confirms the robots files. `script/verify-site.py:90-99` does not require any robots file, and no later check mentions one.
- A mutation test removed all four robots files from a copy of the existing output. `python3 script/verify-site.py <copy>` still exited 0 and reported `status: pass`.
- `agent_out/unified-merge/REPORT.md:36` says the source verifier rejects added imported content. `script/verify-imported-content.py:15-23` enumerates additions only under `_posts`.
- A clean-archive mutation added `WriteUps/unmanifested-attachment.txt`. `python3 script/verify-imported-content.py` still exited 0 and reported 319 verified files.
- `script/verify-site.py:222-234` prints `posts: 78`, `merged_tags: 130`, and `external_runtime_resources: 0` as constants. The post total is never derived. The tag check at lines 192-196 verifies one rendered phrase rather than counting tag records.
- `script/verify-site.py:132-153` uses exact aggregate counts. These catch ordinary drift but are substitution-prone: one missing item and one unrelated replacement can preserve a total. Feed checks count entries without checking expected membership, uniqueness, or order.
- The claimed six pages with challenge forms are not counted as pages. Lines 124-139 total form and script occurrences across all HTML.

Checked:

- All 319 imported-manifest paths are unique, and every tracked file under `_posts` is represented.
- The static-app verifier is exhaustive for files under `new-tetris` (`script/verify-static-app.py:13-29`).
- The code-parity metadata agrees with its route map: 61 routes and 311 block hashes. Each listed route is checked (`script/verify-code-parity.py:53-63`).
- The historical manifest has 101 unique HTML paths. Legacy data has 24 unique alias paths and 76 unique attachment paths.

Impact:

- A green workflow does not substantiate every claim in the checked-in release report.
- Missing robots files and unmanifested non-post content can pass. Aggregate totals can conceal balanced omissions.
- The tracked gate JSON and summary are not regenerated or compared by CI, so they can become stale while checks remain green.

Fix:

- Maintain an expected output manifest for all required public files, including all robots files, and reject missing and unexpected outputs by path and hash where byte identity is required.
- Enumerate additions across every imported source root, not only `_posts`.
- Derive reported totals from parsed output and assert route/feed membership, not just totals.
- Regenerate gate evidence in CI or stop presenting checked-in gate files as current CI evidence.

### CI dependency freezing begins after Bundler has already installed

Fragile:

- `ruby/setup-ruby` has `bundler-cache: true` at `.github/workflows/site-check.yml:23-27`, which performs the Bundler install.
- `BUNDLE_FROZEN=true` is scoped only to the later build step at lines 44-50.
- The repository does not check `git diff --exit-code` after dependency setup.

The workflow itself therefore does not prove that the setup-time install was frozen. This depends on undocumented behavior of the pinned setup action. If that action permits a stale lock to be updated, the later frozen build sees the repaired working-tree lock and passes.

The local instructions are weaker: `README.md:17` runs plain `bundle install`, which may update `Gemfile.lock`.

Fix:

- Set `BUNDLE_FROZEN=true` at job scope before `ruby/setup-ruby`.
- Check that setup did not modify `Gemfile.lock`.
- Use `bundle config set --local frozen true` or an equivalent documented frozen install in local instructions.

### CI does not run automatically on direct pushes to the candidate branch

Needs confirmation:

- `.github/workflows/site-check.yml:3-7` runs on pushes to `master`, pull requests, and manual dispatch. A direct push to `unified-publishing` does not trigger it.

This is safe only if all candidate changes are required to pass through a protected pull request. Branch-protection settings are not present in the checkout and were not queried.

### Local build instructions are not the reproducible CI build

Affected:

- `README.md:17-23` does not pin Node or Python, freeze Bundler, disable Jekyll's disk cache, set locale/timezone, inject a stable `site.time`, run the code-frame unit test, or compare two output trees.
- The root Atom feed uses `site.time`. The CI fixes it to the commit time at `.github/workflows/site-check.yml:56-61`; the documented build does not.
- The CI time wrapper requires Git metadata. A source archive has no `HEAD`, so the wrapper is not itself an archive-build command.

Impact:

- Following the README can produce a different root feed timestamp on each build and does not reproduce the CI gate.
- A contributor can pass the documented checks without running all CI checks.

Fix:

- Provide one checked-in build script used by both README and CI. Accept a stable build epoch or timestamp when `.git` is absent.

### Dependency lock is exact for CI but Linux x86-64 only

Checked:

- Ruby is pinned to 3.3.7 in `.ruby-version:1` and the workflow.
- Jekyll resolves to 4.4.1 and all Ruby transitive versions are recorded in `Gemfile.lock`.
- Bundler is recorded as 2.2.22 (`Gemfile.lock:95-96`).
- Node is pinned to 24.19.0 in CI. KaTeX is exactly 0.18.1 in both npm files, and the lock carries registry integrity hashes.
- Every action reference is a full 40-hex commit SHA. There are no floating action tags. The remote tag identities behind the `v6` comments were not resolved because network access was not allowed.

Fragile:

- `Gemfile.lock:84-85` contains only `x86_64-linux`, with platform-specific `ffi`, `google-protobuf`, and `sass-embedded` packages at lines 15-17 and 77. This matches the hosted Ubuntu x86-64 job but does not provide a frozen macOS or ARM build.
- There is no local Node version file. Python and the `ubuntu-24.04` runner image contents are not pinned.
- `npm run sync-katex-assets` is not part of CI. A future KaTeX update could leave tracked CSS or fonts stale without a failure.

Current KaTeX state is good: regeneration from the offline-installed package produced the same CSS SHA-256, and all three retained WOFF2 files matched the package byte-for-byte.

## Generated-time and determinism review

The CI writes the commit's ISO committer time to a temporary Jekyll config and supplies that same file to both builds (`site-check.yml:53-61`). It disables the disk cache, fixes locale and timezone, hashes every regular output file in sorted path order, and compares the two manifests (`site-check.yml:63-65`). No tracked source symlinks or submodules exist, so omission of symlink and mode comparison has no current effect.

The checked-in reproducibility claim at `agent_out/unified-merge/REPORT.md:88-95` was not independently reproduced. Only one summary digest is retained; the two per-build manifests and logs are absent. A single digest cannot prove that two separate builds matched.

The reported `combined bytes: 19,968,657` equals the directory-inclusive result of `du -sb _site`, including 741,376 bytes of directory metadata. The sum of the 505 regular file lengths in the existing ignored output is 19,227,281 bytes. The number is reproducible for that tree but is not a file-payload byte count.

## Clean archive attempt

The clean tree came from `git archive HEAD`; it had 461 tracked files and contained neither `_site` nor `node_modules`. The archive includes 11 tracked files under `agent_out` (267,338 bytes), but `_config.yml:36` excludes that directory from Jekyll output. No untracked repository files were copied into the clean tree. npm used only the local cache and offline mode.

Commands and results:

```sh
work=$(mktemp -d /tmp/unified-ci-audit.XXXXXX)
git archive --format=tar HEAD | tar -xf - -C "$work"
cd "$work"
python3 script/verify-imported-content.py
python3 script/verify-static-app.py
python3 -m py_compile script/*.py
npm ci --offline --ignore-scripts --no-audit --no-fund
npm ls --all
printf '%s\n' '{"tex":"x^2 + y^2","display":false}' | node script/katex-renderer.mjs
npm run sync-katex-assets
```

Results:

- Imported source: pass, 319 files.
- Static app: pass, 29 files.
- Python syntax: pass.
- Offline npm install: pass, two packages (`katex@0.18.1` and `commander@8.3.0`).
- KaTeX renderer smoke test: pass.
- Generated CSS: unchanged, SHA-256 `f69a65eb5961821ab8bcfe8369ed650c93b81c1463c1380a9e0cc6a95b15b124`.
- Three retained KaTeX fonts: byte-identical to `node_modules/katex/dist/fonts`.
- Node syntax for `script/katex-renderer.mjs`: pass.
- JSON syntax for the build manifests, `package.json`, and `package-lock.json`: pass.
- Shell syntax for the deterministic workflow block: pass.

Blocker:

```text
ruby: command not found
bundle: command not found
jekyll: command not found
docker: command not found
```

No Ruby/Bundler cache or alternate container runtime was present. Network acquisition was not allowed, so `bundle install`, either Jekyll build, `ruby script/test-code-frames.rb`, the post-build verifiers on a fresh output, and the independent two-build comparison could not be run.

The existing ignored `_site` was used only for verifier mutation tests. It was not used as clean-build evidence. Its `verify-site.py` JSON currently matches the tracked `gate/site-verification.json` byte-for-byte.

## Exclusions and ignored dependencies

- `_site`, Jekyll caches, Bundler state, `vendor`, `node_modules`, and Python bytecode are ignored (`.gitignore:1-7`). None entered the archive build.
- `_config.yml:35-51` excludes dependency trees, manifests, scripts, reports, legacy blob storage, and the root `assigments` directory. The selected legacy blobs are reintroduced by the checked custom plugin after hash validation.
- The duplicated `node_modules` exclusion and absent `directorize.py` entry are harmless cleanup issues.
- The nested `ctf-tutorials/assigments` attachment is not hidden by the root-only `assigments` exclusion and is covered by the imported manifest.

## False or unsupported release claims

| Claim | Verdict | Evidence |
|---|---|---|
| The gate confirms robots files | False | All four can be removed and `verify-site.py` still passes. |
| The imported-content verifier rejects added imported content | False as written | It rejects added `_posts` files only; an added `WriteUps` attachment passes. |
| Two builds produced identical hashes | Not disproved, but not independently auditable from retained files | The workflow performs the comparison, but its two manifests and logs are not stored. |
| `combined bytes` is output payload size | Misleading | It includes directory `st_size`; regular files total 19,227,281 bytes. |
| The workflow is deterministic at one commit | Supported by static review, locally unverified | Commit time is injected into both builds and regular-file hashes are compared. |
