# 05f - Operations, Build, Deployment, And Recovery Deep Dive

## Inputs Read

Target: `65b4ea38a2ad51c2da632a576acc2d74f4d12d46`.

The required stage artifacts were not present at the target commit: `agent_out/audit/00-source-freeze.md`, `00b-external-intel.md`, `01-scope-threat.md`, `02-recon-inventory.md`, `03-handbook-routing.md`, `03b-design-skeptic.md`, `03c-prior-audit-review.md`, `03d-bug-history.md`, and `04-conformance.md`. This review therefore used the user-specified commit as the source freeze and self-routed the requested CI, history, artifact, dependency, deployment, and recovery checks.

Inputs read:

- [CI workflow](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/.github/workflows/site-check.yml#L1-L76).
- [Build wrapper](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/build-site.sh#L1-L28), [Ruby version](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/.ruby-version#L1), [Gemfile](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/Gemfile#L1-L10), [Gemfile.lock](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/Gemfile.lock#L1-L96), [package.json](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/package.json#L1-L12), and [package-lock.json](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/package-lock.json#L1-L42).
- [Artifact manifest generator](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/artifact_manifest.py#L1-L102), [artifact tests](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/test-artifact-manifest.py#L1-L84), and [site verifier integration](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/verify-site.py#L273-L281).
- [History verifier](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/verify-history-sanitization.py#L1-L260), [history tests](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/test-history-sanitization.py#L1-L181), and [history manifest](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/script/history-sanitization.json#L1-L74).
- Source/output verifiers: `verify-imported-content.py`, `verify-static-app.py`, `verify-site.py`, `verify-code-parity.py`, `verify-heading-parity.py`, `test-code-frames.rb`, `prune-katex-css.py`, and their JSON manifests.
- [_config.yml exclusions](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/_config.yml#L35-L52), [.gitignore](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/.gitignore#L1-L7), and [documented build procedure](https://github.com/deut-erium/deut-erium.github.io/blob/65b4ea38a2ad51c2da632a576acc2d74f4d12d46/README.md#L15-L37).
- Relevant prior local evidence: `agent_out/unified-merge/review/build-ci.md`, `final-ci.md`, `final-ci-postfix.md`, `agent_out/unified-merge/history/SANITIZATION.md`, `agent_out/unified-merge/REPORT.md`, and the retained two-build gate at `agent_out/unified-merge/gate/`.
- New local evidence: [source and unit-gate log](evidence/local-gates.log), [domain search](evidence/domain-self-check.txt), [artifact comparison summary](evidence/artifact-manifest-summary.txt), and the two complete JSONL manifests in `evidence/`.

No Dockerfile, container configuration, CODEOWNERS file, SRS, proving key, verifying key, deployment workflow, release-upload step, KMS/HSM configuration, governance mechanism, migration procedure, or incident/recovery runbook exists in the target tree.

## Routing Decision

| Handbook section | Applies? | Paths checked | Result |
|---|---:|---|---|
| CI and fresh-checkout execution | YES | `.github/workflows/site-check.yml`, `script/build-site.sh`, version and lock files | Checked; no source-level execution blocker found for the specified GitHub-hosted Linux runner. |
| Deterministic generation and artifact integrity | YES | Workflow build block, `artifact_manifest.py`, tests, `verify-site.py`, retained build trees | Checked; every generated file and directory entry is represented, and unsupported entry types fail closed. |
| Source-history and credential-removal integrity | YES | History verifier, tests, manifest, sanitization notes | Checked; the new code covers all local refs plus HEAD, commit/tag/blob values, exact forbidden objects, and attachment topology. |
| Dependency and action supply chain | YES | Workflow action pins, Gem/npm locks, KaTeX regeneration | Checked for local pinning and drift; upstream action identity and registry availability were not queried. |
| Deployment authority and release blocking | MAYBE | Workflow inventory, permissions, checkout settings, repository docs | The workflow is a read-only check and does not deploy. Whether it is a required release check and how Pages publishes are repository settings unavailable offline. |
| Governance, pause, upgrade, migration, recovery | NO for application logic; MAYBE operationally | Workflow inventory, docs, scripts, trigger searches | No application governance surface exists. No deployment rollback or incident runbook is source-defined; confirm the external Pages/release process. |
| ZK setup/model artifact integrity | NO | SRS/proving-key/verifying-key/model/checkpoint searches | No relevant artifacts or generation paths found. CTF prose hits are published content, not operational keys. |

## Domain Self-Check Search

| Trigger search | Matches? | Evidence | Action |
|---|---:|---|---|
| `Dockerfile` | NO | No tracked match or container file | No container review. |
| `workflow` | YES | CI workflow and one authored post | Reviewed the sole workflow; post hit is not operational. |
| `deploy` | YES | Only authored post prose; no workflow command | Classified source deployment as absent and repository settings as unknown. |
| `script` | YES | Workflow, README, `script/`, and published content | Reviewed every CI-invoked script and distinguished downloadable CTF scripts. |
| `SRS` | YES | Seven CTF-content hits | Not applicable to this static-site build; no setup artifact exists. |
| `proving key` | NO | No tracked match | Not applicable. |
| `verifying key` | NO | No tracked match | Not applicable. |
| `artifact` | YES | Workflow, README, manifest generator/tests, site verifier | Performed complete-entry comparison and mutation-oriented review. |
| `feature` | YES | Site/content prose and application code | No release feature-flag mechanism found. |
| `env` | YES | Workflow environment and CTF content | Reviewed job locale, timezone, frozen Bundler mode, production Jekyll environment, and build time. |
| `secret` | YES | Predominantly CTF prose plus history review material | Reviewed known-value and known-object history gate; did not treat challenge material as operational credentials. |
| `upgrade` | YES | One game-source hit | Not an administrative upgrade path. |
| `pause` | YES | Game behavior and prose | Not an emergency release pause mechanism. |
| `timelock` | NO | No tracked match | Not applicable. |
| `admin` | YES | CTF challenge content | Not an operational admin surface. |
| `governance` | NO | No tracked match | Not applicable to application logic. |
| `migration` | YES | One prose hit | No operational migration tooling. |
| `recovery` | YES | CTF/post/404 terminology | No deployment recovery mechanism; retained as an external-process question. |
| `incident` | YES | Posts and font licenses | No incident runbook found. |

The exhaustive path counts and representative matches are in `evidence/domain-self-check.txt`.

## Routed Handbook Section Execution

| Handbook section | Required questions applied | Files/functions inspected | Evidence | Result | Gaps |
|---|---|---|---|---|---|
| Fresh checkout and toolchain | Does checkout contain full history? Are invoked files executable? Are runtimes and dependencies pinned for the chosen runner? | Workflow lines 23-45; build wrapper; Git tree modes; Ruby/npm locks | `fetch-depth: 0`; wrapper is Git mode `100755`; Ruby 3.3.7 and Node 24.19.0 are selected; Gem lock targets `x86_64-linux`; npm lock has integrity hashes | PASS for a fresh GitHub-hosted Ubuntu x86-64 checkout | Audit host lacks Ruby. Current action availability and upstream SHA identities were not network-verified. |
| Deterministic release output | Is one stable time used? Are both independent output roots compared? Are paths, bytes, modes, empty directories, and unsupported types handled? | Workflow lines 59-76; build wrapper lines 9-28; manifest traversal and tests | One `BUILD_TIME` from target HEAD is exported before both builds; sorted recursive manifests are compared by `cmp`; retained A/B trees each produced 702 identical entries (516 files, 186 directories) | PASS | Owner, group, mtimes, and xattrs are outside the declared publish-artifact contract. Comparison is within one job, not across runner-image revisions. |
| History sanitization | Does the gate reject shallow clones, unsafe objects anywhere in the fetched object database, side refs, commit/tag values, and altered attachment topology? | `load_manifest`, `verify_attachment_merges`, `scan_forbidden_values`, `verify`, tests | Local target run passed across 625 commits and 4 refs; tests rejected a shallow clone, side-ref commit value, unreachable forbidden object, and wrong merge parent | PASS | Server-side refs and credential revocation status are unavailable offline. It remains a known-value gate, not a general secret scanner. |
| Generated dependencies and source binding | Can dependency generation silently dirty source? Are imported/static content manifests checked before build? | Workflow lines 44-57; npm files; import/static verifiers; KaTeX generator | Offline `npm ci` and KaTeX regeneration passed; scoped `git diff --exit-code` remained clean; source verifiers passed | PASS | Ruby gems have version/platform pinning but no lockfile checksum section. Registry/cache availability remains external. |
| CI authority | What token can untrusted code access? Are credentials persisted? Can this workflow publish? | Workflow permissions and checkout settings | `contents: read`, no persisted checkout credential, no upload/deploy step, 15-minute timeout | PASS as an unprivileged check | Required-check, branch protection, environment, and Pages-source settings are not in Git. |
| Deployment and recovery | Does the checked gate publish exactly the verified tree, and is rollback documented? | Sole workflow and repository docs | No deployment or artifact upload exists; output remains under `RUNNER_TEMP` | COVERAGE LIMITATION, not a defect in this check-only workflow | A release needs a separately reviewed Pages setting/workflow and rollback procedure. |

`03-handbook-routing.md` was absent, so no preassigned `YES` or `MAYBE` row could be reconciled. The table above preserves every section self-routed from the user request and repository evidence.

## Prior Bug / Advisory Variant Checks

| Source item | Prior pattern / advisory | Files/functions inspected | Result | Gaps |
|---|---|---|---|---|
| Prior local CI audit | Direct execution of a Git mode `100644` wrapper blocked Linux builds | Workflow build calls; `git ls-tree` for `script/build-site.sh` | RESOLVED: target records mode `100755` and the POSIX shebang is valid. | Current mount cannot provide meaningful Unix modes; Git tree mode and prior native-Linux archive evidence were used. |
| Prior local CI postfix | Determinism compared regular-file paths and bytes only | New workflow comparison; `manifest_entries`; unit tests | RESOLVED: file/directory paths and modes are emitted, file size/hash are emitted, and symlink/special entries fail. | Metadata outside the documented artifact contract is not compared. |
| Prior local CI postfix | History scan covered HEAD blobs but not side refs, commit/tag payloads, or attachment topology | `verify_attachment_merges`, `SCANNED_KINDS`, `rev-list --all`, history tests | RESOLVED: all local refs plus HEAD are enumerated; blobs, commits, tags, and three recorded merge topologies are checked. | Trees are not value-scanned; the known incidents were content/config values, not credential-bearing filenames. |
| Prior build/deploy review | Workflow did not itself deploy, and Pages settings were unknown | Sole workflow, permissions, repository docs | RETAINED AS SETTINGS/PROCESS LIMITATION: the check remains non-deploying by design. | Offline review cannot establish required-check or Pages settings. |
| Prior history/security review | Already-public OAuth secret required provider-side revocation or rotation | Sanitization report, history manifest, local object checks | Sanitized target history passes; original unsafe tips and nine blobs are absent locally. | Provider-side revocation cannot be established from source. Treat as an owner prerequisite, not a CI implementation defect. |
| Dependency advisory review | No relevant `PRIOR-*` or `HIST-*` advisory artifact was supplied | Required audit-input paths, lockfiles, workflow | No advisory variant was omitted from supplied stage artifacts because those artifacts were absent. Local prior-review variants above were checked instead. | No network advisory lookup was allowed. |

## Authority And Artifact Integrity Map

| Surface | Authority/artifact | How changed/generated | Protection | Risk | Evidence |
|---|---|---|---|---|---|
| CI definition | `.github/workflows/site-check.yml` | Repository commit | Read-only job token; actions pinned to 40-hex revisions; 15-minute timeout | Branch protection/CODEOWNERS are not source-defined | Workflow lines 8-45; no CODEOWNERS found |
| Git checkout | Full fetched object graph | `actions/checkout`, depth 0 | Credentials not persisted; history gate fails on shallow checkout | Remote refs may differ from local refs, but unsafe fetched objects fail closed | Workflow lines 26-30; history verifier lines 178-228 |
| Ruby dependencies | `Gemfile.lock`, Linux x86-64 gems | `ruby/setup-ruby` cached frozen install | Job-level `BUNDLE_FROZEN=true`; exact versions/platform | Mutable registry/cache and no gem checksum section | Workflow lines 15-36; Gem lock lines 1-96 |
| Node dependencies | `package-lock.json`, KaTeX 0.18.1 | `npm ci`; generated CSS/font pruning | Exact package lock integrity; scripts disabled during install; generated bytes diffed | Registry/cache availability | Workflow lines 38-57; npm lock lines 1-42 |
| Build timestamp | HEAD committer ISO timestamp | Exported once, written to temporary Jekyll config | Same value and timezone for both builds; disk cache disabled | Determinism is commit- and runner-stack-specific | Workflow lines 59-72; wrapper lines 9-28 |
| Generated site A/B | Temporary output trees | Two separate Jekyll invocations | Recursive sorted manifests; exact `cmp`; semantic checks on A | Not retained or deployed by this workflow | Workflow lines 59-76 |
| Artifact manifest | JSONL entries | `artifact_manifest.py` recursively scans output | File SHA-256, size, path, mode; directory path/mode; fail-closed special types; race checks | No owner/group/mtime/xattr binding by design | Manifest lines 19-98; tests lines 39-80 |
| History policy | `history-sanitization.json` | Manually curated object IDs and hashed values | Schema validation, ancestry/topology checks, exact forbidden-object absence, value scanning | Policy changes are ordinary source changes; general unknown secrets are out of scope | History manifest lines 1-74; verifier lines 51-228 |
| Deployment | None in source | External repository setting or future workflow | This workflow has no write authority | A green job does not publish and may not block a release unless configured as required | Workflow lines 1-76 |
| Recovery/rollback | None in source | External process | None observed | Publication rollback and incident handling are not auditable here | Workflow/docs inventory |

## Candidate Findings

No `CANDIDATE-OPS-*` finding was opened. The review found no actual defect in fresh Linux execution, complete intended-entry comparison, or the hardened history gate at the target commit. The unresolved items below concern external settings, provider state, portability, or missing audit inputs; they do not support an exploitable or reproducible source defect.

## Callsite Classification For Clustering

| API / pattern | Root cause | Affected | Fragile | Checked | Not applicable | Needs confirmation | Internal appendix |
|---|---|---|---|---|---|---|---|
| Direct `script/build-site.sh` execution | Git executable mode | None | None | Two workflow calls; target tree mode `100755` | Non-Linux mount mode | None | Prior audit table above |
| `fetch-depth: 0` plus history verifier | Incomplete or unsafe fetched history | None | Unknown server-side ref inventory | Non-shallow local target; all local refs/HEAD scanned; exact unsafe objects absent | Source archive without `.git` | Remote ref deletion/settings | `evidence/local-gates.log` |
| `artifact_manifest.py` traversal | Old regular-file-only comparison | None | Cross-image metadata not in contract | 702/702 entries in each retained tree; files, directories, modes, bytes, sizes covered | Owner/group/mtime/xattr | None | JSONL files in `evidence/` |
| Symbolic/special generated entries | Unmanifested artifact types | None | None | Symlink and FIFO unit mutations rejected | No such entry in retained output | None | `evidence/local-gates.log` |
| Runtime and dependency setup | Mutable hosted runner and external package services | None | Ubuntu/Python image; Linux-only Ruby lock; gem checksums absent | Ruby/Node fixed; frozen install; npm integrity; prior exact locked builds | macOS/ARM portability | Upstream action identities/availability | Dependency rows above |
| Check-only workflow | External deployment authority | None in check implementation | No source-defined rollback | Read-only token, no credential persistence, no upload | Application governance | Required check, Pages source, deployment/rollback settings | High-impact unresolved risks |
| `secret`, `admin`, `SRS`, `pause` content hits | Published CTF/game terminology | None | None | Operational history credentials reviewed separately | CTF keys, solvers, game pause/admin prose | Provider revocation state only | Domain search evidence |

## High-Impact Unresolved Risks

| Risk | Why unresolved | What could be affected | Required next step |
|---|---|---|---|
| The workflow may not be configured as a required release check | Branch protection and rulesets are not Git files | Changes could be published without waiting for this gate | Confirm the exact target branch/ruleset requires `Site checks / build`. |
| Pages publication and rollback are not source-defined | The sole workflow neither uploads nor deploys; repository Pages settings were not queried | A green check may not publish the verified tree, and rollback behavior is unknown | Confirm branch-source Pages configuration or approve a separate least-privilege artifact deployment and rollback runbook. |
| Remote refs and tags were not inventoried | Network use was prohibited; local full-history state has four refs only | An unsafe server ref would make the full checkout fail, correctly blocking CI | Confirm obsolete unsafe refs/tags are deleted. A CI failure naming forbidden objects is a release stop, not a portability issue. |
| Old OAuth provider secret revocation status is unknown | Sanitizing this repository cannot revoke an already exposed provider credential | The old OAuth application, depending on provider configuration | Owner must confirm revocation or rotation before cutover. |
| Hosted action identity/current availability was not independently resolved | Only local workflow SHAs and comments were available | Setup steps in a future Actions run | Confirm approved action SHAs through the normal dependency-review process; do not replace them with floating tags. |
| Required audit-stage inputs are absent | No source freeze, threat model, routing, prior-ID inventory, or conformance artifact was supplied at target | Formal stage coverage and cross-stage traceability | Restore or generate the nine required inputs before final audit sign-off. |

## Cleared Areas

- No source-level release blocker was found in the requested CI/determinism scope.
- The workflow should execute in a fresh GitHub-hosted `ubuntu-24.04` x86-64 checkout: it requests full history, installs pinned Ruby and Node versions, uses Linux-compatible locked gems, and directly invokes a Git-executable POSIX wrapper.
- The exact prior wrapper permission blocker is resolved.
- One stable commit timestamp is shared by both builds; Jekyll disk caching is disabled.
- The new manifests compare the root, every nested directory including empty directories, every regular-file path, file bytes, size, and permission mode. Symbolic links and special files terminate the gate.
- Applying the target manifest generator to the retained independent A/B trees produced byte-identical 702-entry manifests: 516 files and 186 directories in each, with no unclassified entry.
- All Python source/history/unit gates passed locally at target. Offline `npm ci`, KaTeX regeneration, and the scoped source diff also passed.
- The hardened history verifier passed with 625 HEAD commits, 625 ref-reachable commits, four local refs, 4,617 objects, three attachment merges, and zero known-value matches. Every listed forbidden tip and blob was absent from the local object database.
- Workflow permissions are read-only, checkout credentials are not persisted, and untrusted pull-request code has no deployment authority in this job.
- No private build dependency, vendored fork, submodule, tracked symlink, Docker build, SRS/proving/verifying key, KMS/HSM integration, feature-flag release path, application upgrade authority, or governance mechanism applies.

## Negative Test Ideas

| Invariant / path | Test idea | Expected rejection / failure | Priority |
|---|---|---|---|
| Complete artifact path set | Add an empty directory to only output B | `cmp` fails because the directory entry differs | High |
| File bytes and size | Change one byte without changing a path | SHA-256/size manifest differs; `cmp` fails | High |
| File or directory mode | `chmod` one generated entry in B | Mode field differs; `cmp` fails | High |
| Unsupported output type | Add a symlink, FIFO, socket, or device entry | Manifest exits nonzero before comparison | High |
| Stable file snapshot | Replace or mutate a file during hashing | `O_NOFOLLOW`, stat-field check, or read/open error fails closed | Medium |
| Build determinism | Inject random bytes, current time, or iteration-order output into one build | Complete manifests differ | High |
| Shallow history | Run verifier in a depth-one clone | Explicit non-shallow requirement fails | High |
| Side-ref credential | Add a known hashed value to a side-branch commit message or annotated tag | Ref-reachable object scan reports a match | High |
| Forbidden unreachable object | Inject a manifest-listed object without a ref | Exact `cat-file -e` object check fails | High |
| Attachment integrity | Change second parent, merge arity, or merge tree | Attachment topology check fails | High |
| Generated dependency drift | Alter package manifest or KaTeX generator output | `npm ci` or scoped `git diff --exit-code` fails | High |
| Release enforcement | Attempt publication from a commit with a red gate | Repository ruleset must reject it | High, settings test |

## Artifact Completeness Check

| Required item | Present? | Notes |
|---|---:|---|
| `agent_out/audit/00-source-freeze.md` | NO | Target commit from user used as source freeze. |
| `agent_out/audit/00b-external-intel.md` | NO | Network prohibited; no replacement external research performed. |
| `agent_out/audit/01-scope-threat.md` | NO | Scope inferred narrowly from user request. |
| `agent_out/audit/02-recon-inventory.md` | NO | Repository/workflow inventory performed in this deep dive. |
| `agent_out/audit/03-handbook-routing.md` | NO | Self-routed; coverage limitation recorded. |
| `agent_out/audit/03b-design-skeptic.md` | NO | No substitute artifact. |
| `agent_out/audit/03c-prior-audit-review.md` | NO | Relevant local `agent_out/unified-merge/review/` reports were read directly. |
| `agent_out/audit/03d-bug-history.md` | NO | Relevant prior CI/history variants were read directly. |
| `agent_out/audit/04-conformance.md` | NO | No substitute artifact. |
| Target workflow and relevant scripts/configs | YES | All CI-invoked paths, locks, manifests, and deployment inventory reviewed. |
| Domain self-check evidence | YES | `evidence/domain-self-check.txt`. |
| Source/unit gate evidence | YES | `evidence/local-gates.log`. |
| Complete A/B artifact manifests | YES | `evidence/gate-a.manifest.jsonl`, `gate-b.manifest.jsonl`, and summary. |
| `agent_out/audit/deepdives/05f-ops-build-deploy.md` | YES | This artifact. |

## Method - what / how / why

What:
Reviewed the CI and deterministic release gate at target commit `65b4ea38a2ad51c2da632a576acc2d74f4d12d46`, with emphasis on fresh GitHub Actions Linux execution, full generated-entry comparison, history sanitization, dependency integrity, release authority, and recovery boundaries.

How:
Inspected the exact target blobs and Git modes, traced each workflow command into its script, checked lock/platform compatibility, ran local source/history/unit gates without network, replayed the new manifest generator over retained independent build A/B trees, compared manifest coverage with filesystem enumeration, and reviewed prior local findings for variants.

Commands and searches:
`git show`, `git diff`, `git log`, `git ls-tree`, `git ls-files -s`, `git show-ref`, `git rev-list`, `git cat-file -e`, `git grep`, `find`, `python3 script/verify-*.py`, `python3 script/test-history-sanitization.py`, `python3 script/test-artifact-manifest.py`, `python3 script/artifact_manifest.py`, `cmp`, `npm ci --offline --ignore-scripts --no-audit --no-fund`, `npm run sync-katex-assets`, and scoped `git diff --exit-code`. No network, upload, deployment, or push command was used.

Files read:
The workflow; all CI-invoked scripts; history, imported-content, static-app, archived-asset, historical-path, and parity manifests; Ruby/npm manifests and locks; build/config/docs files; prior local CI/history reports; retained gate logs and outputs; and the required-input paths (which were absent).

Why:
The prior gate had concrete Linux executable-mode and incomplete artifact/history coverage findings. The review tested those exact root causes rather than treating new grep hits as separate issues.

Dead ends:
The audit host has Node and Python but no Ruby/Bundler, so it could not repeat the Jekyll invocation locally. This is an audit-host limitation, not evidence of a GitHub Actions defect. Retained full builds at commit `4f6909c` use the same build inputs; later target changes affect excluded audit evidence and gate scripts. The new manifest was independently applied to both retained outputs. GitHub settings, provider revocation, current hosted-action availability, and server refs cannot be established from local source.

Next step:
Treat the source gate as cleared. Before cutover, confirm required-check/Pages/rollback settings, remove any unsafe remote refs, confirm old OAuth secret revocation, and run the target workflow once on GitHub-hosted `ubuntu-24.04` to close the external-platform evidence gap.
