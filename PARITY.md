# Canvas parity

Source: bb-kit `plugins/canvas` (`app.tsx`, `server.ts`, `model.ts`, `route.ts`, `layout.ts`, `sketch.ts`, `clip.ts`, `styles.ts`, `constants.ts`).
Compared with this repo at `d25265d` (`origin/main`). Status is from reading that source. Nothing below was tried in a window, and no drawing code was changed after the stop.

- **matched**: the behavior is in this plugin and lines up with the source.
- **close**: it is here, and the difference is named.
- **missing**: it is not here, with why.

## Tools

| Feature | Status |
| --- | --- |
| Select `V` / `1`, move, marquee, shift to add | matched |
| Hand `H`, and Space held to pan | matched |
| Rectangle `R` / `2`, Shift draws a square | matched |
| Arrow `A` / `5`, sticks to two different boxes | matched |
| Line `L` / `6` (`heads: none`) | matched |
| Freehand `P` / `7` | matched. Strokes are straight segments, not a tapered pen. |
| Text `T` / `8`. Click a box or arrow to label it | close. A click adds an element whose text is the word `text`, then a field in the style dock. The source edits in place on the shape. |
| Eraser `E` / `0`, click or drag | close. Hits disappear at once. The source fades them until the button goes up. |
| Keep the tool `Q` | matched |
| Shift snaps an arrow or line to 15° | matched |
| Default tool is Select | close. This plugin starts on Rectangle. |

## Shapes, arrows, text

| Feature | Status |
| --- | --- |
| Boxes, arrows, lines, text, freehand | matched |
| Hand-drawn wobble (rough strokes, seeded so a shape keeps its wobble) and a tapered freehand outline | missing. `paint.js` strokes with straight lines. No host sketch API is required; the wobble can be generated in the plugin. |
| Arrow routes on right angles, stays off other boxes and other arrows | matched in `layout.js` / `model.js` |
| Arrow label sits on a clear stretch, or stays hidden when the line has no room | matched |
| Deleting a box deletes its arrows | matched |
| A box grows taller as its label is typed, so the words fit | close. Height updates when the label is committed, not on each key. |
| Label edit on the shape (double-click, Enter, Escape finishes) | close. Double-click selects and opens the dock field. Enter commits that field. Escape leaves Select and drops the selection. Empty canvas double-click inserts `text` instead of an empty in-place editor. |
| Nunito for labels | missing. Text uses the app face. |

## Selection, move, resize

| Feature | Status |
| --- | --- |
| Click, shift-click, marquee | matched |
| Drag to move. Bound arrows move with their boxes | matched. Pointer moves come from `on_mouse_move`, which the host already delivers. |
| Eight resize handles on one box. Side handles hide when the box is small | matched in source (`HANDLES`, `MIN_BOX`) |
| Selection outline | close. A halo and handles are drawn. A dashed box around a multi-selection was not found. |
| Hover outline on a box | missing |
| ⌘A selects everything. Delete then removes them | matched |
| ⌘C ⌘X ⌘V. Copied arrows stay connected. Other text pastes as a text element, centered on the pointer | matched |
| ⌘D duplicates | close. Offset is 24. The source uses 10. |
| Arrow keys nudge. Shift nudges farther | close. Steps are 4 and 20. The source uses 1 and 5. |
| Delete and Backspace remove the selection | matched |

## Pan, zoom, framing

| Feature | Status |
| --- | --- |
| Space + drag, Hand, middle button, wheel | matched |
| ⌘ + wheel, ⌘+, ⌘−, buttons | matched. Factors are 0.9 and 1.1. The source uses `1/1.1` and `1.1`. |
| Pinch | missing. The plugin API says pinch is not supported. Smallest host change: deliver pinch to a plugin view and cover it in `kg ui`. |
| ⌘0 resets to 100% | close. Also jumps the origin to `(32, 32)` instead of keeping the center. |
| Shift+1 and Zoom to fit | matched |
| Scroll back to content when the drawing is off screen | matched |
| Empty canvas prompt and a movement hint only while nothing is drawn | close. Hints exist. Wording and placement were not matched line for line. |
| Fit again when the panel size changes, until the person pans or zooms | missing. Not found in `panel.js`. |

## Colors, styles, layout

| Feature | Status |
| --- | --- |
| Stroke colors: default, red, green, yellow, blue, magenta, cyan, gray | matched. Same hex values. |
| Five quick swatches, then the full set | matched |
| Recolor the selection | matched |
| Arrowheads: none, end, start, both | matched |
| Style dock outside the drawing, with Duplicate and Delete | matched |
| Light and dark from the theme | close. Chrome uses theme tokens. Stroke hexes are fixed, not tokens. |
| Islands, 36px tools, shortcut letters, larger targets when narrow | close. Tools, menu, zoom, undo, and Send are in the same places. The source's island shadow, radius, and purple selected state are not copied. |
| Menu: canvas list, New canvas, Zoom to fit, Copy as image, Reset, Delete | matched, except Copy as image (below) |
| An existing name offers Open canvas instead of creating again | close. Opening a known name works. The row does not change to "Open canvas". |

## Undo

| Feature | Status |
| --- | --- |
| Undo and redo, buttons and ⌘Z / ⌘⇧Z. Ctrl+Y redoes | matched (`cmd-y` is handled) |
| 25 steps, agent edits included | matched (`UNDO_DEPTH` in `store.js`) |

## Agent tools and saved canvases

| Feature | Status |
| --- | --- |
| `canvas_read`: omit the name to list; otherwise one canvas | matched |
| `canvas_edit`: `add`, `update`, `move`, `delete`, `clear`, all or nothing, aliases, the canvas must already exist | matched |
| Element ids `b` / `a` / `t` / `p` plus a number. Text export and `layout:` notes | matched (`dump`, `changes`) |
| `kg canvas list` and `kg canvas show <name>` | matched. The source command is `bb canvas`. |
| Saved document shape (`name`, `rev`, `next`, `elements`) | matched. No migration was added. Old rows should still load. Not opened against a real database. |

## Send, Delete, Copy as image

| Feature | Status |
| --- | --- |
| Send: note plus the command that shows the canvas, so the drawing stays out of the thread | close. The note text matches, with `kg canvas show`. This plugin pastes and does not press Enter. The source sends the note into the thread (`threads.send`, mode `auto`). |
| Thread picker, including This thread | matched |
| Delete asks once: Keep canvas, or Delete canvas. It cannot be undone | matched |
| Copy as image: PNG of the whole drawing, cropped, no selection chrome | missing. The menu row is disabled. The host can take a PNG now: `host.writeClipboardPng(base64)` when clipboard write is granted, standard base64, at most 8 MiB, and an error on Linux. The plugin still has to encode the PNG. |

## Host gaps

Only what this plugin cannot do with the current API.

1. **Pinch zoom.** `on_pinch` is not a supported plugin event. Smallest change: one pinch callback with a scale, tested by `kg ui`.
2. **Another plugin opening a named canvas.** The source has `canvas_show`. A plugin cannot call into another plugin, and `openPanel` delivers props only to its own panels. Smallest change: let `kg surface open` pass props through to that panel.

Move, resize, and freehand already use mouse move. The drag-and-drop API reports a text payload and a top, middle, or bottom band. It does not report a pointer point, so it does not fit drawing.

## Not tried

`kg plugin check`, the plugin tests, and a window session were not run for this note.
