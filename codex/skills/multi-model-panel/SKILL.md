---
name: multi-model-panel
description: Convene independent, read-only Codex, Gemini, Grok, and Claude reviewers for a decision, plan, diff, or completion check, then synthesize attributed findings and a ruling. Use for "panel this", "convene the panel", "cross-model check", or "have the other models check this". Also propose a panel before and after consequential architecture, security, data, or multi-file work; skip mechanical edits and already-verified work. The Codex reviewer uses Astra when the convener is Sol, and Sol when the convener is Astra.
---

# Multi-Model Panel

One question, four provider families, one identical packet, independent first-round answers, then a ruling by the convener. Adapted from the user's Claude skill; the Claude original is not a runtime dependency.

Accept a decision, plan text/path, diff/git ref, or "completion check" from the invoking message and conversation. If no review target can be identified, ask for it before dispatch. Invocation authorizes reviewer processes, not implementing their suggestions or expanding the original task. This skill creates review artifacts only; seats do not change code. Respect explicit user scope and any higher-priority restrictions on delegation.

## 1. Resolve the roster and session bench

Use the installed `scripts/panel.py` relative to this skill directory. It requires Python 3 and the locally authenticated `codex`, `claude`, `~/.local/bin/agy`, and `~/.grok/bin/grok` CLIs. Missing or inaccessible providers are reported, not replaced.

Run `python3 <skill-dir>/scripts/panel.py resolve` before preparing a dispatch. It reads the latest `turn_context.model` of the exact `CODEX_THREAD_ID` under `${CODEX_HOME:-~/.codex}/sessions`, never the last unrelated session or the global `config.toml` model. The mapping in `roster.json` is mandatory:

| Invoking model | Codex reviewer |
| --- | --- |
| `gpt-6-sol` | `gpt-6-astra` |
| `gpt-6-astra` | `gpt-6-sol` |

The CLI receives an explicit `--model` and the roster effort. Do not inherit the CLI default, run the same model, or silently substitute another model if the requested reviewer is unavailable. Do not rewrite global model settings.

If local metadata is unavailable, pass `--convener-model <exact-id>` only using trusted current-turn/runtime metadata or the user's explicit model identification. Do not infer identity from "GPT-6", self-description, a previous turn, or the global config. If it cannot be established, ask which model is invoking the skill. An unsupported invoking model requires an explicit user-selected supported convener identity; never silently guess a routing rule.

All other seat model IDs and efforts live in `roster.json`. Verify availability with `agy models` and `grok models` when needed. Preserve these pins unless the user requests a change; a provider error is not permission to switch models or providers.

Create a unique absolute run directory under `${TMPDIR:-/tmp}/panel-runs/` (use `mktemp -d`, not only a timestamp). Use the actual repo root or cwd as `PROJECT`. Keep artifacts outside the reviewed project by default. Choose one stable session key: `CODEX_THREAD_ID`, the current task/session ID supplied by the harness, or, if neither exists, a generated UUID retained for the whole conversation. Never use an empty/shared bench key.

The bench is `${TMPDIR:-/tmp}/panel-bench-codex-<session-key>.txt`. Read it and the conversation before every round; skip every provider already recorded as BENCHED. Only the convener appends to this file, after collecting results. Never automatically clear it. Show the resolved roster, efforts, and bench state before dispatch.

## 2. Build a self-contained packet

Write `RUN/packet.md` using [references/packet-template.md](references/packet-template.md). Fill QUESTION, MODE, CONTEXT, CONSTRAINTS, and WHAT GOOD LOOKS LIKE. Preserve its reads-only/no-shell rule and reply grammar.

Inline the actual plan, diff, relevant file excerpts, and verification output so every seat starts with identical evidence. Scope optional reads to explicitly listed paths. Include repository constraints that matter; exclude credentials and unrelated private material. A completion check must distinguish completed checks, skipped checks, and remaining claims. Dynamic commands/tests are the convener's responsibility; inline their real output rather than asking seats to run commands.

## 3. Dispatch independent fresh seats concurrently

Use the CLI helper for all four seats. Do not create user-owned Codex tasks, use Claude-only `Agent` tool syntax, or substitute a native same-model subagent. Each helper invocation is a fresh provider session and writes only its own artifact paths. Start every available seat before waiting for completion; use parallel shell processes or parallel `exec_command` calls. Omit benched seats.

Example for one seat (substitute absolute paths and the resolved current model):

```bash
python3 <skill-dir>/scripts/panel.py seat codex \
  --convener-model gpt-6-astra \
  --project /absolute/project --packet /absolute/run/packet.md \
  --output-dir /absolute/run/round1
```

