#!/usr/bin/env bash
# Refresh this repo from the live copies in ~/.claude and ~/.codex.
# The live folders are the working copies; this repo is a snapshot of them.
#
#   scripts/sync-from-local.sh [--claude-home DIR] [--codex-home DIR]
#
# Copies every path in scripts/paths.sh into claude/ or codex/, deleting files
# the live copy no longer has, then shows what changed. It never commits.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=paths.sh
source "$REPO/scripts/paths.sh"

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

while [ $# -gt 0 ]; do
  case "$1" in
    --claude-home) CLAUDE_HOME="$2"; shift 2 ;;
    --codex-home)  CODEX_HOME="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

missing=0
for entry in "${PANEL_PATHS[@]}"; do
  side="${entry%%:*}"; rel="${entry#*:}"
  if [ "$side" = claude ]; then home="$CLAUDE_HOME"; else home="$CODEX_HOME"; fi
  src="$home/$rel"; dst="$REPO/$side/$rel"
  if [ ! -e "${src%/}" ]; then
    echo "skip   $side:$rel (not found at $src)"; missing=1; continue
  fi
  mkdir -p "$(dirname "${dst%/}")"
  if [ "${rel%/}" != "$rel" ]; then
    mkdir -p "$dst"
    rsync -a --delete "${PANEL_EXCLUDES[@]}" "$src" "$dst"
  else
    rsync -a "$src" "$dst"
  fi
  echo "synced $side:$rel"
done

echo
git -C "$REPO" status --short -- claude codex
git -C "$REPO" diff --stat -- claude codex | tail -n 1
[ "$missing" = 0 ] || echo "Some paths were missing; see the skip lines above." >&2
