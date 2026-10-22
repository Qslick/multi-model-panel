---
name: antigravity-cli
description: "Single-Gemini seat: invoke or offload work to Google's Antigravity CLI (agy). If the user says 'the other models', 'panel', or 'cross-model' without naming Gemini or agy, use /multi-model-panel instead. agy is a headless-capable agentic CLI running Gemini 3.x, Claude, and GPT-OSS models on Google's quota, sharing the agent harness of the Antigravity editor. MUST use this skill whenever the user asks to: run/invoke/use Antigravity or agy, offload or delegate a task to another AI agent or CLI, get a second opinion from Gemini specifically, run a prompt through Gemini 3 / Antigravity models, or compare Gemini's answer against yours. Also trigger on casual phrasing like 'ask Gemini what it thinks', 'have Antigravity do it', 'get agy to review this', or any mention of agy, Google Antigravity, or the Antigravity CLI."
---

# antigravity-cli

`agy` is the terminal surface of Google Antigravity: an autonomous coding agent (multi-step reasoning, file edits, tool calls, subagents) that you can drive headlessly from Bash. It runs on the user's Google account quota — a separate budget from yours — and gives access to Gemini 3.x, Claude 4.6, and GPT-OSS models. Everything below marked **verified** was behaviorally tested against v1.1.5 on macOS (2026-07-22); the flag/subcommand and model inventories were re-verified against v1.1.27 (2026-09-07). Doc-sourced items are marked.

## Capability check

```bash
command -v agy || ls ~/.local/bin/agy
```

- `~/.local/bin` is often missing from non-interactive shell PATH — invoke as `~/.local/bin/agy` or `export PATH="$HOME/.local/bin:$PATH"` first. (verified)
- Not installed → `curl -fsSL https://antigravity.google/cli/install.sh | bash` (installs to `~/.local/bin/agy`).
- Auth is browser-based Google sign-in stored in the OS keyring — **no API-key auth exists**. If a call fails with an auth/keyring error, stop and ask the user to run `agy` interactively once and complete the browser sign-in. Never enter credentials yourself. Over SSH it prints an auth URL + code for the user.

## Core invocation: headless one-shot

```bash
agy -p "your prompt here" --add-dir "$(pwd)"
```

- `-p` / `--print` / `--prompt`: run one prompt non-interactively, print plain-text response to stdout, exit. Works fine under pipes and non-TTY. (verified)
- **There is no `--cwd` flag** (official best-practices doc is stale). Workspace = the shell's cwd; `--add-dir <path>` (repeatable) grants additional directories. `cd` to the target project before invoking. (verified)
- **Structured output exists as of v1.1.27**: `--output-format text|json|stream-json` plus `--json-schema <string|path>` (present in `--help`; behavior not verified here). With the default `--output-format text`, stdout is prose/markdown — parse loosely or instruct the exact output format in the prompt.
- `--print-timeout` caps the run (default `5m0s`, e.g. `--print-timeout 15m`). Set your Bash tool timeout higher than it.
- Latency: trivial prompts ≈ 4–5 s on every model tested; real tasks take minutes — budget Bash `timeout: 300000`+.

### Flags (verified inventory, v1.1.27)

| Flag | Purpose |
|---|---|
| `-p`, `--print`, `--prompt` | Headless one-shot |
| `--add-dir <path>` | Grant a directory to the workspace (repeatable) |
| `--model <id>` | Model for the session (IDs below; friendly names also accepted) |
| `--effort low\|medium\|high` | Reasoning effort |
| `--mode accept-edits\|plan` | Agent execution mode (see plan-mode trap below) |
| `-c`, `--continue` | Continue this workspace's most recent conversation |
| `--conversation <id>` | Resume a specific conversation |
| `--print-timeout <dur>` | Headless wait cap (default 5m0s) |
| `--sandbox` | OS-level terminal sandbox for agent-run commands |
| `--dangerously-skip-permissions` | Auto-approve ALL tool calls (see safety) |
| `--output-format text\|json\|stream-json` | Print-mode output format (default `text`) |
| `--input-format text\|stream-json` | Print-mode input format; `stream-json` reads one NDJSON message per line from stdin and requires `--output-format stream-json` |
| `--json-schema <string\|path>` | Enforce structured output against a JSON schema (for stream-json, final result only) |
| `--disable-slash-commands` | Disable slash-command and skill expansion in print mode |
| `--agent`, `--project`, `--new-project`, `--log-file`, `-i` | Agent/project selection, log path, interactive-with-initial-prompt (`-i` needs a real TTY) |

