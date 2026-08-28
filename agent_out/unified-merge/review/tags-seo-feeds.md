# Tags, SEO, feeds, and section-output audit

Reviewed commit `0a8cd613ef338cb2487d189b60d14745453cd877` on `unified-publishing`. The review used the source tree, the existing production `_site` artifact, and the recorded gate results. It did not deploy, push, rebuild, or modify source.

## Verdict

Changes are required before publishing. Post inventory, archive filtering, dates, XML syntax, post canonicals, Open Graph, JSON-LD, and sitemap coverage pass for all 78 posts. The release blocker is section presentation: all 61 WriteUps posts render through the generic article layout instead of the intended writeup layout. Feed summaries, page identities, section 404 metadata, and legacy canonical targets also need correction or explicit acceptance.

## Finding: WriteUps layout metadata is lost

Severity: high

Affected:

- [SectionMetadata.apply](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L13-L25) assigns `section: writeups` and `layout: writeup` to imported WriteUps posts. The section value and permalink survive, but the layout value does not.
- [The global post default](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_config.yml#L53-L58) leaves every one of the 61 generated WriteUps pages with body class `layout-article section-writeups`. No generated WriteUps page uses `layout-writeup`.
- [The generic article layout](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_layouts/article.html#L4-L21) has no `writeups` branch. All 61 pages therefore print the root publication name as their Section value.
- [The intended writeup layout](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_layouts/writeup.html#L5-L40) supplies event, category, primitive, and attached-file metadata. None of those controls occur on the 61 generated WriteUps pages. Its event-scoped related links and adjacent-post links are also absent.

Checked:

- All 61 posts still have `section-writeups`, discover `/WriteUps/feed.xml`, and occur in the WriteUps home, archive, pagination, feed window, and sitemap.
- The failure is limited to layout selection and the resulting page identity. It does not remove article bodies or routes.

Impact:

- Every WriteUps article is mislabeled as part of the root blog in its visible facts.
- Challenge attachments are less discoverable, and the event/category/topic structure designed for this section is missing.
- A gate that counts routes and generic shell fields does not catch the failure.

Fix:

- Apply layout metadata after defaults and front matter have resolved, or replace the global layout default with section-scoped defaults. Add a gate asserting that exactly 61 post pages use `layout-writeup` and expose the expected event/category fields.

## Finding: tag output passes the current corpus, but mutation and case rules are broader than stated

Severity: medium if rendered source labels must remain unchanged; otherwise fragile

Checked:

- [The alias file](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_data/tag_aliases.yml#L1-L3) contains only `ctf -> CTF`, `ctfs -> CTF`, and `rsa -> RSA`.
- The 78 source posts contain 132 exact tag values and 406 tag assignments. Canonical output contains 130 values and all 406 assignments. The two reductions are exactly the configured CTF merge and the `rsa`/`RSA` merge.
- Only three source posts change spelling at render time: [List of Hacking Sites](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_posts/ctf-tutorials/2020-08-01-Hacking%20Sites.md#L1-L4), [What are CTFs](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_posts/ctf-tutorials/2021-04-04-What%20Are%20CTFs.md#L1-L4), and [primimity](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_posts/WriteUps/2020/redpwn/crypto/primimity/2020-06-27-redpwn-2020-primimity.md#L1-L5).
- On-disk source is unchanged: `git diff --exit-code -- _posts` passed, and the content-integrity gate reports all 319 imported files unchanged.
- The generated archive has 130 sorted tag links. Every query value decodes to its filter value, every badge equals the number of matching rows, and no unconfigured case-fold collision exists in the current corpus.

Affected:

- [The generator](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L40-L51) replaces each post's in-memory `tags` array. Aliases therefore change article tag labels, filter data, and any later consumer of `post.data`, rather than only merging the global tag index. The source files remain unchanged, but rendered source spelling does not.

Fragile:

- [Alias lookup lowercases every candidate](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L44-L49). A future `CtF`, `CTFs`, or `RsA` value will merge even though that exact spelling is absent from the alias file.
- [Filtering lowercases all tags](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/archive.js#L12-L21). Future unaliased values that differ only by case would have separate archive badges but one shared filter result.
- [The cache invalidation](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L49-L51) reaches into Jekyll's private `@post_attr_hash`. It works with locked Jekyll 4.4.1 but is upgrade-sensitive.
- [Row tags use a pipe delimiter](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/post-row.html#L15-L20). No current tag contains a pipe, quote, angle bracket, ampersand, or space, so the present output is sound.

Fix:

- If source label preservation is required, build an archive-only canonical map instead of replacing `post.data["tags"]`.
- If aliases must be exact, remove implicit case folding and list every accepted source spelling in the data file.
- Replace the private-cache dependency with a supported generation structure and add mixed-case regression cases.

## Finding: legacy aliases use a different canonical form from their targets

Severity: medium

Affected:

- [AliasPage](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/legacy_paths.rb#L36-L64) builds redirect and canonical values from the extensionless manifest target instead of `target_document.url`.
- All 24 historical alias pages emit an extensionless refresh target, canonical, `og:url`, and JSON-LD URL. The corresponding generated article exists only at the same path with `.html`, and that article declares the `.html` URL as canonical.

Fragile:

- [The local gate](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/script/verify-site.py#L75-L80) deliberately accepts an extensionless link when a sibling `.html` file exists. That assumes hosting-layer extension fallback. The static artifact itself has no exact extensionless target.

Checked:

- All alias pages are `noindex` and excluded from the sitemap by [their generated metadata](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/legacy_paths.rb#L53-L63).
- The 78 actual posts each have one unique, self-consistent `.html` canonical, matching `og:url` and JSON-LD URL.

Impact:

- Alias metadata does not consolidate directly onto the canonical declared by the destination article.
- Redirect behavior depends on GitHub Pages extension fallback and is not portable to a plain static server.

Fix:

- Use the escaped `target_document.url` for both `redirect_to` and `canonical_url`, then assert that each alias canonical exactly equals its destination page canonical.

## Finding: section feeds contain empty or oversized summaries

Severity: medium

Affected:

- [The custom feed template](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/section-feed.xml#L9-L18) always serializes `post.excerpt`. Five of the 20 WriteUps entries have empty summaries. Thirteen more exceed 1,000 characters because posts without the configured separator contribute most or all of their rendered article, including code.
- The generated WriteUps feed is 395,587 bytes. This is valid XML but poor feed content, despite 60 of 61 WriteUps posts having short explicit descriptions.

Needs confirmation:

- Feeds are rolling windows, not complete inventories. The global feed contains the latest 10 of 78 posts; the WriteUps feed contains the latest 20 of 61 because of [the explicit section cap](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/section-feed.xml#L9-L9). Tutorial and Ramblings feeds include all 4 and 5 posts because both sections are below the cap.
- If "all 78 posts occur in appropriate outputs" includes feed entries, the global and WriteUps feeds fail that requirement. Archive, pagination, and sitemap coverage is complete.

Checked:

- All four feeds are well-formed Atom XML. Entry links and IDs are unique, dates are descending, and each window is the correct newest prefix of its section.
- XML escaping works for the quoted AI title and rendered HTML summaries.

Fix:

- Prefer `post.description`; use a stripped and bounded excerpt only as fallback. Decide and document whether feeds are windows or full inventories, then encode the limit in a named configuration value and gate it.

## Finding: archive and pagination pages have weak or incorrect identities

Severity: medium

Affected:

- [The global archive page](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/archive.html#L1-L7) has no title or description. Its HTML title, Open Graph title, JSON-LD headline, and description duplicate the home page instead of identifying the archive.
- Root pagination has 10 unique canonicals and complete post coverage, but all 10 pages use the same title and description. [The shared paginator](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_includes/paginator.html#L1-L15) also calls the mixed global listing "Writeup pages" and links to "All writeups".
- All eight manual WriteUps pages use the same title. Pages 2 through 8 omit the section description, fall back to the generic site description, and have no `rel=prev` or `rel=next` head links. [Page 2 shows the repeated metadata pattern](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/WriteUps/page2/index.md#L1-L10).

Fragile:

- [WriteUps pagination hardcodes pages 1 through 8](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_layouts/section_home.html#L21-L27), while each source page hardcodes an offset and limit. Current coverage is correct, but a 65th WriteUps post would not appear on any numbered section page without adding page 9 manually.

Checked:

- Root pages contain 8 posts each on pages 1 through 9 and 6 on page 10. Their union is all 78 posts exactly once and in the same newest-first order as the archive.
- WriteUps pages contain 8 posts each on pages 1 through 7 and 5 on page 8. Their union is all 61 WriteUps exactly once and in section order.
- Section archives contain exactly 61 WriteUps, 4 tutorials, and 5 Ramblings posts, without duplicates.

Fix:

- Add archive and page-number metadata, section-specific descriptions, and navigation relations. Generate WriteUps pagination from the post count rather than fixed files and a fixed `1..8` range. Rename the global pagination labels.

## Finding: section 404 pages are root-identified and appear in the sitemap

Severity: low

Affected:

- [The section 404 hook branch](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L70-L76) sets title, layout, permalink, and `noindex`, but not `section` or `sitemap: false`.
- All three section 404 outputs use `section-root`, discover the global feed, and fail to highlight their section navigation.
- The global sitemap contains all three noindex section 404 URLs.

Checked:

- All four 404 pages have `noindex, follow`. The root 404 is absent from the global sitemap.

Fix:

- Assign the matching section identity in the 404 branch and set `sitemap: false` explicitly.

## Finding: New Tetris pages have descriptions and sitemap entries but no social or canonical metadata

Severity: low; needs confirmation of scope

Affected:

- [The game](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/index.html#L1-L16), [scoring guide](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/scoring/index.html#L1-L10), and [catalog](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/new-tetris/src/catalog/index.html#L1-L9) are standalone static HTML. None declares a canonical, Open Graph data, or JSON-LD.

Checked:

- All three have unique titles and nonempty descriptions.
- All three occur in the global sitemap, and their static app identity is internally consistent.
- The other 135 HTML pages each have one canonical, description, Open Graph block, and parseable JSON-LD block.

Fix:

- If unified SEO applies to the app, add explicit canonical and social metadata without routing the app through a layout that changes its runtime behavior.

## Coverage and validity evidence

| Output | Expected post set | Observed | Duplicates | Order |
|---|---:|---:|---:|---|
| Global archive | 78 | 78 | 0 | newest first |
| Root pagination | 78 | 78 | 0 | matches archive |
| WriteUps archive and pages | 61 | 61 | 0 | matches section order |
| Tutorial archive | 4 | 4 | 0 | matches section order |
| Ramblings archive | 5 | 5 | 0 | matches section order |
| Global sitemap | 78 posts | 78 | 0 | not required |
| WriteUps sitemap | 61 posts plus home | 62 URLs | 0 | newest first |
| Tutorial sitemap | 4 posts plus home | 5 URLs | 0 | newest first |
| Ramblings sitemap | 5 posts plus home | 6 URLs | 0 | newest first |
| Global feed | latest 10 | 10 | 0 | newest first |
| WriteUps feed | latest 20 | 20 | 0 | newest first |
| Tutorial feed | all 4 | 4 | 0 | newest first |
| Ramblings feed | all 5 | 5 | 0 | newest first |

Additional checks:

- All eight XML outputs parse successfully. The global sitemap has 115 unique URLs.
- Each of the 78 posts has exactly one canonical, matching `og:url`, JSON-LD URL, and its generated public route. Each has one nonempty and unique meta description.
- All 78 post JSON-LD blocks parse as `BlogPosting`. Their `datePublished`, Open Graph published time, visible `datetime`, and sitemap `lastmod` agree. The two-digit Ramblings filename resolves to 2022 as intended by [the year conversion](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_plugins/section_metadata.rb#L26-L34).
- Ten post descriptions exceed 160 characters and five exceed 300. They remain valid and unique, but explicit bounded descriptions would produce cleaner search snippets.
- Every generated tag URL, data attribute, badge, quoted title, and XML value round-trips through HTML or XML decoding in the current corpus. No escaped-value mismatch, invalid delimiter, duplicate post URL, duplicate tag assignment, or date-order failure was found.
- `node --check assets/js/archive.js` passed.

## Archive behavior with and without JavaScript

[Archive links and tag values](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/_layouts/archive.html#L17-L29) and [the filter implementation](https://github.com/deut-erium/deut-erium.github.io/blob/0a8cd613ef338cb2487d189b60d14745453cd877/assets/js/archive.js#L12-L59) agree for all 130 tags.

- Direct query URLs are decoded and case-folded, then matched against decoded row data.
- Clicking either an anchor or its nested label updates the query, selected state, visible count, empty state, and hidden year groups.
- Unknown tags produce zero rows and the explicit empty message.
- With JavaScript disabled, query parameters are ignored by the static page and all 78 posts remain visible. The filter links therefore degrade to the complete archive rather than a blank page or error.

## Analytics

GoatCounter analytics are enabled at HEAD through `goatcounter_site: "deuterium"` in `_config.yml`; the privacy analysis is in security-privacy.md. The counter is a single async script plus a no-JS pixel and does not affect content, metadata, or crawlability.
