# Authored-content and rendering review

Candidate: `unified-publishing` at `0a8cd613ef338cb2487d189b60d14745453cd877`

## Verdict

**DISPUTED as written.** The 319 paths named by `script/imported-content-manifest.json` are byte-identical to the declared snapshots, and the 29 `new-tetris` paths are byte-identical to the declared generated snapshot. That narrower claim passed an independent object-to-working-tree comparison.

The broader claim that the original authored bodies, front matter, standalone pages, and rendered headings were preserved does not survive comparison with the public acquisition clones. The WriteUps manifest selects a local descendant instead of the acquired public head; every public WriteUps article was changed before import; three standalone public pages were replaced; one root profile page now exposes raw Markdown; semantic heading levels changed; and old emoji shortcodes no longer render as emoji.

## Independent comparisons

I compared candidate bytes directly with `git show <commit>:<path>`. I did not use the manifest hashes as the source of truth.

| Set | Compared | Result |
|---|---:|---|
| root at `b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0` | 12 | 12 exact |
| CTF tutorials at `db082fa9a7e3e2b7084fd166995dde4eda6ff522` | 7 | 7 exact |
| Ramblings at `fd78c8215cb774ab17b4daec4cd342fb858e4e0a` | 7 | 7 exact |
| local WriteUps at `53c1f40a135f96fcad0dc0c119c77f33639348ef` | 293 | 293 exact |
| `new-tetris` at root `gh-pages` commit `3747c082a1f6ce600da81050223d74b19f1b35ba` | 29 | 29 exact |

This confirms that the unified merge did not make further byte changes to its specifically selected imports. It does not establish that those selections are the original public sources.

## Public WriteUps was not the imported baseline

The acquisition record identifies public WriteUps head `905279fcb7d35e381a5e3c0ddd2a91af0ff6d343`. The content manifest instead names local commit `53c1f40a135f96fcad0dc0c119c77f33639348ef`, which is 141 commits after the public head. The shallow acquisition clone does not contain that object; it is present only in the local parent WriteUps repository.

Comparing `_posts` at public `905279f` with local/imported `53c1f40` gives 82 differing paths:

- 60 existing article Markdown files changed. This is every article in the public tree.
- 14 existing image attachments changed bytes, primarily through recompression.
- 8 paths were added: `gcm_mode_diagram.png` and seven files for the new Maybe Someday writeup.
- Of the 60 public articles, 14 have front-matter-only changes, one has a body-only change, and 45 have both front-matter and body changes.
- 59 articles gained or changed descriptions. The Memory Acceleration article also changes `mathjax: false` to `mathjax: true`.
- 46 public article bodies differ. The changes include image alt text and dimensions in 35 articles, emoji shortcode substitutions in 12, math-delimiter substitutions in 4, language tags on 4 code fences, repaired links, and one added excerpt marker.

The title values and ATX heading label text in those 60 articles did not change. The body and front-matter claim is still false against the public acquisition source. One concrete prose-level replacement is:

- Public `_posts/2022/cyber_apocalypse/crypto/memory_acceleration/2022-05-21-HTB-Cyber-Apcalypse-2022-Memory-Acceleration.md:432`: `![two hours later](https://media.giphy.com/media/hNGPQK5eGDzTW/giphy.gif)`
- Candidate `_posts/WriteUps/2022/cyber_apocalypse/crypto/memory_acceleration/2022-05-21-HTB-Cyber-Apcalypse-2022-Memory-Acceleration.md:434`: `> Two hours later: still no key.`

Two public WriteUps standalone pages were also replaced before the selected local commit:

- Public `about.md` has title `About WriteUps`, 69 lines, and SHA-256 `a73626c3c3c7789938a3c5e1e8e5f5e85b5c11bdd70af6db1cb95abd9d107f1f`. Candidate `WriteUps/about.md:1-45` has title `About the register`, new headings and prose, and SHA-256 `c24bf6c879353600c9faf8d3b912b597041be20d830b329ea77d2a76edd0930`.
- Public `404.md` is the 79-line ASCII-art page with SHA-256 `f97145b94148f4854bac732c317b3faedc0e083051f49de32eb8698c4e53fad9`. Candidate `WriteUps/404.md:1-9` is a short archive notice with SHA-256 `e0a84728530a3879972bcfeac281936e47496ac4bb3ebc62573d9566faef11e5`.

The new Maybe Someday article is legitimate local content, but it is not present in the acquired public source. It should be described as an additional local import rather than evidence of public-source parity.

## Root restoration is partial

The root manifest's 12 selected paths are exact copies of public commit `b6d7e299`. This includes all eight root posts plus `404.md`, `about.md`, `archive.html`, and `index.html`. The restored root post prose itself passes byte comparison.

The public standalone profile at `assets/index.html` was not restored and is absent from the integrity manifest:

- Public `assets/index.html:1-117` is the full manual-page profile titled `Himanshu Sheoran`, SHA-256 `012fbad06e13a8114f080221629a096114e1fc1e515a8832c55cdedf17dd953e`.
- Candidate `assets/index.html:1-9` is a new one-sentence legacy notice titled `About Himanshu`, SHA-256 `9c701d6d4f73b3d4e797fcc1e3b062a05ff160ffc8ba79a1fdf4f6bc990c76ad`.

