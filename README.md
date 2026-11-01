# Canvas

A shared drawing canvas for [kagan](https://kagan.sh), ported from
[bb-kit canvas](https://github.com/get-bb/bb-kit). Boxes, arrows that stick and
route on right angles, lines, text, and freehand strokes, with a hand-drawn
look. You draw; agents read and draw too.

## Install

```sh
kg plugin install git:https://github.com/kagan-sh/canvas@main
```

Approve the powers in the window, then open **Canvas** from the rail or press
⌘⇧D while a thread is on screen.

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
| ⌘Z / ⌘⇧Z | Undo / redo |
| Space + drag, wheel | Pan |
| ⌘ + wheel, ⌘+ / ⌘- | Zoom. ⌘0 resets, Shift+1 fits |

Each project has its own canvas by default. The menu (top left) switches
canvases, makes a new one, clears one, or deletes one.  **Copy note** copies a short
note plus `kg canvas show <name>` so you can paste it into a thread without
putting the drawing in the context.

## Agents

```sh
kg canvas list
kg canvas show <name>
```

Tools: `canvas_read`, `canvas_edit`. The bundled `canvas` skill teaches readable
diagrams. Undo covers agent edits too (25 steps).

## Develop

```sh
kg plugin check .
kg plugin install .
kg plugin dev .
```
