#!/usr/bin/env bash
# Check that this machine can seat the panel. Read-only: changes nothing.
#
#   scripts/doctor.sh [--claude-home DIR] [--codex-home DIR] [--offline]
#
#   --offline  Skip `agy models` and `grok models` (they call the providers)
#
# Exits 1 when a required tool is missing. A seat whose CLI is missing is
# reported as such; the panel still convenes with at least two non-Anthropic
# seats, so a missing seat is a warning, not a failure.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
OFFLINE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --claude-home) CLAUDE_HOME="$2"; shift 2 ;;
    --codex-home)  CODEX_HOME="$2"; shift 2 ;;
    --offline)     OFFLINE=1; shift ;;
    -h|--help)     sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

fail=0; seats=0
ok()   { printf '  ok    %-10s %s\n' "$1" "$2"; }
warn() { printf '  WARN  %-10s %s\n' "$1" "$2"; }
bad()  { printf '  FAIL  %-10s %s\n' "$1" "$2"; fail=1; }
first_line() { "$@" 2>&1 | head -n 1; }

echo "Required tools"
for t in jq perl git; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t" "$(command -v "$t")"; else bad "$t" "not on PATH"; fi
done
if command -v python3 >/dev/null 2>&1; then ok python3 "$(first_line python3 --version) (Codex port only)"
else warn python3 "not on PATH (needed only by the Codex port)"; fi
if command -v claude >/dev/null 2>&1; then ok claude "$(first_line claude --version)"
else bad claude "Claude Code CLI not on PATH"; fi

echo
echo "Seat CLIs"
if command -v codex >/dev/null 2>&1; then
  model="$(sed -n 's/^[[:space:]]*model[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' "$CODEX_HOME/config.toml" 2>/dev/null | head -n 1)"
  ok codex "$(first_line codex --version); config.toml model: ${model:-unset (CLI default)}"
  seats=$((seats + 1))
else warn codex "not on PATH: the Codex seat will be unavailable"; fi

AGY="$HOME/.local/bin/agy"
if [ -x "$AGY" ]; then
  ok agy "$AGY"; seats=$((seats + 1))
  settings="$HOME/.gemini/antigravity-cli/settings.json"
  if jq -e '[.permissions.allow[]? | select(startswith("read_file("))] | length > 0' "$settings" >/dev/null 2>&1; then
    ok agy-grant "read_file rules present in $settings"
  else
    warn agy-grant "no read_file rules in $settings: the skill restores them at run time (see README)"
  fi
else warn agy "not found at $AGY: the Gemini seat will be unavailable"; fi

GROK="$HOME/.grok/bin/grok"
if [ -x "$GROK" ]; then ok grok "$(first_line "$GROK" --version)"; seats=$((seats + 1))
else warn grok "not found at $GROK: the Grok seat will be unavailable"; fi

for a in panel-claude-fable panel-claude-opus; do
  if [ -f "$CLAUDE_HOME/agents/$a.md" ]; then ok agent "$a"
  else warn agent "$a missing from $CLAUDE_HOME/agents (run scripts/install.sh)"; fi
done

echo
echo "Roster"
ROSTER="$CLAUDE_HOME/skills/multi-model-panel/roster.json"
[ -f "$ROSTER" ] || ROSTER="$REPO/claude/skills/multi-model-panel/roster.json"
gem="$(jq -r .gemini.model "$ROSTER")"; grk="$(jq -r .grok.model "$ROSTER")"
ok roster "$ROSTER (verified $(jq -r .verified "$ROSTER"))"
if [ "$OFFLINE" = 1 ]; then
  echo "  (offline: not checking model lists)"
else
  # Capture the lists first: grok aborts when grep -q closes the pipe early.
  if [ -x "$AGY" ]; then
    list="$("$AGY" models 2>/dev/null)"
    if grep -qF -- "$gem" <<< "$list"; then ok gemini "$gem is listed by agy models"
    else warn gemini "$gem not in agy models output: bump roster.json"; fi
  fi
  if [ -x "$GROK" ]; then
    list="$("$GROK" models 2>/dev/null)"
    if grep -qF -- "$grk" <<< "$list"; then ok grok "$grk is listed by grok models"
    else warn grok "$grk not in grok models output: bump roster.json"; fi
  fi
fi

echo
if [ "$seats" -lt 2 ]; then
  warn panel "only $seats non-Claude seat CLI(s) found; a panel needs at least one non-Anthropic seat, and is far more useful with three"
fi
if [ "$fail" = 0 ]; then echo "Ready."; else echo "Missing required tools (FAIL lines above)."; fi
exit "$fail"
