# Canvas

A drawing canvas in the thread's side panel. You draw boxes, arrows, lines,
text, and freehand strokes. Agents read the same drawing as text and draw on it
too. Every change shows in the panel at once.

## Install

```sh
npm install
npm run check        # typecheck, tests, and both builds
kg plugin install .
```

After you change the source, run `npm run build` and reinstall, or use
`kg plugin dev .` while you work.

`main.js` and `ui/` are built output and are committed. What is in git is what runs.

## Open it

Click **Canvas** in the thread header, or press ⌘⇧D. Each project has its own
canvas by default. The menu (top left) switches canvases, makes a new one,
clears one, or deletes one.

## Draw

| Key | Does |
| --- | --- |
| `V` or `1` | Select and move |
| `H` | Hand: drag to pan |
| `R` or `2` | Rectangle. Hold Shift for a square |
| `A` or `5` | Arrow. Drag from one box to another to connect them |
| `L` or `6` | Line |
| `P` or `7` | Freehand |
| `T` or `8` | Text. Click a box or an arrow to label it |
| `E` or `0` | Eraser |
| `Q` | Keep the tool after drawing |
| Shift while drawing | Square box, or arrow snapped to 15° steps |
| Double-click | Edit the label of the box, arrow, or text under the pointer. On empty canvas, add text |
| Enter | Edit the label of the selected element |
| Esc | Finish text, drop the selection, back to Select |
| ⌘A | Select everything. Then Delete clears the canvas |
| ⌘C, ⌘X, ⌘V | Copy, cut, paste at the pointer. Arrows between copied boxes stay connected. Other text pastes as a text element |
| ⌘D | Duplicate the selection |
| ⌘Z, ⌘⇧Z | Undo, redo (Ctrl+Y redoes too) |
| Arrow keys | Nudge the selection. Shift moves farther |
| Space + drag, middle drag, wheel | Pan |
| ⌘ + wheel, ⌘+ / ⌘- | Zoom. ⌘0 resets it, Shift+1 fits the drawing |

A box grows taller as you type its label, so the label always fits. An arrow
drawn from one box to another sticks to both. It routes on right angles around
the other boxes and text, keeps off the lines other arrows take, and follows the
boxes when they move. An arrow label sits on a clear stretch of its own line. When nothing is
clear it takes the least-bad stretch and the edit says it covers another
arrow; when there is no room at all it stays hidden. Deleting a box deletes its arrows.

## Agents and the CLI

**Copy as image** in the menu puts a PNG of the whole drawing on the clipboard,
cropped to the drawing.

**Send** (bottom right) pastes a short note into a thread you pick: your
message, and the command that shows the canvas. The drawing itself is not
pasted, so a big drawing costs no tokens until the agent reads it. Send does
not press Enter; you do.

```sh
kg canvas list           # the canvases
kg canvas show <name>    # a summary line, then one line per element
```

Agents also get two tools. `canvas_read` prints the same text as
`kg canvas show`. `canvas_edit` applies a list of changes, all or nothing. The
`canvas` skill in `skills/canvas/SKILL.md` teaches agents how to draw a readable
diagram.

Undo and redo cover agent edits too. Each canvas keeps 25 steps.

Drawings saved by version 0.1.6 open as they were.

## Files

- `src/main.ts`: the plugin's job loop and the calls into kagan.
- `src/host/actions.ts`: the agent tools, the CLI, and the page's calls, with the host passed in.
- `src/host/store.ts`, `rows.ts`, `sql.ts`: saved canvases, their row contract, undo, and the SQLite adapter.
- `src/host/names.ts`, `bridge.ts`, `upload.ts`: the default canvas name, page-message checks, and PNG pieces.
- `src/text.ts`: the text agents read, and the diff an edit returns.
- `src/model.ts`: elements, ops, and the document schema.
- `src/diagram.ts`, `layout.ts`, `route.ts`: what agents read, text measurement, and arrow routes.
- `src/clip.ts`, `export.ts`: copy and paste, and SVG export.
- `src/ui/gesture.ts`, `sketch.ts`: zoom and fit, and the hand-drawn look.
- `src/protocol.ts`: the messages between the page and the plugin, and their checks.
- `src/ui/`: the panel page, its document session, send bar, renderers, and geometry.
- `schemas/`: the input schemas kagan checks tool calls against.
- `kagan.json`: the manifest.
- `PORT.md`: what moved from the bb plugin, what differs, and what cannot move.

Run `npm run check` for the typecheck, the tests, and both builds. The tests use
`node --test`; `test/register-tsx.mjs` teaches it the panel's JSX. `npm run
test:ui` drives the built page in Chromium; it needs Playwright (`npm i -D
playwright`) or `CANVAS_UI_PLAYWRIGHT` set to its `index.mjs`, and writes
screenshots under `test/ui/screenshots/`.
