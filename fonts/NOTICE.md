# SleuthVGA — embedded pixel font

`sleuthvga.woff2` is the font that renders the estate map (`.floormap`). The same
bytes are embedded as a base64 `@font-face` in `styles.css`, so the game is
self-contained and needs no network or local font.

## How it was built

The glyph bitmaps are the classic **IBM VGA 8×16** CP437 ROM, taken from the
[`pcface`](https://www.npmjs.com/package/pcface) package (`oldschool-vga-8x16`),
which is MIT-licensed (© 2023 Susam Pal). Those bitmaps in turn come from
VileR's **Ultimate Oldschool PC Font Pack** (https://int10h.org/oldschool-pc-fonts/),
licensed **CC BY-SA 4.0**.

CP437 has full/half blocks (`█ ▀ ▄ ▌ ▐`) but not the *quadrant* block glyphs
(`▖ ▗ ▘ ▝ ▚ ▞ ▛ ▜ ▙ ▟`) that the map uses for room corners, so those ten glyphs
were synthesised (each is the corresponding 2×2 quadrant fill of the 8×16 cell).
A small `fontTools` script drew one filled rectangle per lit pixel and emitted the
woff2.

## Attribution / license

- Bitmaps: **Ultimate Oldschool PC Font Pack** by VileR, **CC BY-SA 4.0**.
- Extraction helper: `pcface` by Susam Pal, MIT.
- The synthesised quadrant glyphs and the woff2 build are released under the same
  **CC BY-SA 4.0** to respect share-alike on the font asset.

The rest of the project (code, markup) remains under the repository's MIT license;
CC BY-SA 4.0 applies only to this font asset.
