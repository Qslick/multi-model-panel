---
name: multi-model-panel
description: "DEFAULT cross-model check. Convenes four seats from four model families — OpenAI Codex, Google Gemini via agy, xAI Grok via the grok CLI, and a fresh-context Claude on a different model than the convener — gives all of them one identical context packet, gets independent structured verdicts in parallel, and synthesizes convergence, splits, gaps, and a ruling with seat attribution. A seat whose provider is out of usage is benched for the rest of the session and the panel runs without it. MUST propose (one line) or run unprompted BEFORE architectural, multi-file, security- or data-sensitive, irreversible, or otherwise expensive-to-get-wrong work (auth, schema/migrations, concurrency, payments, public API shape, greenfield architecture, deletes, deploys) and AFTER completing such work as a completion check. Skip silently for single-file mechanical edits, config/typo tweaks, and already-verified work. Also on '/panel', '/multi-model-panel', 'convene the panel', 'panel this', 'cross-model check', 'have the other models check this'. Iterates on request: re-runs on the amended item until the seats converge ('rerun the panel until it converges', 'loop the panel on the changes'). NOT for iterating a PLAN.md with one Codex critic (/codex-review) and NOT when requirements still need an interview (/claudex-loop). Seats are read-only; never writes code."
argument-hint: "<decision, plan, diff or git ref, or 'completion check'>"
allowed-tools: Read, Write, Bash, Glob, Grep, Agent
---

# Multi-Model Panel

One question, four model families, one identical packet, independent answers, then a ruling. You (the convener) keep the final say because you hold the conversation context — but you ask the panel to check the work; you do not self-certify.

`$ARGUMENTS` is the thing under review: a decision, a plan (text or `PLAN.md` path), a diff or git ref, or the phrase "completion check" for work you just finished. If empty, ask what to put before the panel and stop.

## 0. Roster, bench, and run dir

1. Read [roster.json](./roster.json). It is the only place the Gemini and Grok model ids, the Codex and Grok efforts, and the Claude agent names live; bump them there, never in this file. The §2 command reads them with `jq` at run time, so there is nothing to substitute by hand.
2. Codex model: read `model` from `~/.codex/config.toml` (absent = "CLI default"). **Never pass `-m`.** Codex effort comes from roster.json `codex.effort` and is passed as `-c model_reasoning_effort=…`, which overrides config.toml for this run only.
3. Grok model: run `~/.grok/bin/grok models`. If it lists a higher grok version than roster.json's `grok.model` (ignoring `-build`/`-fast` variants), bump roster.json (model + `verified` date). If roster's model is no longer listed, stop and tell the user. Effort is roster.json `grok.effort`.
4. Claude seat: if your own system prompt says you are running on Fable, use `agent_if_convener_is_fable`; otherwise `agent_otherwise`. The Claude seat is never the convener's own model.
5. **Bench.** `BENCH="${TMPDIR:-/tmp}/panel-bench-${CLAUDE_CODE_SESSION_ID}.txt"` — one file per Claude Code session. Run `cat "$BENCH" 2>/dev/null`. Every seat listed there ran out of usage earlier in this session (§3): do not dispatch it and do not retry it. Also treat as benched any seat this conversation already recorded as `BENCHED`, even if the file is gone or `CLAUDE_CODE_SESSION_ID` is empty. If benching leaves no seat outside the Anthropic family, stop and tell the user a cross-model panel cannot convene this session; never present a Claude-only answer as a panel ruling.
6. Echo the resolved roster, one line per seat, before dispatch, e.g.
   ```
   codex   gpt-6-sol / high                        (config.toml model, roster effort)
   gemini  BENCHED — out of usage since 14:02      (panel-bench file)
   grok    grok-4.7 / medium                       (roster.json, grok models)
   claude  panel-claude-opus = opus / xhigh        (convener is Fable)
   ```
