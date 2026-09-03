# deuterium's blog

This repository builds the site served from `deut-erium.github.io`.

Sections:

- `/` - personal posts and browser-local challenges
- `/WriteUps/` - CTF writeups and challenge attachments
- `/ctf-tutorials/` - CTF tutorials and assignments
- `/ramblings/` - informal posts
- `/new-tetris/` - the published game, catalog, and scoring guide

The imported source is recorded in `script/imported-content-manifest.json`. It includes the public WriteUps source plus eight newer local files. Historical routes, attachment bytes, feeds, sitemaps, tags, and the recovered game are checked after each build.

## Build

Ruby 3.3.7 and Node 24.19.0 are the supported versions.

```sh
bundle config set --local frozen true
bundle install
npm ci --ignore-scripts --no-audit --no-fund
script/build-release.sh agent_out/release/site
```

The release command performs one Jekyll build for the root blog, WriteUps, tutorials, and ramblings. It also copies `/new-tetris/` unchanged, adds `.nojekyll`, runs the content and route checks, and writes `agent_out/release/site.manifest.jsonl`.

Set `BUILD_TIME` to an ISO 8601 timestamp when building outside a Git checkout. The build uses local assets. Mathematics and syntax highlighting are generated before publication.

The lowercase `/writeups/` deployment workaround is intentionally retired; `/WriteUps/` is the canonical integrated section. CI builds twice and compares JSON Lines manifests that cover every file and directory, file bytes, sizes, and permission modes. Symbolic links and special files fail the artifact gate.
