#!/usr/bin/env bash
# Install the multi-model panel workflow from this repo.
#
#   scripts/install.sh [--claude-home DIR] [--codex-home DIR]
#                      [--no-codex] [--no-mod] [--panel-only] [--dry-run]
#
#   --claude-home DIR  Claude Code config dir (default: $CLAUDE_HOME or ~/.claude)
#   --codex-home DIR   Codex config dir (default: $CODEX_HOME or ~/.codex)
#   --no-codex         Skip the Codex-native port of the skill
#   --no-mod           Skip the panel-view pane (the skill works without it)
#   --panel-only       Skip the companion skills (claudex-loop, codex-review,
#                      codex-build, antigravity-cli)
#   --dry-run          Print what would happen; change nothing
#
# Skills, agents and the /panel command are copied into the Claude and Codex
# homes. An existing copy that differs is moved aside to <name>.bak-<stamp>
# first. The panel-view mod is installed as a Claude Code plugin from this
# repo's marketplace, so the clone must stay where it is.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=paths.sh
source "$REPO/scripts/paths.sh"

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
DRY=0; NO_CODEX=0; NO_MOD=0; PANEL_ONLY=0
STAMP="$(date +%Y%m%d-%H%M%S)"

while [ $# -gt 0 ]; do
  case "$1" in
    --claude-home) CLAUDE_HOME="$2"; shift 2 ;;
    --codex-home)  CODEX_HOME="$2"; shift 2 ;;
    --no-codex)    NO_CODEX=1; shift ;;
    --no-mod)      NO_MOD=1; shift ;;
    --panel-only)  PANEL_ONLY=1; shift ;;
    --dry-run)     DRY=1; shift ;;
    -h|--help)     sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

run() { if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }

COMPANIONS=" skills/antigravity-cli/ skills/claudex-loop/ skills/codex-review/ skills/codex-build/ "

echo "Installing from $REPO"
echo "  Claude home: $CLAUDE_HOME"
[ "$NO_CODEX" = 1 ] || echo "  Codex home:  $CODEX_HOME"
[ "$DRY" = 0 ] || echo "  (dry run: nothing will change)"
echo

for entry in "${PANEL_PATHS[@]}"; do
  side="${entry%%:*}"; rel="${entry#*:}"
  # The mod is installed as a plugin below, not copied.
  [ "$rel" = "mods/panel-view/" ] && continue
  [ "$side" = codex ] && [ "$NO_CODEX" = 1 ] && continue
  [ "$side" = claude ] && [ "$PANEL_ONLY" = 1 ] && [[ "$COMPANIONS" == *" $rel "* ]] && continue

  if [ "$side" = claude ]; then home="$CLAUDE_HOME"; else home="$CODEX_HOME"; fi
  src="$REPO/$side/${rel%/}"; dst="$home/${rel%/}"

  if [ -e "$dst" ]; then
    if diff -rq -x __pycache__ -x '*.pyc' -x .DS_Store "$src" "$dst" >/dev/null 2>&1; then
      echo "unchanged  $side:${rel%/}"; continue
    fi
    echo "backup     $dst -> $dst.bak-$STAMP"
    run mv "$dst" "$dst.bak-$STAMP"
  fi
  echo "install    $side:${rel%/}"
  run mkdir -p "$(dirname "$dst")"
  if [ "${rel%/}" != "$rel" ]; then
    run rsync -a "${PANEL_EXCLUDES[@]}" "$src/" "$dst/"
  else
    run cp "$src" "$dst"
  fi
done

echo
if [ "$NO_MOD" = 1 ]; then
  echo "mod        skipped (--no-mod)"
elif [ "$CLAUDE_HOME" != "$HOME/.claude" ]; then
  # The claude CLI always writes the real user settings, so leave a custom home alone.
  echo "mod        not registered: --claude-home is not ~/.claude. To add it there, run:"
  echo "             claude plugin install panel-view --marketplace \"$REPO\""
elif ! command -v claude >/dev/null 2>&1; then
  echo "mod        not registered: the claude CLI is not on PATH. Once it is, run:"
  echo "             claude plugin install panel-view --marketplace \"$REPO\""
else
  existing="$(claude plugin list --json 2>/dev/null \
    | jq -r '.[]? | select((.id // "") | startswith("panel-view@")) | .id' | head -n 1 || true)"
  if [ -n "$existing" ] && [ "$existing" != "panel-view@multi-model-panel" ]; then
    echo "mod        already installed as $existing; leaving it alone"
  elif [ -n "$existing" ]; then
    echo "mod        already installed from this repo's marketplace"
  else
    echo "mod        installing panel-view from this repo's marketplace"
    run claude plugin install panel-view --marketplace "$REPO"
  fi
fi

cat <<EOF

Next steps
  1. Add the routing rules in docs/CLAUDE-md-snippet.md to $CLAUDE_HOME/CLAUDE.md.
  2. In any open Claude Code session, run /reload-plugins (new sessions pick it up on their own).
  3. Run scripts/doctor.sh to check the four seat CLIs and the roster.
  4. Read "Adapt it to your machine" in the README: the Gemini read grant names the author's paths.
EOF
