---
name: giotto
description: Draw and update diagrams the user watches live in the Giotto canvas (giotto MCP tools), and change how they look with styles. Use when the user asks to draw, sketch, diagram, map or visualize something (architecture, flows, plans), to change a diagram or its style, to export one as SVG/PNG, or pastes a "Giotto diagram ... area" snippet. If the giotto tools are missing, this skill explains how to install Giotto.
---

# Giotto

Giotto's canvas runs at http://localhost:4321. It shows every diagram in a sidebar and redraws live as you edit. Giotto never opens a browser itself: **after you create or change a diagram, give the user its link** (tool results include it, like `http://localhost:4321/#<id>`). The user can move and resize shapes and rename labels by hand, so always read before you change.

## First time: install Giotto

If you don't have the giotto tools (`list_diagrams`, `create_diagram`, ...), Giotto isn't installed yet. Tell the user, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/nicoloboschi/giotto/main/install.sh | bash
```

It needs git and Node.js 20+. It clones Giotto into `~/.giotto/app`, adds a `giotto` command, and connects Claude Code and Codex to it. Agents load MCP servers when they start, so then ask the user to **restart this session** (or reconnect MCP servers, e.g. `/mcp` in Claude Code) and try again. Don't draw the diagram some other way in the meantime.

## Diagram tools

- `list_diagrams`: all diagrams, newest first. Start here.
- `create_diagram(title, elements?)`: a new diagram. **New topic = new diagram.** Only edit an existing one when the user means that one.
- `get_diagram(id)`: elements plus `selectedIds`. If the user says "this" or "these", they mean the selected shapes.
- `edit_diagram(id, add?, update?, remove?, title?)`: small changes. `update` takes partial elements by id; only the given fields change. Removing a shape also removes its arrows.
- `export_diagram(id, format: svg|png, path?, style?)`: writes an image file and returns its path. Uses the active style unless you pass one. PNG needs the canvas open in a browser; if it isn't, ask the user to open the link (or export SVG).

There is no delete. Never try to remove a whole diagram.

**Pasted areas:** the user can drag over part of the canvas and paste you a snippet like `Giotto diagram "X" (id: x), area x 0..200, y 0..150:` followed by the elements inside. Those ids are what they mean; the area coordinates tell you where to put new things.

## Elements

```json
{"id":"api","type":"rectangle","x":0,"y":0,"width":160,"height":70,"label":{"text":"API"},"tone":"blue"}
{"id":"db","type":"ellipse","x":260,"y":0,"width":160,"height":70,"label":{"text":"Postgres"},"tone":"yellow"}
{"id":"api-db","type":"arrow","x":0,"y":0,"start":{"id":"api"},"end":{"id":"db"},"label":{"text":"SQL"}}
{"id":"note","type":"text","x":0,"y":-60,"text":"Read path"}
```

Types: `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`. Arrows with `start` and `end` are routed for you and follow when shapes move. `strokeStyle`: `dashed` or `dotted`.

## Styles: how everything looks

Diagrams say *what* is there; the active style decides *how it looks* (background, font, colors, lines, corners, shadows, arrowheads, extra CSS). One style applies to every diagram, and the user switches styles from a gallery in the UI.

- Color shapes with `tone` (`blue`, `green`, `yellow`, `red`, `purple`, `gray`), never hex colors, so every style can recolor them. `strokeColor`/`backgroundColor` pin a color in all styles; avoid them.
- `list_styles`: the built-in `default` plus every style agents made, in full, and which is active. Copy one as a starting point.
- `save_style(id, style, use?)`: create a style, or change one by saving it again under the same id (everything shown in it updates). `use: true` switches the canvas to it live. Fields you leave out fall back to the default style. `css` gives full control over the classes `g-shape`, `g-label`, `g-text`, `g-arrow`, `g-tone-<tone>`. `default` itself can't be replaced: save a copy under a new id.
- `use_style(id)`: switch the active style.

## Doing it well

- Use readable ids (`api`, `api-db`) so later edits are easy.
- Layout: flows go left to right or top to bottom, with about 60px gaps and no overlaps. Size shapes to fit their label (about 9px per character, at least 140x60).
- One tone per kind of thing (for example services blue, data stores yellow).
- Make several small `edit_diagram` calls rather than rebuilding everything. Don't move shapes the user placed unless asked.
- Base the diagram on the real code you read, not on guesses.
