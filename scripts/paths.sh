# Shared by install.sh and sync-from-local.sh: what this repo carries.
# Each entry is "<side>:<path>", where <side> is claude (~/.claude) or codex (~/.codex)
# and <path> is relative to that home. Directories end in a slash.
# shellcheck disable=SC2034  # read by the scripts that source this file
PANEL_PATHS=(
  "claude:skills/multi-model-panel/"
  "claude:skills/antigravity-cli/"
  "claude:skills/claudex-loop/"
  "claude:skills/codex-review/"
  "claude:skills/codex-build/"
  "claude:agents/panel-claude-fable.md"
  "claude:agents/panel-claude-opus.md"
  "claude:commands/panel.md"
  "claude:mods/panel-view/"
  "codex:skills/multi-model-panel/"
)

# Never copied in either direction.
PANEL_EXCLUDES=(
  --exclude "__pycache__/"
  --exclude "*.pyc"
  --exclude ".DS_Store"
  --exclude ".claude-plugin/types/"
)
