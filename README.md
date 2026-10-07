# Giotto

Diagrams your coding agent draws for you, live. The agent (Claude Code, Codex, anything that speaks MCP) already knows your repo; Giotto gives it a canvas. You ask in your chat, the agent draws, you watch it in your browser.

**[Read the docs →](https://nicoloboschi.github.io/giotto/)** Giotto made its own website: the docs are one Giotto diagram ([`site/giotto-docs.json`](site/giotto-docs.json)), played as you scroll. The walkthrough below is the same diagram, exported by Giotto as an animated SVG.

[![A walkthrough of the docs: you ask your agent, it draws and changes the diagram live](docs/tour.svg)](https://nicoloboschi.github.io/giotto/)

![How Giotto works](docs/how-it-works.svg)

![Rich boxes: chat, chips, lists and code, laid out by a group](docs/example.svg)

## Install

```sh
npx skills add nicoloboschi/giotto
```

Then ask your agent for a diagram. The first time, it sets Giotto up for you and asks you to restart the session once. Needs git and Node.js 20+.

<details>
<summary>Install by hand, update, other agents</summary>

- Install: `curl -fsSL https://raw.githubusercontent.com/nicoloboschi/giotto/main/install.sh | bash`. It clones Giotto into `~/.giotto/app`, adds a `giotto` command, and connects Claude Code and Codex.
- Update: `giotto update`. The running canvas switches to the new code by itself.
- Other agents: point your MCP config at `node /path/to/giotto/bin/giotto.js mcp`.
- ChatGPT / Claude.ai (diagram drawn inside the chat): run `giotto mcp --http 4322`, put a tunnel in front (`ngrok http 4322`), and add the printed `https://<tunnel>/mcp/<secret>` URL as a connector (ChatGPT: Settings → Apps → Developer mode). Diagrams still save to `~/.giotto`, so the local canvas updates too.
- Hosted (Manufact, or any Node host): `npm start` serves MCP at `/mcp` on `$PORT` (default 3000), with no local canvas. Anyone with the URL can use it; set `GIOTTO_SECRET` to serve at `/mcp/<secret>` instead. Diagrams live in `$GIOTTO_DIR` (default `~/.giotto`), so give it a persistent disk if you want them kept.

</details>

## What it does

- **Live canvas** at http://localhost:4321 with every diagram in a sidebar. Move, resize and rename things by hand, search with ⌘F, undo with ⌘Z.
- **No coordinates needed.** Groups lay out their children, boxes fit their text, notes stay pinned, arrows route around boxes, legends explain colors.
- **Rich boxes:** titles, lists, tags, chat bubbles and code, with `**bold**` and `` `code` `` in any text.
- **Request changes visually:** draw areas on the canvas, write what should change in each, and copy them all as one "Requested changes" note for your agent.
- **History:** every change is a numbered version. Look back at any of them and restore it; nothing is lost.
- **Styles, separate from diagrams.** Diagrams say what things are; the active style decides how everything looks, including dark mode and export headers and footers. Agents make and change styles; you pick one from the gallery.
- **Scenes:** diagrams can tell a story: packets travel along arrows, boxes fill in, a narration plays. Scenes can also change the diagram as they go (boxes pop in, slide, regroup), move the camera, type into a terminal, point with a cursor and switch styles: enough for a product walkthrough or a launch video. Play them on the canvas, or export an animated SVG (plays on GitHub) or an MP4.
- **Pages:** for images that aren't diagrams (a results card, a poster, a chart), the agent writes HTML and Giotto shows it, versions it, takes your requested changes and exports it as PNG.
- **Export** to SVG or PNG. The agent gets the picture back, along with warnings about overlaps or text that doesn't fit.

Diagrams are JSON files in `~/.giotto/`. Agents can edit them but never delete them; you can, with the × next to each one in the sidebar. New diagrams get a random id, so renaming one never breaks its link.

## MCP tools

| Tool | What it does |
| --- | --- |
| `list_diagrams`, `get_diagram` | Read diagrams, including what you selected |
| `create_diagram`, `edit_diagram` | Make a diagram, then change it in small steps |
| `create_page`, `edit_page` | Images the agent writes in HTML (cards, posters, charts), in the style's colors and fonts |
| `export_diagram` | SVG or PNG file, plus the picture; can preview an unsaved style. Pages export as PNG (needs Chrome) or HTML |
| `list_styles`, `save_style`, `use_style` | Make, change and switch styles |
| `diagram_history`, `restore_version` | Every change is a version; restore one as the newest |

## Figures in your docs

Giotto diagrams can be docs figures. Add it as a dependency (no build step: `"giotto": "github:nicoloboschi/giotto"`), then:

```html
<script type="module">import 'giotto/player';</script>
<giotto-player src="/figures/retain.json"></giotto-player>
```

The player shows one tab per scene, play/pause, 1×/2×, full screen (⤢, Esc closes) and the narration under the figure. Scenes loop and start by themselves (`autoplay="false"` to start paused). Hovering a box lights it and its arrows. The figure fits the page width, down to half size, then scrolls. Readers who ask for less motion get no moving packets and no autoplay. In React, pass the diagram as a string: `<giotto-player doc={JSON.stringify(fig)} />`. Colors follow the page: set `--fig-bg`, `--fig-fg`, `--fig-muted`, `--fig-surface`, `--fig-border`, `--fig-group` (group frames, default `--fig-bg`), `--fig-accent` (per theme), and the player redraws when `[data-theme]` or the system theme changes. `examples/player.html` shows it working.

For READMEs, PRs and CI, export without a canvas:

```sh
giotto export retain.json retain.svg        # plays the scenes; follows the reader's light/dark
cat retain.json | giotto export - - > retain.svg
giotto export retain.json retain.svg --theme dark --static
giotto spec retain.svg                      # the diagram the SVG carries (narration included)
```

`out.png` and `out.mp4` work too, and `--style style.json` draws in a style of yours. From code, `giotto/figure` has `figureSvg` and `readFigure`; `giotto/render`, `giotto/scenes` and `giotto/styles` are the drawing code itself.

## Develop

The [website](https://nicoloboschi.github.io/giotto/) is one Giotto diagram with one scene, `site/giotto-docs.json`, written by `node site/make-docs.mjs` (which also exports it to `docs/tour.svg` with Giotto's animated export). `site/index.html` is a small player: it draws each moment with Giotto's renderer and plays the scene up to the next `wait` beat as you scroll. `node site/build.mjs` builds the site into `_site/`; it deploys on every push to `main`.

```sh
node bin/giotto.js      # canvas
node bin/giotto.js mcp  # MCP server on stdin/stdout
npm test
```
