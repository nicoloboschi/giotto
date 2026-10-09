---
name: giotto
description: Draw and update diagrams the user watches live in the Giotto canvas (giotto MCP tools), and change how they look with styles. Use when the user asks to draw, sketch, diagram, map or visualize something (architecture, flows, plans), to change a diagram or its style, to export one as SVG/PNG, or pastes a "Requested changes ... for Giotto diagram" snippet. If the giotto tools are missing, this skill explains how to install Giotto.
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

- `diagram_history(id)` / `restore_version(id, v)`: every change (yours, the user's on the canvas, a direct file edit) is a numbered version; the server picks the numbers and edit results say which one they made ("saved as v12"). Restoring makes an old version the newest; nothing is lost.

Every change returns what was stored plus **warnings**: overlapping shapes, text spilling out of its box, fields, blocks or tones that aren't drawn. Fix them before you finish. Agents can't delete diagrams (the user can, on the canvas).

## Pages: images in HTML

When the picture isn't boxes and arrows (a results card, a poster, a bar chart, a slide), make a **page** instead: you write the HTML, Giotto shows it live, versions it, and exports it.
- `create_page(title, html, width?, height?)`: `html` is the body's content plus your own `<style>`. Static HTML + CSS (inline SVG is fine), no scripts. The page is exactly width × height px (default 1200 × 1500); anything outside is cut off.
- `edit_page(id, html? | replace?: [{find, with}], title?, width?, height?)`: each `find` must appear exactly once.
- Colors and fonts come from the active style as CSS variables: `--g-background`, `--g-text`, `--g-muted`, `--g-accent`, `--g-font`, and `--g-tone-<name>` / `-fill` / `-text`. Use them, so pages match the diagrams and dark mode works. Other fonts: `@import` a Google Fonts URL in your `<style>`.
- Check it: `export_diagram(id, format: png)` returns the picture (needs Chrome). `format: html` writes one self-contained file.
- Requested changes on a page list the text inside each area (`<h1> "Same memories…" at x 80, y 187`).

**Requested changes from the user:** on the canvas the user draws areas, writes what should change in each, and pastes you one snippet starting with `Requested changes (N) for Giotto diagram "X" (id: x):`. Each numbered item is one request, with its area (`Area x 0..200, y 0..150`) and the elements inside it (ids, positions). Do every item: the ids are what they mean, and an empty area's coordinates say where to put new things.

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
- **What goes in a box:** a `label` (`{"text"}`, or `{"title", "lines": [...], "align"}`; lines starting with `- ` are bullets), plus `tags` (pills). For richer boxes use `content` blocks: `title`, `subtitle`, `text`, `list` (`items`, `ordered`), `chips` (`items`), `chat` (`turns` of `{who, text}`), `code`, `divider`, `rows` (tagged lines: `{tag, tone, text, meta, mark}`), `graph` (`nodes`, `links`, `lit`), `chart` (performance plots, below). Any text understands `**bold**`, `` `code` `` and blank lines.
- **Charts:** a `chart` block draws a plot in a box. `kind`: `hbar` (comparisons with names, e.g. us vs others), `bar` (grouped bars over versions or categories), `line` (a metric over time), `hist` (a distribution: give the raw samples in `values`, Giotto bins them). Data is `labels` + `values`, or `series: [{name, tone?, values}]` for several. `unit` (`"ms"`, `"%"`, `"x"`) goes on every number; `lit: ["Giotto"]` keeps those bars bright and fades the rest; `marks` add dashed reference lines: `{at, label, tone}` (a target, an SLO) or `"p50"`, `"p99"`, `"mean"` (computed from the data). Put the chart's title in a `title` block above it.
  `{"type": "chart", "kind": "hbar", "labels": ["Giotto", "Mermaid"], "values": [12400, 5300], "unit": "req/s", "lit": ["Giotto"]}`
- **Notes** with `attachTo` sit beside their shape and move with it.
- **Arrows** route themselves: straight when clear, around boxes when not. Optional: `fromSide`/`toSide` (`top`, `right`, `bottom`, `left`), `route` (`straight`, `elbow`), `labelAt` (0..1), `labelPosition` (`on`, `above`, `below`).
- **Order:** `z` (higher on top, default 0).
- **Legend:** `legend: {"title": "...", "items": [{"tone": "private", "text": "Private memories"}]}` on the diagram.
- **Text** takes `fontSize` and a `tone` for its colour. Give it a `width` and the paragraph wraps into that column; without one it stays on a single line (`\n` always breaks).
- **Pictures:** `{"type":"image","href":"data:image/png;base64,…","width","height","fit":"contain"}`. `href` must be a data URI — a file path or an http URL draws nothing. `fit: "contain"` shows the whole picture, the default crops it to the box. The box keeps a border in the tone's stroke colour; a tone whose stroke matches the background hides it.
- Types: `rectangle`, `ellipse`, `diamond`, `cylinder` (data at rest), `text`, `arrow`, `line`, `group` (without a label it only arranges, no frame), `note`, `image`, `terminal`.

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

### Walkthroughs and launch videos: scenes that change the diagram

Beats can do more than send packets. With these, one diagram becomes a guided walkthrough, a product demo or a launch video (Giotto's own website is one: `site/giotto-docs.json`):

```json
{ "chapter": "Ask for a diagram", "focus": "ask-stop", "wait": true, "ms": 1400 },
{ "term": { "id": "ask-term", "you": "How does login work? Draw it." }, "ms": 2200 },
{ "term": { "id": "ask-term", "working": "Drawing in Giotto…" }, "edges": { "from": "ask-term", "to": "ask-canvas" }, "ms": 1000 },
{ "edit": { "add": [...], "update": [...], "remove": [...] }, "term": { "id": "ask-term", "agent": "Here’s the flow." }, "ms": 2000 },
{ "pointer": { "area": "auth", "text": "Split this in two" }, "ms": 1600 },
{ "style": "paper", "ms": 1500 }
```

- `edit` changes the diagram mid-scene, like `edit_diagram`: removed things fade, moved ones slide, new ones pop in one by one, new arrows draw. Edits add up through the scene.
- `focus` (an id, ids, or null for everything) flies the camera there. Give the diagram a `view` ({width, height}) for the picture size.
- `term` types into a `terminal` element (`you`), shows a spinner (`working`) and the reply (`agent`).
- `edges` can be `{from, to, data}`: a packet between any two elements.
- `pointer` drags out a requested-change area (`area`, `text`) or holds an element (`drag`; move it with an `edit` next); null clears it.
- `style` switches the look from that beat on. `chapter` titles a part; `wait` marks where a scroll-driven player pauses.
- Elements for these: `{"type": "terminal", "title"}` (a coding agent's terminal) and `{"type": "image", "href": "data:…", "width", "height"}`.
- Export as before: `svg` is one looping animated picture (it plays on GitHub), `mp4` a video.

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
