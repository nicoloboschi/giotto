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
- `create_diagram(title, elements?, legend?)`: a new diagram. **New topic = new diagram.**
- `get_diagram(id)`: elements plus `selectedIds`. "This" / "these" usually means the selected shapes.
- `edit_diagram(id, add?, update?, remove?, title?, legend?)`: small changes. `update` takes partial elements by id; only the given fields change.
- `export_diagram(id?, format: svg|png|mp4, path?, style?, dark?, scene?, beat?, speed?)`: writes a file **and returns the picture**, so you can look at your work. Leave out `id` to draw a sample.

Every change returns what was stored plus **warnings**: overlapping shapes, text spilling out of its box, fields, blocks or tones that aren't drawn. Fix them before you finish. Diagrams can't be deleted.

**Pasted areas:** the user can drag over part of the canvas and paste a snippet like `Giotto diagram "X" (id: x), area x 0..200, y 0..150:` with the elements inside. Those ids are what they mean; the coordinates say where to put new things.

## Elements

```json
{"id":"layer","type":"group","x":0,"y":0,"label":{"title":"What the agent remembers"},"children":["chat","rules"],"layout":{"direction":"row","gap":40}}
{"id":"chat","type":"rectangle","tone":"private","content":[
  {"type":"title","text":"Kate and her agent"},
  {"type":"chips","items":["user:kate","strategy: rules"]},
  {"type":"chat","turns":[{"who":"Kate","text":"I'm **interviewing** next week."},{"who":"Agent","text":"Noted."}]}]}
{"id":"rules","type":"rectangle","tone":"shared","label":{"title":"Team rules","lines":["- no Friday deploys","- two approvals per PR"]},"tags":["kind:rule"]}
{"id":"db","type":"ellipse","x":0,"y":400,"tone":"store","label":{"text":"Postgres"}}
{"id":"rules-db","type":"arrow","start":{"id":"rules"},"end":{"id":"db"},"label":{"text":"stored in"},"fromSide":"bottom"}
{"id":"why","type":"note","attachTo":"db","text":"Backed up nightly"}
```

- **Let Giotto do the layout.** Put things in a `group` with `layout` (`row`, `column` or `grid`, plus `gap`, `columns`, `align`) instead of computing x/y. Leave out `width`/`height` and boxes fit their content. Groups wrap their children, draw behind them, and can nest.
- **What goes in a box:** a `label` (`{"text"}`, or `{"title", "lines": [...], "align"}`; lines starting with `- ` are bullets), plus `tags` (pills). For richer boxes use `content` blocks: `title`, `subtitle`, `text`, `list` (`items`, `ordered`), `chips` (`items`), `chat` (`turns` of `{who, text}`), `code`, `divider`, `rows` (tagged lines: `{tag, tone, text, meta, mark}`), `graph` (`nodes`, `links`, `lit`). Any text understands `**bold**`, `` `code` `` and blank lines.
- **Notes** with `attachTo` sit beside their shape and move with it.
- **Arrows** route themselves: straight when clear, around boxes when not. Optional: `fromSide`/`toSide` (`top`, `right`, `bottom`, `left`), `route` (`straight`, `elbow`), `labelAt` (0..1), `labelPosition` (`on`, `above`, `below`).
- **Order:** `z` (higher on top, default 0).
- **Legend:** `legend: {"title": "...", "items": [{"tone": "private", "text": "Private memories"}]}` on the diagram.
- Types: `rectangle`, `ellipse`, `diamond`, `cylinder` (data at rest), `text`, `arrow`, `line`, `group` (without a label it only arranges, no frame), `note`.

## Scenes: diagrams that tell a story

A diagram can carry `scenes`: short stories played on the canvas (tabs, play, 1×/2×) and in animated exports. Each scene is a list of beats; a beat sends packets along arrows, fills boxes, lights boxes and narrates.

```json
"speed": 2200,
"scenes": [{ "label": "retain()", "beats": [
  { "edges": { "edge": "call-retain", "data": "the conversation" }, "show": { "agent": [{ "tag": "user", "tone": "gray", "text": "“Alice joined Google…”" }] }, "say": "Your agent sends what happened." },
  { "edges": ["s-idx", "k-idx"], "ms": 3000 },
  { "edges": { "edge": "call-retain", "back": true, "data": "✓ stored" }, "light": ["retain"] },
  { "show": { "facts": [{ "type": "graph", "nodes": ["Alice", "Google"], "links": [["Alice", "Google"]], "lit": ["Alice"] }] }, "say": "A pause: no edges, just showing." }
]}]
```

- `edges`: an arrow id, a list (they run at the same time), or `{edge, back, data}`. `show` fills a box's card with blocks or rows (`{tag, tone, text, meta, mark, mono}`); it stays until the scene ends, and boxes are sized for the largest content, so nothing jumps. `say` narrates; `ms` sets the beat length.
- Flow figures read best with `"route": "curved"` arrows, `cylinder` stores, groups with `layout`, and `"quiet": true` for arrows that should only appear while used.
- Set them with `create_diagram` / `edit_diagram` (`scenes`, `speed`; scenes are replaced as a whole). Warnings flag unknown arrow or box ids.
- Exporting a diagram with scenes: `svg` plays them in one self-contained file (GitHub, docs), `mp4` makes a video. `scene` picks one (default all, in order), `speed` sets the pace (2 = twice as fast). To check a single moment, pass `scene` + `beat` (svg or png) and look at the returned picture.

## Styles: how everything looks

Diagrams say *what* is there; the active style decides *how it looks*. One style applies to every diagram; the user picks one from a gallery and can view it light or dark.

- Use `tone` for meaning (`private`, `shared`, `rule`, or plain `blue`...). The style decides each tone's color; a tone the style doesn't define shows untoned, with a warning. Avoid `strokeColor`/`backgroundColor`: they pin a color in every style.
- `list_styles`: the built-in `default` plus every style agents made, in full. Copy one as a start.
- **Preview before switching:** call `export_diagram` with `style` set to a style *object* (not saved yet), and no `id` for a sample. Look at the returned picture.
- `save_style(id, style, use?)`: create a style, or change one by saving it again under the same id (every diagram updates). Returns what was stored, plus warnings. `default` can't be replaced; copy it under a new id.
- `use_style(id)`: switch the active style.
- **Exports** (PNG/SVG) can get a header and footer band: the style sets `header` / `footer` (`show`, `background`, `text`, sizes, `align`, `padding`, `divider`; the footer's `content` template understands `{title}`, `{date}`, `{id}`), plus `exportBackground`, `exportPadding` and `exportRadius`. Backgrounds can be gradients: `{"from", "to", "angle"}`. The diagram supplies the words: its `title`, `subtitle` and `footer`.
- Useful style fields: `tones` (any names), `font` / `labelFont` / `textFont` / `arrowFont` and their sizes, `fontUrl` (a font stylesheet) or `fontFaces` (`@font-face` rules; use `data:` URLs so PNGs get the font too), `shadow` (`{dx, dy, blur, color, opacity}` or `false`), `arrowLabelBackground`, colors for groups, notes, tags, chat bubbles and code, `css`, and `dark` (overrides for dark mode). The full list is in `save_style`'s description.

## Doing it well

- Readable ids (`kate`, `rules-db`) make later edits easy.
- One tone per kind of thing, plus a legend saying what each means.
- Several small `edit_diagram` calls beat rebuilding. Don't move shapes the user placed unless asked.
- Base the diagram on the real code you read, not on guesses. Export a PNG once to check the result.
