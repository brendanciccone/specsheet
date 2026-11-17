# The logo

The mark is three corners of a design frame, one spec line inside it, and a red cursor
where the fourth corner would be. The frame is the design, the line is the spec, and the
cursor is the program running it.

- `assets/mark.svg` is the mark on its own. It follows light and dark mode.
- `assets/icon.svg` and `icon.png` are the mark on a dark tile, for app icons.
- `assets/logo.svg` and `logo.png` are the mark with the name beside it.
- `final.png` shows all of them in use, and `final-mark-only.png` shows the mark alone.

The colours are ink `#15141B`, paper `#F6F4EE` and red `#E5322D`.

After changing an SVG file in `assets/`, redraw the PNG files and both sheets:

```bash
node docs/logo/final.mjs
```

## How it was chosen

Several directions were drawn and ranked by a small panel of AI reviewers on a low-cost
model, and the project's owner made the final choice. The panel placed this mark in a
near tie for first, and it had the most votes for small sizes.

A blind check followed. Five readers were shown the mark alone, told nothing, and asked
what it looks like.

- All five described a selection frame with a bar inside it and a mouse pointer over its
  lower right corner.
- All five guessed a tool that selects, captures or acts on things on a screen. Three
  named UI testing or browser automation, which is close to what the program does.
- None read the bar as a spec. The mark says "a cursor acting on a frame", and the name
  beside it supplies "spec".
- All five said it stays recognisable at the smallest size, though the bar and corners
  blur there.
- None named a specific logo it copies. All five said it is close to the generic
  select-region icon.
