# Giotto

Diagrams your coding agent draws for you, live. The agent (Codex, Claude Code, anything that speaks MCP) already knows your repo; Giotto gives it a canvas. You ask in your chat, the agent draws, and you watch the diagram change in your browser.

![How Giotto works](docs/how-it-works.svg)

*This diagram was drawn by an agent through Giotto and exported with `export_diagram`.*

## What you get

- **Diagrams as files.** Each diagram is a small JSON file in one shared folder, `~/.giotto/`. The agent edits it in small steps (add, update, remove), never by redrawing everything. Nobody can delete a diagram through Giotto.
- **A live canvas** at http://localhost:4321. Every diagram is in the sidebar. It redraws the moment a file changes, and follows the agent when it works on another diagram.
- **Light hand edits.** Drag shapes to move them (they snap to a grid, arrows follow), resize with the corner handle, double-click to rename, ⌘Z to undo. Your edits go back into the same file, so the agent sees them.
- **Point the agent at things.** Drag over an empty part of the canvas: Giotto selects what's inside and copies a short description to your clipboard (diagram, area, each element with its id and position). Paste it in your chat: "make these red", "add a cache here".
- **Search** with ⌘F.
- **Styles, separate from diagrams.** One style is active and it restyles every diagram: background, font, colors, lines, corners, shadows, arrowheads, even custom CSS. Only a default style is built in. Agents make the others and can change them; a change shows up on every diagram at once. Pick a style from the gallery and it applies instantly.
- **Export** to SVG, PNG or JSON from the header, or let the agent do it with `export_diagram`.
- **No dependencies, no internet.** Plain Node and one HTML page. The same drawing code makes the canvas and the SVG export.

## Install

Giotto needs git and Node.js 20 or newer. There's no package to publish or download: it's this repo.

**1. Add the skill** to your agents (Claude Code, Codex, and [others](https://skills.sh)):

```sh
npx skills add nicoloboschi/giotto
```

**2. Ask for a diagram**, like *"draw how requests flow through this repo"*. The first time, the skill tells the agent that Giotto isn't installed yet, and the agent runs the installer for you:

```sh
curl -fsSL https://raw.githubusercontent.com/nicoloboschi/giotto/main/install.sh | bash
```

**3. Restart your agent session** so it loads the Giotto tools, and ask again. The canvas opens at http://localhost:4321.

You can also run the installer yourself first. It:

- clones Giotto into `~/.giotto/app` (or updates it when it's already there)
- adds a `giotto` command in `~/.local/bin`
- connects Claude Code and Codex to the MCP server, and links the skill if it isn't there yet

**Update** with `giotto update` (a `git pull`). The running canvas switches to the new code by itself. `npx skills update` updates the skill.

**Other agents, or by hand:** clone the repo anywhere and point your agent's MCP config at `node /path/to/giotto/bin/giotto.js mcp`.

## MCP tools

| Tool | What it does |
| --- | --- |
| `list_diagrams` | All diagrams, newest first |
| `create_diagram` | A new diagram, optionally with its first elements |
| `get_diagram` | A diagram's elements, plus the shapes you selected |
| `edit_diagram` | Small changes: `add`, `update` (only the given fields), `remove`, `title` |
| `export_diagram` | Write an SVG or PNG file, in the active style or a chosen one |
| `list_styles` | The default style plus all agent-made ones, in full |
| `save_style` | Create a style, or change one by saving it under the same id |
| `use_style` | Switch the active style, live |

## Good to know

- **Always up to date.** The canvas keeps running in the background after the agent quits. Before every tool call, the MCP server checks the canvas is running the same code. If not, it replaces it, and open tabs reload by themselves.
- **Files:** diagrams in `~/.giotto/<id>.json`, agent styles in `~/.giotto/styles/<id>.json`, the active style's id in `~/.giotto/styles/current`. Change the folder with `--dir` or `GIOTTO_DIR`.
- **Ports:** one canvas per port (default 4321, change with `--port` or `GIOTTO_PORT`). Two different folders need two different ports.
- **PNG export** from the agent uses an open canvas tab to turn the drawing into pixels, and opens one if needed. SVG export doesn't need a browser.
- **Canvas only:** `giotto` opens the canvas without an agent.

## Develop

```sh
node bin/giotto.js      # canvas
node bin/giotto.js mcp  # MCP server on stdin/stdout
npm test                # logic tests
```

The code is small: `bin/giotto.js` (canvas server + MCP server), `lib/edit.js` (diagram edits), `lib/render.js` (drawing), `lib/styles.js` (the default style), `public/index.html` (the canvas page).
