# Contributing

Read [AUTHORING.md](AUTHORING.md) for post paths, local previews, assignments, public downloads, encrypted articles and attachments, and the source-commit/publication workflow.

- Make focused changes based on `master`; contributors without write access can submit a pull request. Include a short description and the local checks you ran.
- Run `python3 script/blog.py doctor`, then build or preview with `python3 script/blog.py build` or `python3 script/blog.py preview`. PDFs are optional and require `--pdf` plus the installed PDF toolchain.
- Imported articles, historical routes, and cataloged attachments have integrity pins. New-post support does not authorize edits to those originals or regeneration of their manifests.
- Keep private drafts, answers, and original encrypted-article assets outside the repository. Put only deliberately public downloads in public asset paths. Review licenses and attribution before adding someone else's work.
- Stage source files selectively and inspect the staged diff. Never force-add `agent_out`, private answer directories, or generated site output.
- Maintainers prepare publication from a clean `master` after a separate human `git fetch origin`. `python3 script/blog.py prepare-publish` creates a local candidate and prints the exact atomic push command; a human reviews and runs it. The helper does not fetch or push.

Do not restore the old TeXt front-matter or unsalted assignment recipe from repository history. New checkers use `script/new_challenge.rb` and require `challenge_checker: true`; see the author guide for the full procedure.