The replacement also has a rendering defect. Because the source is named `.html`, its Markdown link is not converted. Generated `_site/assets/index.html:51` contains the visible literal text `[About page](/about.html)` instead of an anchor. This is both a standalone-content replacement and a Markdown compatibility failure.

`CONTRIBUTING.md` is another uncovered public-source file. Candidate lines 100-101 replace `:smile:` and `:wink:` with U+1F604 and U+1F609. Its public and candidate SHA-256 values are respectively `b8fe59edeeefc94af16569325b4b05a3af3fae2b5f95b64c0c4265324b2ba1d6` and `5a5ac6977d12e24ed1bd43ace1a028161bad18ca50f40c78543ca56fed9a83e7`. The page is excluded from the build, but it is authored source and is not byte-identical.

## Malformed Ramblings filename

The malformed `_posts/22-02-04-randoblurry-update.md` filename was copied exactly to `_posts/ramblings/22-02-04-randoblurry-update.md`; direct comparison with Ramblings commit `fd78c821` passed. The two-digit year is normalized by `_plugins/section_metadata.rb:27-34`.

The generated result matches the old deployed behavior where it matters:

- route: `/ramblings/2022/02/04/randoblurry-update.html`
- published date: `2022-02-04T00:00:00+05:30`
- title: `Pondering randoblurry improvements`
- body text: unchanged

This special case is handled correctly. It does not need a source rename.

## Rendered headings and titles

The candidate has 78 article headline H1 elements. Their title strings match source front matter or Jekyll's filename-derived title. I found 420 authored ATX headings in those posts and 420 corresponding headings in article bodies; their label text is retained, subject to normal smart punctuation and Markdown inline rendering.

Their semantic levels are not retained. `_config.yml:27-31` applies `header_offset: 1` globally:

| Source level | Candidate level | Count |
|---|---:|---:|
| H1 | H2 | 56 |
| H2 | H3 | 112 |
| H3 | H4 | 209 |
| H4 | H5 | 37 |
| H5 | H6 | 5 |
| H6 | H6, clamped | 1 |

The selected local WriteUps source already used this offset, so its local rendered baseline agrees. The public root, CTF tutorial, Ramblings, and public WriteUps configurations did not. For the three non-WriteUps sections, the unified build newly demotes all 177 post-body headings by one level. Heading words were not rewritten, but rendered heading semantics changed.

Article H1 text is preserved, while browser-title branding is intentionally different. For example, `Trying out randoblurry - Ramblings` becomes `Trying out randoblurry / deuterium's blog`, and `What are CTFs - Blog on CTFs` becomes `What are CTFs / deuterium's blog`.

## Markdown and build-time output changes

Several output changes go beyond supplying layouts and permalinks:

- The old sites enabled `jemoji`; `_config.yml:60-65` does not. Twenty-three visible shortcode occurrences across ten root, tutorial, and Ramblings pages now display literally, including `:smile:`, `:wink:`, `:heart:`, `:metal:`, and `:flushed:`. The public generated pages rendered emoji images. This is a visible body-rendering regression.
- `_plugins/section_metadata.rb:40-51` changes three source tags at build time: `ctf` and `ctfs` become `CTF`, and `rsa` becomes `RSA`.
- `_plugins/section_metadata.rb:62-80` injects page titles, descriptions, layouts, and noindex values. It overrides the selected `WriteUps/404.md` title `Record not found` and description with `Page not found` and `The requested page does not exist.` The local WriteUps baseline rendered the source values; the unified page does not.
- `_plugins/render_compatibility.rb:23-37` rewrites 14 authored link targets and one root-about image tag after rendering. Anchor text is retained, but body HTML is not source-equivalent.
- Four source YouTube includes now emit the new visible text `Watch this video on YouTube` instead of the old iframe-only output.
- KaTeX and code-frame transforms alter HTML structure while preserving equation and code payloads. The generated site contains 106 rendered math expressions and the separate code-parity gate covers 311 WriteUps code blocks. I did not find an unrendered math delimiter in the sampled math articles.

## Integrity coverage gaps

`script/verify-imported-content.py:15-23` detects added files only under `_posts`; outside that tree it checks only paths already listed by the manifest. It therefore cannot detect an unlisted standalone page or attachment being changed, deleted, or added.

The two changed authored files above, `assets/index.html` and `CONTRIBUTING.md`, are not covered. Eight additional root files are exact public-source copies but have no imported-content or static-app hash coverage:

- `Circle-limit-IV.jpg`
- `assets/resume.pdf`
- `assets/resume_himanshu_sheoran.pdf`
- the four files under `assigments/flags/`
- `assigments/what are assignments/task2.txt`

`LICENSE` is also an exact but uncovered source file; it is not counted as authored site content. The CTF tutorial and Ramblings `CONTRIBUTING.md` files are not imported. Section README files are also omitted or replaced as project documentation.

## Supported claim

The evidence supports this narrower statement:

> The 319 files specifically enumerated in `imported-content-manifest.json` match their declared snapshots, including a locally modified WriteUps snapshot, and the 29 enumerated `new-tetris` files match the published root snapshot. The unified merge did not further alter article title or heading label text.

It does not support saying that all original public authored bodies, front matter, headings as semantic elements, attachments, or standalone pages were copied byte-for-byte.