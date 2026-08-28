# Moodboard skins

Thirty-six complete skins, one per moodboard board (01-30, 32-37), drawn from scratch by `agent_out/skin-engine/build_skins.py`. No code is reused from the five earlier full-theme prototypes. The calculator theme stays the default; board 31 is excluded and absent from the roll.

Each skin restyles the unified markup itself - header archetype (bar, plate, banner, stack, split, box, tiles), navigation language (pills, underline, brackets, tiles, numbered index), home row treatment (rows, cards, stack, ledger, grid, spines), article chrome (single, framed, margin note), code frame (block, card, sheet, terminal), quotation style, typography stacks, background patterns, and one bespoke signature rule set per board. Palettes seed from the contrast-fitted dice validation so every shipped text pair keeps at least 4.5:1.

- Skins load lazily: the rolled skin's stylesheet (`assets/css/skins/bNN.css`, max 1.3 KB gzip each) is injected on roll and persisted under `writeups-skin`. The default page ships none of them; `main.css` returned to 7,296 gzip bytes and `theme.js` is 1,218 against its 1,536 budget.
- Each file carries dark-mode overrides and its own `@media print` reset, so print output stays ink-on-paper under every skin.
- `script/verify-site.py` fails the build unless exactly 36 skin files exist, each scoped, each containing header, nav, row, code-frame, quotation, and print rules, each listed in `theme.js`, and no retired palette dice remains anywhere.
- Browser sweep: all 36 skins on a code-bearing article at 375 and 1440 pixels - zero horizontal overflow, code frames visible, and every skin measurably changes the computed header and body background against the classic reference. Screenshots of the default and six representative skins are retained here.

The full route matrix was not rerun for this change at the owner's direction; retained browser evidence binds to earlier trees.