7. `RUN` = `<scratchpad>/panel-<short-slug>` if your system prompt lists a scratchpad directory, else `${TMPDIR:-/tmp}/panel-runs/<YYYYMMDD-HHMMSS>`. Give every panel run, and every §7 loop, its own directory (`…-loop2`), so a later run never overwrites an earlier report. `PROJECT` = absolute repo root (or cwd), unless step 8 pins a checkout. Shell state does not persist between Bash calls: every Bash command sets `RUN`, `PROJECT`, and `BENCH` itself.
8. **Pin what the seats read.** When the item depends on a repository:
   - `git fetch` first, and note what has changed since the item was written. A seat reading moved code reviews the wrong thing.
   - If the working tree is dirty, behind, or on a different ref from the one the item targets, point `PROJECT` at a clean detached checkout of that exact commit (`git worktree add --detach <scratchpad path> <ref>`), not the working copy.
   - Copy in any untracked files the packet tells seats to read (gitignored plans, local-only docs).
   - Name the commit in the packet.
   - Remove the checkout (`git worktree remove --force`) when the panel is done.

   Skip this step when the item stands alone: an idea, a decision, or text with no code behind it.
9. **Gemini read grant.** Unless the Gemini seat is benched, check the read allow rules exist: `jq -e '[.permissions.allow[]? | select(startswith("read_file("))] | length > 0' ~/.gemini/antigravity-cli/settings.json`. If it prints `false` or fails, restore them with `jq` (keep every other key, e.g. `trustedWorkspaces`): `"permissions": {"allow": ["read_file(/private/tmp/claude-501)", "read_file(/tmp/claude-501)", "read_file(/Users/quinnbreedlove/Development)"]}`, and tell the user you did. Read rules only, never `command(...)` or `write_file(...)` (see gotchas). Any path the packet lists outside those prefixes, `$PROJECT` and `$RUN` needs its own `--add-dir` in §2.

## 1. Build the packet

Write `$RUN/packet.md` from [references/packet-template.md](./references/packet-template.md). Fill every slot:

- **QUESTION** — one paragraph, the exact decision, plan, or claim of completion.
- **MODE** — `decide`, `plan`, or `completion`. The template defines what APPROVE means in each.
- **CONTEXT** — inline the material: the plan text, `git diff` output, or file excerpts. Inline rather than point, so every seat reasons over the same bytes. List any extra paths a seat may read; the read grant is supplementary.
- **CONSTRAINTS** and **WHAT GOOD LOOKS LIKE** — the rules the answer must respect and the bar it is judged against.

Do not edit the preamble or the REQUIRED REPLY FORMAT block. The rule granting **reads only and no shell commands** is the load-bearing one for the Gemini seat — restoring a shell grant there kills that seat outright (see gotchas). Seats never see each other's answers in round 1.

**Record the run.** Also write `$RUN/meta.json`, before dispatch:

```json
{ "decision": "<slug shared by every loop of this item>", "title": "<the item in one line>", "mode": "decide|plan|completion",
  "loop": 1, "seats": { "codex": "<model / effort>", "gemini": "<model>", "grok": "<model / effort>", "claude": "<agent>" },
  "benched": ["<seats benched in §0 step 5>"] }
```

The panel-view mod reads it to label and group runs (see §4 *Write the ruling*). Without the mod it is still the run's record.

## 2. Dispatch every available seat in ONE message

Two tool calls in the same assistant message: one Bash call that runs the Codex, Gemini, and Grok seats concurrently, plus one `Agent` call for the Claude seat. **Leave out the subshell (and the `wc` path) of every benched seat**; if the Claude seat is benched, send the Bash call alone.

**Bash call** (`timeout: 600000`):

