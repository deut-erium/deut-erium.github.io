# Dice themes

Commit `f0f25e9` adds a Dice button beside the theme toggle. The calculator look stays the default: no `data-dice` attribute means the production palette, board 31 is excluded from rolls, and the rolled face persists under `writeups-dice` the same way `writeups-theme` does.

- 36 faces derive from moodboards 01-30 and 32-37 through `agent_out/dice-themes/build_dice_themes.py`, which extracts each board's colors, maps them onto the shell/lcd/pink/orange/yellow/cyan roles, and fits lightness until every text pair passes WCAG AA at 4.5:1 in light and dark mode. `palette-validation.json` records every measured ratio.
- Derived shades reuse `color-mix`, so each face carries seven tokens; `assets/css/main.css` grew from 7,285 to 9,204 gzip bytes against the 12,288 budget, and `assets/js/theme.js` from 622 to 1,120 against its raised 1,536 budget.
- Prints stay ink-on-paper because the print sheet forces author colors off; reduced-motion and forced-colors behavior is unchanged since dice only swaps custom properties.
- Browser checks: default page resolves the classic `#4e5cf0` shell, `b01`/`b22` resolve their generated shells, a click rolls a random face, `writeups-dice` persists, and white-on-shell contrast measured 6.157:1 on a rolled face. Screenshots cover default light, `b01` light, `b22` dark, and an article under `b05`.
- `script/verify-site.py` now fails if any shell page lacks the Dice button, if the stylesheet does not contain exactly 36 light and 36 dark face blocks, or if a face is missing from the script's roll list.

The full route matrix was not rerun for this change at the owner's direction; retained browser evidence binds to earlier trees.
