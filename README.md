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
script/build-site.sh _site
python3 script/verify-imported-content.py
python3 script/verify-static-app.py
ruby script/test-code-frames.rb
python3 script/verify-site.py _site
python3 script/verify-code-parity.py _site
```

Set `BUILD_TIME` to an ISO 8601 timestamp when building outside a Git checkout. The build uses local assets and loads no analytics or comment runtime. Mathematics and syntax highlighting are generated before publication.
