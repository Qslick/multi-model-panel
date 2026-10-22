# The run directory contract

Every panel run writes into its own directory, `$RUN`. The skill owns these names, and the `panel-view` mod reads them, so a rename in one breaks the other. Change the two together. The authoritative text is in [`claude/skills/multi-model-panel/SKILL.md`](../claude/skills/multi-model-panel/SKILL.md) §0 to §4.

## Where `$RUN` lives

- `<scratchpad>/panel-<short-slug>` when the session has a scratchpad directory.
- Otherwise `${TMPDIR:-/tmp}/panel-runs/<YYYYMMDD-HHMMSS>`.
- Each iteration loop gets its own directory with a `-loopN` suffix, so a later loop never overwrites an earlier report.

## Files

| File | Written by | When |
|---|---|---|
| `packet.md` | convener | before dispatch; identical bytes for every seat |
| `meta.json` | convener | before dispatch |
| `codex.md`, `codex.stderr` | Codex seat | during dispatch |
| `gemini.md`, `gemini.stderr` | Gemini seat (agy) | during dispatch |
| `grok.ndjson`, `grok.md`, `grok.stderr` | Grok seat | during dispatch; `grok.md` is extracted from the stream with `jq` |
| `claude.md` | convener | when the Claude agent's reply arrives (the agent has no Write tool) |
| `round2-<seat>.md` | convener | only when round 2 runs |
| `ruling.json` | convener | after synthesis; rewritten with `"round": 2` if round 2 runs |
| `report.md` | convener | at the end |

## `meta.json`

```json
{
  "decision": "<slug shared by every loop of this item>",
  "title": "<the item in one line>",
  "mode": "decide|plan|completion",
  "loop": 1,
  "seats": { "codex": "<model / effort>", "gemini": "<model>", "grok": "<model / effort>", "claude": "<agent>" },
  "benched": ["<seats benched before dispatch>"]
}
```

## `ruling.json`

```json
{
  "round": 1,
  "outcome": "proceed|proceed_with_changes|stop|need_info",
  "summary": "<the ruling in one line>",
  "points": [
    {
      "id": "p1",
      "text": "<the point>",
      "seats": ["codex", "grok"],
      "bucket": "converge|split|gap",
      "severity": "S1|S2|S3",
      "ruling": "accept|accept_with_revision|overrule|out_of_scope|deferred",
      "reason": "<required for overrule and accept_with_revision>",
      "verified": true
    }
  ]
}
```

`verified` is `true` when the convener checked the claim against its source and it held, `false` when it did not hold, and absent when it was not checked.

## How the mod finds a run

- **Dispatch.** A Bash command that reads `multi-model-panel/roster.json` and sets `RUN=`. Seats are picked out by `codex exec`, `agy -p`, `grok/bin/grok` or `--prompt-file` in that command.
- **Claude seat.** An Agent call whose description starts with `Panel seat`.
- **Round 2.** A dispatch command that mentions `round2-`.
- **Loops.** The directory name: `panel-<slug>-loopN`.
- **Settling.** A reply file is read once it has stopped changing for 4 seconds, or 30 seconds while it still lacks its closing `MODEL_SELF_REPORT` line. A run is watched for up to an hour.

## Seat reply grammar

Every seat answers in plain text with these labels at column 0, in order. The full block is in [`packet-template.md`](../claude/skills/multi-model-panel/references/packet-template.md).

```
VERDICT: APPROVE | APPROVE_WITH_CHANGES | REJECT | NEED_INFO
CONFIDENCE:
TOP_RISKS:            (each tagged S1, S2 or S3, at most 5)
DISAGREEMENTS:
GAPS:
WOULD_CHANGE_MY_MIND:
MODEL_SELF_REPORT:
```