Repeat concurrently for `gemini`, `grok`, and `claude`, with the same packet and convener model. If shell variables are used, define them in every new shell call. Each seat is bounded to 570 seconds and its process group is terminated on timeout. Use asynchronous tool polling so progress can be reported while the processes run.

The helper records packet SHA-256, exact command/model/effort, exit code, timestamps, raw output, stderr, and extracted response. Read `SEAT.json` and `SEAT.md`; the helper does not synthesize or retry. `model_requested` is invocation evidence, not proof of the provider's actual serving model. Report provider metadata separately when available; `MODEL_SELF_REPORT` is only a sanity check.

### Read-only mechanics

- Codex: explicit model, `--sandbox read-only`, ephemeral execution, stdin prompt ending at EOF, and `--ignore-user-config` to avoid importing user MCP/tools/hooks. Auth still uses the normal Codex home. Do not drop the sandbox to work around failure.
- Claude: fresh print-mode CLI with explicit model/effort, `--safe-mode`, only `Read,Grep,Glob`, allowed reads, `dontAsk`, no MCP, disabled skills, and no session persistence. This replaces the original Claude `Agent` seat.
- Grok: all three restrictions are necessary: `--tools read_file,grep,list_dir`, `--disallowed-tools search_tool,use_tool,Agent`, and `--deny MCPTool`; also disable web search/subagents and cross-session memory. No Docker-dependent sandbox override.
- Gemini/agy: disable slash expansion and preserve reads-only packet instructions. Headless permissions are the backstop; this CLI has no verified per-invocation read-only tool allowlist. Do not claim a hard sandbox. Never add shell grants, `--mode plan`, or a permission bypass. If local permissions allow writes/commands without prompting, bench this seat as unavailable until an appropriately restricted setup is supplied.

Never weaken controls, change provider permission settings, or add fallback models just to fill a seat.

## 4. Collect with bounded recovery

A successful seat has exit code 0, nonempty extracted text, and a valid `VERDICT` plus all required reply labels. Review the actual response too; labels alone do not make a substantive review.

For failed seats, inspect the actual provider error (stderr or structured error output), not the packet or echoed prompt:

1. Usage limit, quota exhaustion, rate limit, or insufficient credits: append the seat, timestamp, and a concise error to the session bench. Record `BENCHED: out of usage`. No retry, including in later panels this session.
2. Permission auto-denial (`no output produced`, `auto-denied`), missing CLI, auth failure, unsupported model, or unsupported flags: record `UNAVAILABLE` with the reason; do not retry unchanged.
3. Other transient failure or malformed response: retry once with exactly the same packet/model/controls into a new attempt directory. Preserve both attempts. Still failing means `UNAVAILABLE`.

Always retain all four seats in the report, including benched/unavailable seats. Never fabricate a seat response. A cross-model ruling requires at least two successful provider families, including at least one non-OpenAI family. One external opinion or an OpenAI-only result is a partial review, not a panel ruling. The convener does not count toward quorum.

## 5. Synthesize and resolve material splits

Read every successful reply and distinguish:

- **Convergence:** the same concern raised by two or more seats.
- **Splits:** conflicting verdicts or explicitly contradictory S1 claims.
- **Gaps:** single-seat findings, judged on evidence rather than vote count.
- **Ruling:** the convener's evidence-backed decision. Attribute adopted points. For every overruled objection, give `[seat] objection — reason`.

If any REJECT conflicts with APPROVE/APPROVE_WITH_CHANGES, or S1 claims directly contradict, run at most one second round, only among successful, unbenched round-one seats. With fewer than two remaining, report the unresolved split.

For each seat, build a round-two packet containing: original packet without its reply-format block; that seat's own first reply; only TOP_RISKS and DISAGREEMENTS from the other seats under anonymous `OTHER SEAT 1`, etc. labels and fenced as evidence; a request to revise/restate and explain which points changed its mind; then the unchanged reply-format block last. Reuse the same CLI controls and model pins, with that seat's new packet and a separate output directory. Never resume old sessions. Apply the same collection/bench rules. Preserve round-one evidence when round two fails and explicitly distinguish final replies from unchanged first-round replies; do not imply a failed seat endorsed the synthesis.

## 6. Report

Write `RUN/report.md` and give the user the outcome first, with:

- Ruling and verdict tally, successful provider count, and unavailable/benched seats.
- Where seats split, with `[codex]`, `[gemini]`, `[grok]`, `[claude]` attribution.
- Adopted findings and overruled objections with reasons.
- Single-seat gaps and unresolved evidence limits.
- Invoking model, requested reviewer models/efforts, evidence of actual models if available, and the artifact directory.

State a pre-work ruling before continuing any separately authorized implementation. Report a completion panel before claiming completion; a panel vote cannot replace missing test, runtime, or acceptance evidence. Do not recursively convene panels to review panel mechanics or run another panel on already-reviewed unchanged work.