```bash
RUN=/abs/path/to/run; PROJECT=/abs/path/to/repo; mkdir -p "$RUN"
ROSTER=~/.claude/skills/multi-model-panel/roster.json
CODEX_EFFORT=$(jq -r .codex.effort "$ROSTER"); GEMINI_MODEL=$(jq -r .gemini.model "$ROSTER")
GROK_MODEL=$(jq -r .grok.model "$ROSTER"); GROK_EFFORT=$(jq -r .grok.effort "$ROSTER")
# Codex lockdown: -s read-only covers Codex's own shell, not plugins, apps or MCP servers (see gotchas).
CODEX_LOCK=(--disable plugins --disable apps --disable browser_use --disable computer_use --disable image_generation --disable memories)
CODEX_MCP=$(codex "${CODEX_LOCK[@]}" mcp list --json | jq -r '.[] | select(.enabled) | .name') || CODEX_MCP=LOCK_FAILED
while IFS= read -r s; do [ -n "$s" ] && [ "$s" != LOCK_FAILED ] && CODEX_LOCK+=(-c "mcp_servers.$s.enabled=false"); done <<< "$CODEX_MCP"
CODEX_LEFT=$(codex "${CODEX_LOCK[@]}" mcp list --json 2>/dev/null | jq -r '.[] | select(.enabled) | .name' | tr '\n' ' ')
[ "$CODEX_MCP" = LOCK_FAILED ] || [ -n "$CODEX_LEFT" ] && CODEX_SKIP="MCP lockdown failed (still enabled: ${CODEX_LEFT:-unknown})"
CODEX_NOTE='Panel seat note (Codex only; this overrides, for you, the packet rule against running shell or terminal commands): your shell runs in a read-only sandbox and is your only way to read files, so for you a read-only shell command IS reading, which the packet allows. Before you answer, open every file the packet lists under paths you may read, plus any file whose inlined excerpt you rely on, with read-only commands such as cat, sed -n, rg, ls, find, wc, git show, git log or git diff. Do not say a file was not included or could not be inspected unless such a command failed on it. Never write, create, delete or move anything.'
echo "start $(date +%T)"
if [ -n "$CODEX_SKIP" ]; then echo "codex SKIPPED: $CODEX_SKIP" > "$RUN/codex.stderr"; echo "codex SKIPPED: $CODEX_SKIP"; else
( perl -e 'alarm 570; exec @ARGV' codex exec -s read-only --skip-git-repo-check --ephemeral \
    -c model_reasoning_effort="$CODEX_EFFORT" "${CODEX_LOCK[@]}" -c "developer_instructions=\"$CODEX_NOTE\"" \
    -C "$PROJECT" -o "$RUN/codex.md" - < "$RUN/packet.md" > /dev/null 2> "$RUN/codex.stderr"
  echo "codex exit $? $(date +%T)" ) & fi
( ~/.local/bin/agy -p "$(cat "$RUN/packet.md")" --model "$GEMINI_MODEL" \
    --disable-slash-commands --print-timeout 8m --add-dir "$PROJECT" --add-dir "$RUN" \
    < /dev/null > "$RUN/gemini.md" 2> "$RUN/gemini.stderr"
  echo "gemini exit $? $(date +%T)" ) &
( GROK_MEMORY=0 perl -e 'alarm 570; exec @ARGV' ~/.grok/bin/grok \
    --prompt-file "$RUN/packet.md" --verbatim -m "$GROK_MODEL" --reasoning-effort "$GROK_EFFORT" \
    --cwd "$PROJECT" --output-format streaming-messages-json \
    --tools read_file,grep,list_dir --disallowed-tools search_tool,use_tool,Agent --deny MCPTool \
    --disable-web-search --no-subagents \
    < /dev/null > "$RUN/grok.ndjson" 2> "$RUN/grok.stderr"
  echo "grok exit $? $(date +%T)"
  jq -r -R 'fromjson? | select(.type=="result") | .result // empty' "$RUN/grok.ndjson" > "$RUN/grok.md"
  jq -c -R 'fromjson? | select(.type=="error" or .is_error==true)' "$RUN/grok.ndjson" >> "$RUN/grok.stderr" ) &
wait
echo "end $(date +%T)"
wc -c "$RUN"/codex.md "$RUN"/gemini.md "$RUN"/grok.md
```

Model ids and efforts come from roster.json via `jq`; never hardcode them here (a hardcoded `grok-4.6` once outlived a roster bump to 4.7). The `date` lines prove the seats overlapped.

