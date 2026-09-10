# Selected theme fonts

This library contains 87 families for 47 theme choices: the five accepted implementations and 42 additional selections. themes.json maps every theme ID to its skin filename, family array, display family and existing flag. The flag identifies the five accepted implementations; it does not certify completion of the remaining skins.

PROVENANCE.json records all 824 installed files with public acquisition URLs, UTC access dates, byte lengths and SHA-256 hashes: 650 WOFF2 files, 87 license notices and 87 metadata files. These are installed inventory counts, including the preserved full Latin Rubik Dirt file and its selected wordmark subset, not per-page downloads. The original 130 provenance rows and the original assets are preserved. Keep each family's notice and copyright metadata when copying its files. Binaries are unmodified; metadata and notices use Google Fonts revision 77669fa9a8a89271bce79dfc05fd2529efb1a187. CDN binaries are recorded separately by URL and hash; repository TTF byte parity is not claimed.

Each selected skin declares its own faces. New display declarations use font-display: swap; reading, code and emphasis declarations use optional. The generated declarations for the remaining themes are under agent_out/theme-redesign/implementation-rest/font-css and are now integrated into their registered skins. No global preload or stylesheet import was added. The larger exploratory collection remains outside the site assets.

The five accepted choices remain unchanged. Nunito, Literata, Zilla Slab and Chivo retain their adopted italics. Mercury Keyspace continues to pair Manrope reading with Literata italic emphasis.

The remaining selections use their target display and reading families plus IBM Plex Mono, deduplicated. Reading italics were acquired for 26 families; existing Chivo and Literata italics are reused. IBM Plex Sans gains italic files without replacing its existing files. Six selections require Literata italic as a fourth family because their reading families have no italic style in the pinned metadata:

- Grid Meltdown: Space Grotesk.
- Cryptographic Blockbuster and Sam at Sunrise: Eczar.
- Proof by Confetti: Spline Sans.
- The Fat Tail Register: Commissioner, whose slant axis is not an italic style.
- Twin Blades: Sora.

Only Literata italic is declared for those six adapters. The required prose-emphasis adapter is recorded in agent_out/theme-redesign/implementation-rest/font-details.json; ordinary reading and code must keep their selected families. Display faces are intended for short headings and the wordmark.

Monoton was acquired separately from explicit public Google Fonts sources. Its OFL notice and pinned metadata are retained here; original CSS, URL/date/hash receipts, acquisition scripts and verification results are under agent_out/theme-redesign/implementation-rest. FONT-RESULT.md records counts and verification limits.

Rubik Dirt's deuterium.woff2 is an unmodified Google Fonts response for the fixed public text DEUTERIUMdeuterium (32,128 bytes). Its declaration covers only the 14 requested upper- and lowercase codepoints. Cut, Paste, Factor uses it for the wordmark; other text uses reading/code faces. The original full Latin binary and other-script faces remain preserved. Acquisition receipts and rendering checks are under agent_out/theme-redesign/implementation-rest/wordmark-font-both. The earlier lowercase-only candidate is retained in local investigation artifacts, not as the installed binary.
