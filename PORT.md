```
Plugin: Canvas
Source: /Users/aorumbayev/projects/bb-kit/plugins/canvas
kagan id: dev.kagan.canvas

Moved as-is:
- Drawing tools and keys: select, hand, rectangle, arrow, line, pen, text, eraser
- Selection, move, resize handles, marquee, eraser drag, arrow endpoints that stick to boxes
- Undo and redo, 25 steps per canvas, agent edits included
- Zoom, fit (Shift+1), pan (space, middle drag, wheel), pinch on touch
- Clipboard copy, cut, paste, duplicate; arrows between copied boxes stay connected
- PNG copy of the whole drawing, cropped to the content
- Named canvases: list, create, switch, reset, delete with confirmation
- Send to a thread from the picker, with a note
- Agent tools canvas_read and canvas_edit, aliases, id rules, and diff-style replies
- CLI: kg canvas list, kg canvas show <name>
- The canvas skill
- Light and dark themes, locked tool mode, quick colours, compact and touch chrome
- Legacy 0.1.6 canvases still open

Close (what differs):
- One Kagan web panel, not a bb server + app pair: the page talks to main.ts over a small JSON protocol.
- Send pastes the share note with `pasteIntoThread`. Kagan's `threads.send` presses Enter, and that could answer a prompt or a running agent, so the person still presses Enter.
- Copy as image sends the PNG to the plugin in ordered pieces, and `writeClipboardPng` writes it. The page cannot use the browser clipboard under the panel CSP.
- Theme comes from Kagan's `/__kagan/theme.css` and `color-scheme`, not bb's code-theme hook.
- The thread picker shows status, not provider: Kagan thread records omit the program.

Gaps (workaround, or cannot move):
- `canvas_show`, `canvas_pending`, and `canvas_take_pending` for another plugin (bb's Sign-off opens a named canvas): cannot move. Kagan plugins have no RPC into each other and no cross-plugin event. A host "open panel on this canvas" call or a public plugin event would be needed.
- bb's command-palette action: Kagan has manifest commands, not an app command-palette contribution. The header Canvas button and its key cover the same action.

Powers asked:
- areas: database, threads
- clipboard: write only

Right panel: supported
Theme: follows the host
kg plugin check: not run here (kg is not on PATH in this environment)
Tried: npm run check (typecheck, 141 node:test checks, both builds) and npm run test:ui (64 Chromium checks)
```
