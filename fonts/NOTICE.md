# Embedded font

`sourcecodepro-medium.woff2` renders the estate map (`.floormap`). It is
**Source Code Pro** (Medium / weight 500) by Adobe — the font the map was
authored in, so the block-wall glyphs (`█ ▀ ▄ ▌ ▐` and the `▛ ▜ ▙ ▟` corners)
and the `☺`/`☻` faces render exactly as drawn.

The file is **subset** to only the glyphs the map uses (basic ASCII, box drawing
`U+2500–257F`, block elements `U+2580–259F`, `·`, and the two smileys) to keep it
small, then embedded as a base64 `@font-face` in `styles.css` so the game is
self-contained. A locally installed Source Code Pro, if present, wins via
`local()`.

## License

**Source Code Pro** © 2010–2019 Adobe (http://www.adobe.com/), with Reserved
Font Name "Source". Licensed under the **SIL Open Font License, Version 1.1**
(https://scripts.sil.org/OFL). The OFL covers this font asset; the rest of the
project remains under the repository's MIT license.
