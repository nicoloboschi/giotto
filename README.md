# Giotto

Diagrams your coding agent draws for you, live. The agent (Claude Code, Codex, anything that speaks MCP) already knows your repo; Giotto gives it a canvas. You ask in your chat, the agent draws, you watch it in your browser.

**[Read the docs: they're a canvas →](https://nicoloboschi.github.io/giotto/)**

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
- **Scenes:** diagrams can tell a story: packets travel along arrows, boxes fill in, a narration plays. Play them on the canvas, or export an animated SVG (plays on GitHub) or an MP4.
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

## Develop

The [docs](https://nicoloboschi.github.io/giotto/) are one Giotto diagram (`site/docs.js`) that `site/index.html` draws with Giotto's own renderer and tours as you scroll. `node site/build.mjs` builds them into `_site/`; they deploy on every push to `main`.

```sh
node bin/giotto.js      # canvas
node bin/giotto.js mcp  # MCP server on stdin/stdout
npm test
```
