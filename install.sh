#!/usr/bin/env bash
# Giotto installer. Safe to run again: it updates instead.
#   curl -fsSL https://raw.githubusercontent.com/nicoloboschi/giotto/main/install.sh | bash
# Clones Giotto into ~/.giotto/app, puts `giotto` in ~/.local/bin,
# and connects Claude Code and Codex (MCP server, plus the skill if it isn't there yet) if they're installed.
set -euo pipefail

REPO="${GIOTTO_REPO:-https://github.com/nicoloboschi/giotto.git}"
APP="${GIOTTO_HOME:-$HOME/.giotto/app}"
BIN="$HOME/.local/bin"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'Giotto: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "needs git."
command -v node >/dev/null || fail "needs Node.js 20 or newer: https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail "needs Node.js 20 or newer (you have $(node -v))."

if [ -d "$APP/.git" ]; then
  say "Updating Giotto in $APP"
  git -C "$APP" pull --ff-only --quiet
else
  say "Installing Giotto in $APP"
  mkdir -p "$(dirname "$APP")"
  git clone --quiet --depth 1 "$REPO" "$APP"
fi

mkdir -p "$BIN"
chmod +x "$APP/bin/giotto.js"
ln -sfn "$APP/bin/giotto.js" "$BIN/giotto"

# Agents get absolute paths, so they find Giotto whatever their PATH is.
# If you switch Node versions later, run this installer again.
NODE="$(command -v node)"
SERVER="$APP/bin/giotto.js"

# Link the skill unless one is already there (e.g. from `npx skills add nicoloboschi/giotto`).
add_skill() {
  mkdir -p "$1"
  if [ -e "$1/giotto" ] || [ -L "$1/giotto" ]; then return; fi
  ln -s "$APP/skills/giotto" "$1/giotto"
}

if command -v claude >/dev/null; then
  claude mcp remove giotto -s user >/dev/null 2>&1 || true
  claude mcp add giotto -s user -- "$NODE" "$SERVER" mcp >/dev/null
  add_skill "$HOME/.claude/skills"
  say "Connected Claude Code"
fi

if command -v codex >/dev/null; then
  codex mcp remove giotto >/dev/null 2>&1 || true
  codex mcp add giotto -- "$NODE" "$SERVER" mcp >/dev/null
  add_skill "$HOME/.codex/skills"
  say "Connected Codex"
fi

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add $BIN to your PATH to use the giotto command." ;;
esac

say "Done. Ask your agent to draw something; the canvas opens at http://localhost:4321"
echo "Update later with: giotto update"
