# deuterium / field notes

Source for [deut-erium.github.io](https://deut-erium.github.io/): security and systems articles, project links, and browser-local cryptographic challenges.

## Build

```sh
bundle install
JEKYLL_ENV=production bundle exec jekyll build --destination _site
python3 script/verify-site.py _site
```

The generated site uses local assets, no analytics, and no remote JavaScript. Challenge answers are checked with the browser Web Crypto API against public SHA-256 hashes.