**Agent call**, in the same message: `subagent_type` = the Claude agent from step 0, `prompt` = the packet verbatim, `description` "Panel seat: Claude". The agent has no Write tool; when its reply arrives, save it to `$RUN/claude.md` yourself.
- The Claude seat's working directory is yours, not `PROJECT`. When step 8 pinned a checkout, the prompt must say the packet's paths resolve against that absolute path, and that the seat reads code only from it.
- For a large packet, the prompt may instead tell the seat to Read `$RUN/packet.md` in full before answering. The seat gets the same bytes either way.

Agent definitions load at session start. If the call errors with "Agent type not found" (the definition was created or edited during this session), fall back to `subagent_type: general-purpose` with `model: opus` (or `fable` when the convener is not Fable) and say in the report that the seat ran at session-default effort.

## 3. Collect

A seat succeeded when its file is non-empty and contains a line matching `^VERDICT:` after stripping leading `*`, `#`, or backticks. Stamp `MODEL_RAN` for each seat from the invocation (config.toml model + roster effort for Codex, the resolved `$GEMINI_MODEL`/`$GROK_MODEL`, the agent's frontmatter model) — the seat's own `MODEL_SELF_REPORT` line is only a sanity check.

Apply these in order to every seat that did not succeed:

1. **Out of usage → bench the provider for the rest of the session.** Check the seat's error text first:
   ```bash
   tail -n 20 "$RUN/<seat>.stderr" | grep -i -E 'usage limit|limit reached|hit your limit|quota|rate.?limit|too many requests|resource.?exhausted|insufficient (credits|balance|quota)|out of credits|credit balance'
   ```
   (for the Claude seat, read the Agent tool's error text instead). A match on an actual error line — not on packet text a CLI echoed to stderr — means that provider is out of usage. Append `<seat> $(date +%H:%M) <the error line>` to `$BENCH`, record `BENCHED: out of usage — <error line>`, and move on. Do not retry, and do not dispatch that seat again this session: not in round 2, not in any later panel run. Then re-check the quorum rule in §0 step 5.
2. Empty stdout **with** `no output produced` / `auto-denied` in that seat's stderr: a permission denial, which is deterministic. Do not retry — it burns another full timeout for the same result. Record `UNAVAILABLE: permission auto-denied — <stderr tail>` at once and fix the packet, not the retry count.
3. Otherwise empty or malformed reply: retry that seat once (same packet).
4. Still empty: record `UNAVAILABLE: <stderr tail>` for that seat.

Report unavailable and benched seats as such. Never substitute your own answer for a seat and never drop it from the report.

**Did each seat look?** A seat granted reads may still answer from the packet alone. When the question turns on files, check for evidence of reads:

| Seat | Signal |
| --- | --- |
| Codex | `exec` lines in `codex.stderr`. Any `mcp:` line means the lockdown leaked: report it. |
| Grok | `"type":"user"` tool-result messages in `grok.ndjson` |
| Claude | the tool-use count in the Agent result |
| Gemini | No log signal. Judge by whether its citations are specific and correct. |

A seat with no reads is **packet-only**. Say so in the report, and treat its claims about the files as unverified, not as checked.

## 4. Synthesize

Read every reply, then bucket every point:

- **Converge** — raised by two or more seats. Strongest signal; act on it unless you can name why the conversation context makes it wrong.
- **Split** — verdicts that conflict, or S1 risks one seat raises that another explicitly rejects.
- **Gaps** — raised by exactly one seat. This is the panel's whole value: different weights catch different blind spots. Weigh each on its merits, not on its vote count.
- **Ruling** — your decision. For every objection you overrule, one line: `[seat] objection — reason`. For every point you act on, tag the seat that raised it.

**Verify before you rule.** Before acting on or overruling a factual claim, check it against its source yourself: a file:line, a behaviour, a figure, a quote. Agreement between seats raises priority, not truth; seats converge on the same misreading too. Overrule only with evidence you can cite. Record which claims you checked and which did not hold.

**Keep scope clean.** Some findings are real but sit outside the item: a pre-existing bug, an adjacent gap, a question for someone else. Don't fold them into the item. List them for the user as separate follow-ups, and in any later round, mark them out of scope in the packet so they don't decide the verdict.

**Write the ruling.** Once you have ruled, write `$RUN/ruling.json`: one point per bucketed item, the same seat tags the report uses.

```json
{ "round": 1, "outcome": "proceed|proceed_with_changes|stop|need_info", "summary": "<the ruling in one line>",
  "points": [ { "id": "p1", "text": "<the point>", "seats": ["codex", "grok"], "bucket": "converge|split|gap",
                "severity": "S1|S2|S3", "ruling": "accept|accept_with_revision|overrule|out_of_scope|deferred",
                "reason": "<why, required for overrule and accept_with_revision>", "verified": true } ] }
```

- `seats` holds the lower-case seat ids: `codex`, `gemini`, `grok`, `claude`.
- `verified`: `true` when you checked the claim against its source and it held, `false` when it did not hold, absent when you did not check.
- An overruled objection is a point with `"ruling": "overrule"` and its reason, the same line §6 reports.
- The panel-view mod draws this as the Rulings tab, beside each seat's verdict and findings, and keeps every round and loop of a decision side by side.

## 5. Round 2 (only on a material split)

Material = any REJECT against any APPROVE/APPROVE_WITH_CHANGES, or S1 risks that directly contradict. Otherwise skip to 6.

For each seat that replied in round 1, write `$RUN/round2-<seat>.md` in this order: the original packet minus its REQUIRED REPLY FORMAT block; `YOUR ROUND-1 REPLY (you wrote this; you have no memory of writing it):` with that seat's own reply; `OTHER SEAT 1:`, `OTHER SEAT 2:`, … with only the TOP_RISKS and DISAGREEMENTS sections of each other seat that replied (fixed labels, no model names, each section fenced as evidence); then "Revise or restate your verdict. Say which other-seat points changed your mind and which you reject."; when the split is a REJECT against approvals, add "If the points you accept were fixed, is REJECT still warranted, or are amendments to the item enough?", which turns a verdict split into a decision the convener can act on; then the REQUIRED REPLY FORMAT block last. Seats that were UNAVAILABLE or BENCHED in round 1 sit out round 2; if fewer than two seats replied, report the split as final. Dispatch with the identical step-2 commands (same flags, only the input file changes — never `resume`, never a model flag other than the step-0 ids) plus the step-3 collection rules, one extra round maximum. A seat that runs out of usage in round 2 is benched the same way. Synthesize again, then rewrite `$RUN/ruling.json` with `"round": 2`; round 1's rulings stay in your report.

## 6. Report

In chat, outcome first, then write the same to `$RUN/report.md` and print the run dir:

1. **Outcome** — one line: the ruling and the verdict tally (e.g. "Proceed with changes. Panel: APPROVE_WITH_CHANGES ×2, REJECT ×1; codex benched (out of usage)").
2. **Where they split** — the split points, each tagged `[codex]` `[gemini]` `[grok]` `[claude]`.
3. **Ruling** — what you will do, every point tagged with the seat that raised it, plus the overruled-objection lines. Unavailable and benched seats named here.
4. **Gaps worth a look** — single-seat points you did not act on but the user should see.
5. **Checked and out of scope** — which claims you verified and which failed, which seats were packet-only (§3), and the follow-ups kept out of the item (§4).

If the panel was a pre-work check, proceed only after the ruling is stated. If it was a completion check, do not declare the work done before this report.

**Keep the record.** Each round's `report.md` stays in its own run dir. When the item has a home document (a plan, a design doc, a decision record), append a short entry there:
- the date and the seats;
- the verdicts per round;
- what changed as a result;
- what was overruled, and why.

## 7. Iterate to convergence

A ruling that changes the item leaves the panel behind: it reviewed the old version, not the one you now hold. Never call the changed item panel-reviewed. Say what the panel saw and what changed since.

When the user asks for it, or when the changes are large enough that you would not stake the work on them unreviewed (offer this in one line), loop:

1. Rerun §0–§6 on the item as it now stands, in a new run dir. Its `meta.json` keeps the same `decision` slug, with `loop` set to this loop's number. The packet's CONTEXT adds:
   - **CHANGES SINCE THE LAST REVIEW**: each change as a claim to verify against the item and its sources, not as a fact;
   - **OUT OF SCOPE**: the §4 follow-ups and any decisions pending with the user, so they don't decide the verdict.
2. Ask the seats both to check that each change fixed what it targeted without opening something new, and to review the item fresh.
3. Apply the ruling, then loop again.

**Converged** when every seat returns APPROVE, or every remaining point is S3 or was overruled with cited evidence.

**Cap: four loops** (round 2s don't count). If it hasn't converged by then, stop and bring the user the residual disagreement and your recommendation; don't keep looping.

Report each loop as in §6, with a line for the trajectory (e.g. `loop 1: REJECT ×1, AWC ×3 → loop 2: AWC ×4, S2 only → loop 3: APPROVE ×4`).

## Gotchas (all field-tested by the sibling skills)

- **Codex stdin:** `codex exec` reads stdin in addition to a prompt arg; under a non-TTY it hangs forever waiting for EOF. Always pass the prompt as `- < file`. `--ephemeral` means no session to resume, which is intended: round 2 is a fresh call.
- **Codex sandbox:** `~/.codex/config.toml` sets `sandbox_mode = "danger-full-access"` and `approval_policy = "never"` (2026-09-22); `-s read-only` is the only thing keeping the seat read-only — never drop it. `-c model_reasoning_effort=…` is fine: it is a per-run override, not a model pin. Never `-m`: pinning `gpt-5.x` variants returns HTTP 400 on ChatGPT-account auth.
- **Codex out of usage (2026-09-16):** `codex exec` exits 1 with `ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at <date>` on stderr and an empty `-o` file. That is the §3 bench signature; a retry only returns the same line.
- **Timeouts:** stock macOS has no `timeout` or `gtimeout`, and the Bash tool's timeout may background a command rather than kill it. `perl -e 'alarm N; exec @ARGV'` is the bound for Codex and Grok; `--print-timeout` for agy. Keep all of them below the Bash `timeout`.
  - **Codex outlives its alarm (2026-10-01).** Exit 142 kills the `codex` launcher, but the process doing the work keeps running and writes `codex.md` later; once it landed 84 seconds after the alarm. Before treating Codex as empty, wait a couple of minutes and check `codex.md` again.
  - **Large packets outrun 570 seconds.** A packet of about 47 KB with a code-heavy question ran Grok past the alarm mid-review (exit 142, a stream with tool results but no `result` line). That is a timeout, not a refusal. For the §3 retry, run the dispatch in the background (`run_in_background`, which the Bash `timeout` doesn't cut short) with a longer alarm, and say so in the report.
- **agy:** invoke by absolute path (`~/.local/bin` is often missing from non-interactive PATH). `--disable-slash-commands` is required: print mode expands `/codex-review`-style tokens found in the packet. Never `--mode plan` (it tries to write a plan artifact and returns nothing).
- **agy silent death (the one that bit us, 2026-09-11):** headless print mode cannot prompt for a tool permission, so a turn that attempts one is auto-denied *whole* — exit 0, zero-byte stdout, and `jetski: no output produced — a tool required the "command" permission…` on stderr. `--sandbox` does not help. Reads inside the workspace (cwd plus every `--add-dir`) need no grant; a read anywhere else needs a `read_file(<path prefix>)` rule under `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`. **2026-10-21:** that rule had vanished from settings.json (it held only `trustedWorkspaces`; agy logs show no CLI permissions since at least 2026-10-13, and the file's mtime matches an interactive agy session on 2026-10-19, so agy rewrites it), and a loop-2 seat died with the `"read_file"` variant of this error reading the loop-1 `ruling.json` in a sibling run dir. Hence §0 step 9 and `--add-dir "$RUN"`. agy has no list or grep tool (only `read_file`, `write_file`, `edit_file`, `run_command`), so `read_file` is the only read grant there is. Note too that `~/.gemini/config/config.json` `userSettings.globalPermissionGrants` (shared with the Antigravity app) carries `command(npm run)` and `command(git status)`, which agy headless also honours; `npm run` executes arbitrary package scripts. **Shell** was the original killer, invited by the packet template's old "you may run read-only commands" line. The template now grants reads only, which is also what the Claude seat can actually do (`Read, Grep, Glob`, no Bash). Do **not** try to buy shell back with `command(...)` allow-rules: agy matches them by prefix, so `git diff --output=<path>` and `git log --output=<path>` write files, `rg --pre <program>` executes an arbitrary program per matched file, and chaining past the prefix is not excluded — a panel of all three seats rejected that backstop unanimously on 2026-09-11 as a read-only-invariant break affecting every agy run on the machine. The real backstop is the §3 collection rule: a denial is reported loudly as `UNAVAILABLE`, not silently. Never add `--dangerously-skip-permissions` either: it auto-approves writes.
- **Grok read-only takes three flags, not one (verified 2026-09-16).** `--tools read_file,grep,list_dir` removes shell, edit, and write, but the MCP meta-tools `search_tool` and `use_tool` survive it, and through them the seat can call every MCP server Grok discovers (it imports Claude's MCP config: `codex`, XcodeBuildMCP `clean`, Stitch `delete_project`, Browserbase `act`). `--disallowed-tools search_tool,use_tool,Agent` removes them and `--deny MCPTool` is the backstop. With all three, the stream's `system` line reports `tools: [read_file, list_dir, grep]` and an attempted MCP call comes back unavailable. Never drop any of the three, and never add `--always-approve`/`--yolo`.
- **Grok `--sandbox read-only` refuses to start on this Mac** (`/var/run/docker.sock` is a symlink → "Refusing to start with its protections missing"). Do not add it; the tool flags above are the enforcement.
- **Grok output:** `--output-format plain` and the `json` format's `.text` both glue the model's between-tool narration onto the final answer with no newline (`…as its own step.VERDICT: APPROVE`), which breaks the `^VERDICT:` check. `streaming-messages-json` plus the `result.result` extraction in §2 yields the final message only.
- **Grok paths and stdin:** `--prompt-file` resolves relative to `--cwd`, not the shell's directory, so always pass the absolute `$RUN/packet.md`. Headless grok never reads stdin into the prompt; `< /dev/null` just keeps it from holding a pipe.
- **Grok effort and identity:** `~/.grok/config.toml` sets its own `default_reasoning_effort` (it has been `xhigh` and `low`), so `--reasoning-effort` must always be passed explicitly from roster.json. Usage records may report the model with a `-build` suffix (`grok-4.6-build` for `-m grok-4.6`); that is the same model. Grok loads the repo's `CLAUDE.md`/`AGENTS.md` as project rules, as Codex does. `GROK_MEMORY=0` keeps cross-session memory from leaking earlier panel runs into the seat. Grok has no ephemeral flag (sessions land in `~/.grok/sessions`); round 2 is still a fresh call, never `--resume`.
- **Codex lockdown (found and fixed 2026-10-01).** `-s read-only` sandboxes Codex's own shell, not its plugins, apps or MCP servers. Before the fix, Codex read files through `node_repl`, an MCP server bundled with the ChatGPT app that runs arbitrary JavaScript outside the sandbox. Clickup, Stitch and other servers were reachable the same way. The §2 command now:
  - **Disables the plugin system and app features.** `--disable plugins apps browser_use computer_use image_generation` removes plugin-supplied servers such as `cua_repl`.
  - **Disables Codex memories** (`--disable memories`, added 2026-10-19). `config.toml` turns on `[memories] use_memories`, and with it on the seat opened `~/.codex/memories/MEMORY.md` and searched it for the item under review: earlier panel runs leaking into an independent seat, the same leak `GROK_MEMORY=0` closes for Grok.
  - **Disables every MCP server still enabled, by name, at run time.** `-c mcp_servers.<name>.enabled=false`, using names from `codex mcp list --json`.
    - Only servers defined in `config.toml` can be disabled this way. Overriding a plugin-supplied server's name creates an entry with no command, and Codex refuses to start with "invalid transport". That is why plugins go off first.
    - Read the names with a `while read` loop: zsh doesn't split `$(…)` output in a `for` loop.
  - **Tells Codex alone, through `developer_instructions`, that sandboxed read-only shell commands are how it reads.** This keeps the packet identical across seats. Without it, the packet's no-shell rule leaves a locked-down Codex unable to read anything; it answered "COULD NOT READ".
    - **The note must be an order, not an explanation (2026-10-19, codex-cli 0.159.1, `gpt-6-luna` at high).** The first note only said shell reads "count as reading". Two panel runs on the panel-view mod made zero `exec` calls and answered from the inlined excerpts, saying the listed files "were not included in the evidence I could inspect". The note did reach the model (it quoted it back), and the lockdown leaves the shell intact (a bare `sed -n 1,5p` prompt under the full `CODEX_LOCK` ran and quoted the file). Replaying the same packet with the same command reproduced zero reads. The note now says it overrides the packet's no-shell rule, orders the seat to open every listed path before answering, and forbids claiming a file was missing unless a command failed on it. The replay then made 38 `exec` reads and quoted the files. If a run's `codex.stderr` shows no `exec` lines on a packet that lists paths, treat the Codex verdict as packet-only and say so.
  - **Skips the Codex seat if the lockdown can't be confirmed** (`codex mcp list` fails, or any server is still enabled). Report it as `UNAVAILABLE: MCP lockdown failed`.
  - **Verified:** reads came back correct through `rg`, an `echo x > canary.txt` write failed with "operation not permitted", and no `mcp:` lines appeared in stderr.
  - **After a Codex upgrade,** re-check that the feature names still exist. An unknown `--disable` name fails the seat closed, not open.
- **Codex under the reads-only packet:** verified 2026-09-11 — Codex still reads listed paths off disk and quotes on-disk values correctly under `-s read-only`. What it loses is broader shell verification (`tsc --noEmit`, `cargo check`, cross-branch `git log`), not file access. If a packet's question turns on that kind of dynamic check, inline the command's output in CONTEXT rather than asking a seat to run it.
- **Agent frontmatter:** `tools:` is the key (not `allowed-tools:`), `effort:` is the only place a subagent's effort can be set.
- **panel-view mod (`~/.claude/mods/panel-view`, 2026-10-19).** It finds a run by this skill's §2 Bash command (the `roster.json` read and `RUN=`), so keep both in that command. It also finds the Claude seat by its Agent `description` starting `Panel seat`, and round 2 by the `round2-` input files. It reads the seat files (`claude.md` included: a background Agent call returns no reply, so the pane waits for the copy you save), `meta.json` and `ruling.json` from `$RUN`. Changing any of these names breaks the pane, not the panel. `meta.json`'s `benched` lists only §0's benching; a seat benched mid-run shows from its stderr. When a seat fails because its CLI needs signing in again, the pane offers a sign-in button (`codex login`, `grok login --oauth`, or a Terminal window running `agy` that closes once the token updates), then a Retry button that asks you to rerun that seat under §3 (any failed seat gets Retry). It reads a reply file only once it has stopped changing for 4 seconds, or 30 seconds when the reply still lacks its closing `MODEL_SELF_REPORT` line. It keeps reading a failed or late seat's file, so a reply landing late still shows. It watches a run dir for up to an hour, and polls `ruling.json` until one arrives however it is written.
- **Structured output escape hatch:** `codex exec --output-schema`, `agy --json-schema`, and `grok --json-schema` exist if the plain-text grammar ever proves flaky. Not built; the grammar has held.

## Routing (written once, in `~/.claude/CLAUDE.md`)

This skill is the default cross-model check. `/codex-review` is only for iterating a `PLAN.md` to Codex APPROVED with a single critic; `/claudex-loop` only when requirements need an interview first; `/codex-build` is the unsandboxed builder and is never proposed proactively; `antigravity-cli` is the single-Gemini offload when the user names Gemini or agy.
