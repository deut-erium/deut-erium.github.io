# deuterium's blog

Source for one Jekyll site served from `deut-erium.github.io`.

The repository contains four sections:

- `/` - personal posts and browser-local challenges
- `/WriteUps/` - CTF writeups and challenge attachments
- `/ctf-tutorials/` - CTF tutorials and assignments
- `/ramblings/` - informal posts

The authored Markdown imported from the four original repositories is hash-checked by `script/verify-imported-content.py`. Historical HTML routes, WriteUps attachments, section feeds, merged tags, and the recovered `/new-tetris/` application are checked during each build.

## Build

```sh
bundle install
npm ci --ignore-scripts --no-audit --no-fund
JEKYLL_ENV=production bundle exec jekyll build --destination _site
python3 script/verify-imported-content.py
python3 script/verify-static-app.py
python3 script/verify-site.py _site
python3 script/verify-code-parity.py _site
```

The production pages use local assets and contain no analytics or comment tracker. Mathematics and syntax highlighting are generated during the build.
