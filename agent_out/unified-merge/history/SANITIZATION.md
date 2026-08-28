# Imported history sanitization

The unified branch attaches full root and WriteUps source histories. CTF tutorial and Ramblings histories were rewritten before attachment. Generated Pages histories were not imported.

No network access was used. The source refs came from the full local acquisition clones recorded in the merge inventory.

## CTF tutorials

The affected credentials existed only in an imported theme documentation tree that the project later deleted. The rewritten history removes `docs/` from every commit:

```sh
git clone --no-hardlinks --single-branch --branch master SOURCE ctf-tutorials-clean
cd ctf-tutorials-clean
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
  --index-filter 'git rm -r --cached --ignore-unmatch docs' \
  --prune-empty -- master
```

Original source tip:

```text
db082fa9a7e3e2b7084fd166995dde4eda6ff522
```

Sanitized tip:

```text
0604d5603b9b1b54ddfbcb1771a1cbb1985d1373
```

## Ramblings

The Ramblings rewrite runs `sanitize_ramblings.py` as a tree filter. It empties concrete comment-provider fields in every `_config.yml` snapshot while retaining post and project history.

```sh
git clone --no-hardlinks --single-branch --branch main SOURCE ramblings-clean
cd ramblings-clean
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
  --tree-filter 'python3 /absolute/path/to/sanitize_ramblings.py' \
  --prune-empty -- main
```

Original source tip:

```text
fd78c8215cb774ab17b4daec4cd342fb858e4e0a
```

Sanitized tip:

```text
99055271a7d523ff04a848ce55b5a23595aefbc4
```

## Cleanup and verification

The temporary clones retained unsafe remote-tracking and `refs/original` refs after rewriting. Those refs were removed before garbage collection or import:

```sh
rm -rf .git/refs/original .git/logs/refs/original .git/refs/remotes/origin
git remote remove origin 2>/dev/null || true
git reflog expire --expire=now --all
git gc --prune=now
git fsck --full --no-reflogs --unreachable --dangling
```

Only the sanitized local branch tips were fetched into the unified repository. Each history was attached with an unchanged-tree merge.

`script/verify-history-sanitization.py` requires a complete repository and checks that every required source tip and attachment merge is an ancestor of `HEAD`. Each attachment must have the recorded source tip as its second parent and the same tree as its first parent. The verifier rejects the original unsafe tips and credential-bearing blobs even when those objects are unreachable, then scans blobs, commit messages, and annotated tags reachable from every local ref plus `HEAD` for hashed forbidden values. It never stores or prints the raw values.

`script/test-history-sanitization.py` builds isolated Git fixtures and confirms that the gate rejects shallow history, a forbidden value in a side-ref commit message, an unreachable forbidden object, and a changed attachment parent.