Subcommands: `agy models`, `agy agent`/`agy agents`, `agy plugin`/`agy plugins` (install, uninstall, list, enable, disable), `agy mcp` (add, remove, list, enable, disable), `agy remote-control` (start, status, stop), `agy mic-serve`, `agy install`, `agy update`, `agy changelog`, `agy help`.

### Models (verified via `agy models`)

`gemini-3.8-flash-{high,medium,low}` · `gemini-3.7-flash-{high,medium,low}` · `gemini-3.6-flash-{high,medium,low}` · `gemini-3.1-pro-{high,low}` · `claude-sonnet-4-6` · `claude-opus-4-6-thinking` · `gpt-oss-120b-medium` (re-verified 2026-09-07 against agy 1.1.27 — unchanged)

Bad model name → exit 1 with the full list printed. Default model comes from the user's `settings.json`. Prefer Gemini models when offloading — a Gemini answer is a genuine second opinion; `claude-sonnet-4-6` via agy is still Claude.

**Model selection rule — use the best model available.** The list above will drift; run `agy models` for the live list, then pick the best Gemini model: **highest version number wins; on a version tie, higher class wins (`pro` > `flash`)**; within the chosen family take the `-high` effort variant. As of 2026-09-07 that resolves to `gemini-3.8-flash-high` (3.8 outranks 3.1 despite pro class). Drop to a `-low`/`-medium` variant only for trivial lookups where quota matters more than quality.

## Permission model in headless mode — read this first

This is the part that surprises everyone (verified, contradicts older community reports):

1. **Headless tools that need approval are auto-DENIED, not auto-approved.** A write or shell command with no allow rule produces `jetski: no output produced — a tool required the "write_file" permission that headless mode cannot prompt for, so it was auto-denied...` — printed to **stderr**, with empty stdout and **exit code 0**. Exit code does NOT signal task failure; always capture stderr (`2>&1`) and check for empty output.
2. **The silent-scratch trap:** invoked from a directory with no workspace grant, file writes *succeed* — into agy's private `~/.gemini/antigravity-cli/scratch/`, not your cwd. The response cheerfully links the file there. Always pass `--add-dir "$(pwd)"` when files matter, then verify the file landed where expected.
3. **Reads of granted dirs are auto-allowed** — analysis/review/summarization tasks work headlessly with zero config. (verified)
4. **Shell command execution is auto-denied headless**, even with `--sandbox`. (verified)
5. To enable specific writes/commands headlessly, add allow rules to `~/.gemini/antigravity-cli/settings.json` (verified working):

```json
{
  "permissions": {
    "allow": ["write_file(/path/to/project/)", "command(npm run (build|test))"],
    "deny":  ["command(sudo)", "command(rm -rf)"]
  }
}
```

Actions: `read_file`, `write_file` (implies read), `command` (anchored-regex prefix), `read_url`, `execute_url`, `mcp`, `unsandboxed`; targets are paths/domains/prefixes or `*`; precedence Deny > Ask > Allow. (doc-sourced; allow-rule path verified)

### Safety

- **Never pass `--dangerously-skip-permissions` without the user's explicit approval for that specific run.** It auto-approves everything including shell commands on their machine. If a task truly needs it, prefer a narrow `permissions.allow` rule instead, and back up `settings.json` before editing, restore after.
- If you edit `settings.json` to add temporary allow rules, scope targets to the exact directory, and remove them when done.
- Don't invoke agy from inside an agy session (`ANTIGRAVITY_AGENT=1` is reportedly set in agy environments — unverified; check before nesting).

## Recipes

**Read-only analysis / second opinion / cross-AI review** (the default, zero-config pattern):

```bash
cd /path/to/project
~/.local/bin/agy -p "Review src/auth.ts for security issues. Reply as plain chat text only — do NOT create, write, or modify any files or artifacts." --add-dir "$(pwd)" --model gemini-3.6-flash-high
```

The "plain chat text only, do NOT create files" instruction is load-bearing: without it the agent may try to write an artifact file, get auto-denied, and return nothing. Even *with* it, an occasional run nondeterministically attempts a denied tool and returns empty stdout — the diagnostic is on stderr; a plain retry usually succeeds. (verified)

