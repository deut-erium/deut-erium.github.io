# Resume publication decision

## Verdict

The About page links the older document, `assets/resume_himanshu_sheoran.pdf`. The unlinked `assets/resume.pdf` is newer by both its stated update date and its per-path Git history. Both files are published at direct local routes, but only the linked, older document appears in the generated root sitemap.

The owner needs to decide whether the July 2024 document was approved for public use or was an unpublished draft. If it was approved, it should replace the November 2023 document at one canonical route. If it was not approved, its direct route should be removed rather than merely omitted from the sitemap.

## Local route and sitemap results

| PDF route | Page link | Local published route | Generated sitemap |
| --- | --- | --- | --- |
| `/assets/resume.pdf` | No current page link | Present; byte-identical to the source PDF | Absent from the root and section sitemaps |
| `/assets/resume_himanshu_sheoran.pdf` | The [About page's Hire Me link](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/about.md#L55-L57) | Present; byte-identical to the source PDF | Present in the root sitemap; absent from section sitemaps |

The source [explicitly disables sitemap inclusion only for `assets/resume.pdf`](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/_config.yml#L65-L68). The local `_site/sitemap.xml` contains only `resume_himanshu_sheoran.pdf`. The site verifier also [fails if `/assets/resume.pdf` reappears in that sitemap](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/verify-site.py#L375-L381). Local site verification passed.

Sitemap absence is not an access control. The newer PDF remains available to anyone who knows or discovers its direct route. No network checks were made, so this review does not claim whether either URL is currently indexed by a search engine or deployed unchanged in production.

## Document age and Git provenance

`assets/resume.pdf` is the newer document:

- Its footer dates the document to July 21, 2024. Its content adds 2024 activity and expands the current employment entry beyond the November 2023 version.
- Its embedded PDF creation and modification timestamps are July 21, 2024. Git last changed the file in [commit b6d7e299](https://github.com/deut-erium/deut-erium.github.io/commit/b6d7e299c8a98dee349f8d1c4d2dd38a06bcc8d0) on July 21, 2024.
- `assets/resume_himanshu_sheoran.pdf` dates itself to November 6, 2023. Its embedded timestamps agree, and Git last changed it in [commit d1a9c4c4](https://github.com/deut-erium/deut-erium.github.io/commit/d1a9c4c47e667c3a55297df48aa6469acc26cece) on November 7, 2023.

The link history explains the mismatch. [Commit 803e0b3e](https://github.com/deut-erium/deut-erium.github.io/commit/803e0b3e1084ae9a93ad039667d9f7cb88dd1fc8) switched the About page from `resume.pdf` to `resume_himanshu_sheoran.pdf` shortly before the named PDF was updated in November 2023. The generic PDF was then updated in July 2024 without switching the link back. Checkout filesystem timestamps are in 2026 and do not establish document age.

## Integrity coverage

Both PDFs are individually size- and SHA-256-pinned in the [imported-content manifest](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/script/imported-content-manifest.json#L2219-L2232). Their current source bytes and both `_site` copies match those entries. `script/verify-imported-content.py` passed all 331 entries, and the [aggregate integrity result is a pass](https://github.com/deut-erium/deut-erium.github.io/blob/7996024a684838aa4cf154aa3dca2b237e771657/agent_out/unified-merge/gate/content-integrity.json#L1-L13).

Only the imported-content manifest names the PDFs individually. The aggregate gate file reports counts rather than per-file rows. Its coverage comes from the manifest-backed verifier.

## Owner decision

Both documents contain direct contact information; the exact values are intentionally omitted here. The direct email value is unchanged between them, while their linked resources and professional details differ. The newer version adds current-employer technical detail; the older version retains older projects and personal-history material that the newer version removed.

Choose one of these publication states:

- Approve the July 2024 content: publish it at one stable, linked route, include that route in the sitemap if desired, and retire the November 2023 copy.
- Reject or withhold the July 2024 content: remove `/assets/resume.pdf` from the published output and keep or replace the linked 2023 resume with a consciously approved version.

Keeping both routes leaves two sets of personal and employment information public and makes the linked resume stale. Removing only a link or sitemap entry does not make a PDF private. Both versions also remain in Git history, so a decision that the contact or employment data must no longer be public requires a separate history and cache-removal assessment.
