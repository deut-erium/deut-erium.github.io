# Release-gate hardening

Verified source commit: `a85fd67ed9705f68698a2f86309b575931d2916d`

No network, push, deployment, or GitHub setting change was used.

## History object scope and attachment topology

[History verifier](https://github.com/deut-erium/deut-erium.github.io/blob/a85fd67ed9705f68698a2f86309b575931d2916d/script/verify-history-sanitization.py#L1-L269): now rejects shallow repositories, requires each source and attachment merge to be an ancestor of HEAD, checks each recorded second parent, and requires every attachment merge to retain its first-parent tree. It checks the listed unsafe tips and blobs throughout the local object database, including unreachable objects. Hashed forbidden values are checked in blobs, commit messages, and annotated tags reachable from all local refs plus HEAD.

Checked:

- The final full repository run covered 628 HEAD and ref-reachable commits, 4 local refs, 4,640 objects, 2,031 blobs, 628 commit objects, and 3 attachment merges.
- All four required histories were present.
- All listed unsafe tips and credential-bearing blobs were absent from the object database.
- No hashed forbidden value matched.
- Seven isolated mutation tests rejected a shallow clone, a side-ref commit value, an annotated-tag value, an unreachable forbidden object, a wrong attachment parent, and a tree-changing attachment. The baseline topology passed.

Fragile:

- This remains a known-value check rather than a general secret scanner.
- The all-ref scope covers refs fetched into the checkout. Server-only refs cannot be inspected locally.

Impact:

- A stale local ref, credential-bearing commit or tag, altered history attachment, or known unsafe object now stops the release check.

Fix:

- Keep `fetch-depth: 0` and do not weaken the manifest or mutation suite.
- Treat a future failure naming an unsafe object as a release stop until the remote ref inventory is reviewed.

## Complete artifact comparison

[Artifact manifest](https://github.com/deut-erium/deut-erium.github.io/blob/a85fd67ed9705f68698a2f86309b575931d2916d/script/artifact_manifest.py#L1-L102): records every regular file and directory, including paths and permission modes. File entries also bind size and SHA-256. Symbolic links and special files fail instead of being omitted.

Checked:

- Two clean archive builds produced identical 702-entry manifests: 516 files and 186 directories.
- Both output trees contain 24,307,744 regular-file bytes.
- Full manifest SHA-256: `88b9ff3f21c15d276d71b26933c00e44ade4dc17f4093251c2bb338212e95af6`.
- Regular-file content-manifest SHA-256: `b22f81648d4843278d56ba294e94920523b14cca34ceeb7a562c597a5ca953a3`.
- Seven mutation tests covered byte changes, file-mode changes, directory-mode changes, child and root symlinks, FIFOs, deterministic repetition, and empty-directory coverage.
- [Site verification](https://github.com/deut-erium/deut-erium.github.io/blob/a85fd67ed9705f68698a2f86309b575931d2916d/script/verify-site.py#L273-L287) independently rejects unsupported output entries.

Fragile:

- Owner, group, timestamps, xattrs, and filesystem allocation are outside the static publication contract.
- Permission modes differ between the permissive mounted filesystem and a native Linux runner. The comparison is intentionally within one build job.

Impact:

- The two-build gate can no longer miss an empty directory, permission change, symlink, or special file.

Fix:

- Keep the JSON Lines manifest comparison in the checked workflow. Preserve the content-only digest when comparing builds made on filesystems with different mode semantics.

## Final clean gate

The archive gate installed the locked JavaScript packages from the local cache, used the locked Ruby bundle, verified generated KaTeX assets, ran both mutation suites and the code-frame unit test, built twice, compared both manifest forms, and ran every source and output verifier.

All checks passed. The generated path set is unchanged from the prior browser-reviewed source. Of 516 generated files, only `feed.xml` and `sitemap.xml` differ from source commit `4f6909c`; both changes are the expected commit-derived build timestamp. No layout, CSS, JavaScript, image, route, post, or New Tetris output changed.

Needs confirmation:

- GitHub must run the checked workflow once on its hosted runner.
- Required-check rules, Pages source, server refs, provider revocation, and rollback settings remain outside local source evidence.