**Capture output**: redirect stdout yourself (`> review.md`) rather than asking agy to write a file — no permission rules needed and you control the location. Keep stderr visible (don't `2>/dev/null`) or you'll throw away the only failure diagnostic. (verified)

**File-producing task**: add a scoped `write_file(...)` allow rule (above), run with `--add-dir`, verify the file exists afterward, restore settings.

**Multi-turn offload** — conversations are workspace-scoped (keyed to cwd) and `-c` chains with `-p` (verified):

```bash
agy -p "Analyze the failing tests in this repo. Text only, no files." --add-dir "$(pwd)"
agy -c -p "Now propose fixes for the first failure. Text only."
```

**Plan-mode trap**: `--mode=plan` headless tries to *write* an Implementation Plan artifact → auto-denied → empty output. For plans/critiques, skip `--mode` and use the text-only instruction instead. (verified)

## Strengths — when to offload to agy

- **Genuine second opinion**: different frontier models (Gemini 3.x) with a different agent harness — good for plan review, design critique, tie-breaking.
- **Separate quota**: burns the user's Google AI credits, not your tokens — useful for bulk read-only sweeps over large codebases.
- **Fast cold start** (~4 s overhead) and workspace-scoped memory for cheap multi-turn threads.
- **Own MCP/skills ecosystem**: agy loads the user's `GEMINI.md`/`AGENTS.md` context files, `.agents/skills/`, and MCP servers (`~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`) — it may have tools you don't. (doc-sourced)

## Weaknesses — when NOT to offload

- **Write/exec tasks need config surgery**: headless auto-deny means edits and commands require settings changes or a dangerous flag. For code changes on this machine, doing it yourself or using a Claude subagent is almost always simpler and safer.
- **No structured output, unreliable failure signaling** (exit 0 on denial) — bad fit for pipelines needing machine-parseable results.
- **Opaque mid-run**: no streaming progress in `-p`; a long task is a black box until it returns or times out.
- **Quota risk**: G1 credits are shared with the Antigravity editor and can exhaust quickly; the user checks with `/credits` and `/usage` in the TUI. Enterprise plans exclude Claude/GPT-OSS models. (doc-sourced)
- **Single Google account per machine**; auth cannot be scripted.

## Error handling

| Symptom | Cause → Fix |
|---|---|
| `agy: command not found` | `~/.local/bin` not on PATH → use full path or export PATH |
| `jetski: no output produced — ... auto-denied` (on **stderr**) | Headless permission denial → text-only instruction, allow rule, or (user-approved) skip flag |
| Empty stdout, exit 0, no stderr captured | Denial diagnostic was discarded (it goes to stderr) or transient tool attempt → re-run with `2>&1`; retry once |
| Output links files under `.../antigravity-cli/scratch/` | No workspace grant → re-run with `--add-dir "$(pwd)"` + allow rule |
| Keyring locked / token retrieval failure | Headless keyring lock → user runs `agy` interactively; SSH: `security unlock-keychain` (macOS) / `export $(dbus-launch)` (Linux) |
| Hang with no output (interactive `agy` in a script) | Bare `agy` in non-TTY waits on invisible prompts → always use `-p` from scripts |
| Hang mentioning `update.lock` | Self-updater stuck → `rm -f ~/.gemini/antigravity-cli/updater/update.lock`; set `AGY_CLI_DISABLE_AUTO_UPDATE=true` |
| Exit 1 + model list | Invalid `--model` → pick from the printed list |
| Quota/credits errors | Shared quota exhausted → tell the user; they manage plans/credits in the TUI |

## Config quick-reference

| What | Where |
|---|---|
| Settings (permissions, default model) | `~/.gemini/antigravity-cli/settings.json` |
| MCP servers | `~/.gemini/config/mcp_config.json` (global), `.agents/mcp_config.json` (workspace) |
| agy skills | `~/.gemini/antigravity-cli/skills/` (global), `.agents/skills/` (workspace) |
| Context files it auto-reads | `GEMINI.md` / `AGENTS.md` at workspace root |
| Logs / conversations / scratch | `~/.gemini/antigravity-cli/{cli.log,conversations,scratch}` |

Interactive TUI (for the user, not for you): slash commands `/resume`, `/fork`, `/agents`, `/tasks`, `/permissions`, `/mcp`, `/credits`, `/diff`; `ctrl+r` artifact review; `shift+tab` cycles modes. Point the user there for anything requiring live approval or credit management.
