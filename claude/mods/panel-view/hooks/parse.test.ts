import { describe, expect, test } from 'claude-code/testing'

import { detectDispatch, metrics, parseReply, parseRuling, runIdentity, stderrVerdict } from './parse'
import type { Seat } from '../types'

const REPLY = `VERDICT: APPROVE_WITH_CHANGES
CONFIDENCE: medium
TOP_RISKS:
- [S1] The poll reads files the sandbox may refuse.
- [S3] Colors are fixed hex.
DISAGREEMENTS:
- none
GAPS:
- No test for round 2.
WOULD_CHANGE_MY_MIND:
- A live run showing reads.
MODEL_SELF_REPORT: gpt-6-sol`

// SKILL.md §2, the parts detection depends on.
const DISPATCH = `RUN=/tmp/scratch/panel-mod-design; PROJECT=/Users/q/repo; mkdir -p "$RUN"
ROSTER=~/.claude/skills/multi-model-panel/roster.json
( perl -e 'alarm 570; exec @ARGV' codex exec -s read-only --skip-git-repo-check --ephemeral \\
    -C "$PROJECT" -o "$RUN/codex.md" - < "$RUN/packet.md" > /dev/null 2> "$RUN/codex.stderr"
  echo "codex exit $? $(date +%T)" ) &
( ~/.local/bin/agy -p "$(cat "$RUN/packet.md")" --model "$GEMINI_MODEL" \\
    < /dev/null > "$RUN/gemini.md" 2> "$RUN/gemini.stderr" ) &
( GROK_MEMORY=0 perl -e 'alarm 570; exec @ARGV' ~/.grok/bin/grok \\
    --prompt-file "$RUN/packet.md" --verbatim -m "$GROK_MODEL" ) &
wait`

describe('parseReply', () => {
  test('reads every section of the reply format', async () => {
    const r = parseReply(REPLY)!
    expect(r.verdict).toBe('APPROVE_WITH_CHANGES')
    expect(r.confidence).toBe('medium')
    expect(r.risks).toEqual([{ severity: 'S1', text: 'The poll reads files the sandbox may refuse.' }, { severity: 'S3', text: 'Colors are fixed hex.' }])
    expect(r.disagreements).toEqual([])
    expect(r.gaps).toEqual(['No test for round 2.'])
    expect(r.selfReport).toBe('gpt-6-sol')
  })

  test('tolerates markdown emphasis and Grok gluing narration onto the verdict', async () => {
    expect(parseReply('**VERDICT: REJECT**\nCONFIDENCE: high')?.verdict).toBe('REJECT')
    expect(parseReply('…as its own step.VERDICT: APPROVE\nCONFIDENCE: low')?.verdict).toBe('APPROVE')
  })

  test('no VERDICT line is no reply', async () => {
    expect(parseReply('I could not read the files.')).toBeUndefined()
  })
})

describe('dispatch and identity', () => {
  test('detects the §2 command, its run dir and its seats', async () => {
    expect(detectDispatch(DISPATCH)).toEqual({ run: '/tmp/scratch/panel-mod-design', seats: ['codex', 'gemini', 'grok'], round: 1, limitMs: 600_000 })
  })

  test('a benched seat left out, and round 2 by its input files', async () => {
    const r2 = DISPATCH.replace(/\( ~\/\.local\/bin\/agy[\s\S]*?\) &\n/, '').replace(/packet\.md/g, 'round2-codex.md')
    expect(detectDispatch(r2)).toMatchObject({ seats: ['codex', 'grok'], round: 2 })
  })

  test('other Bash commands, and a roster read that starts no seat, are not a dispatch', async () => {
    expect(detectDispatch('ls -la')).toBeUndefined()
    expect(detectDispatch('RUN=/tmp/x; mkdir -p "$RUN"; jq . ~/.claude/skills/multi-model-panel/roster.json')).toBeUndefined()
  })

  test('a longer alarm on a retry raises the limit', async () => {
    expect(detectDispatch(DISPATCH.replace(/alarm 570/g, 'alarm 1200'))?.limitMs).toBe(1_200_000)
  })

  test('loops share a decision', async () => {
    expect(runIdentity('/tmp/x/panel-auth-flow')).toEqual({ decision: 'auth-flow', loop: 1 })
    expect(runIdentity('/tmp/x/panel-auth-flow-loop3')).toEqual({ decision: 'auth-flow', loop: 3 })
  })

  test('stderr: out of usage benches, an auto-deny is unavailable', async () => {
    expect(stderrVerdict("ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage")?.status).toBe('benched')
    expect(stderrVerdict('jetski: no output produced — a tool required the "command" permission')?.status).toBe('unavailable')
    expect(stderrVerdict('codex exit 0 12:00:01')).toBeUndefined()
    // A read that quotes the signature is not one.
    expect(stderrVerdict(`exec bash -lc 'rg -i "usage limit|quota" SKILL.md'`)).toBeUndefined()
  })
})

describe('metrics and rulings', () => {
  const seat = (name: Seat['name'], verdict?: 'APPROVE' | 'APPROVE_WITH_CHANGES' | 'REJECT'): Seat => ({
    name, status: 'done', reads: 0, reply: verdict ? { verdict, risks: [{ severity: 'S2', text: 'x' }], disagreements: [], gaps: [], wouldChange: [], raw: '' } : undefined,
  })

  test('a REJECT against approvals is a material split', async () => {
    const m = metrics([seat('codex', 'REJECT'), seat('gemini', 'APPROVE_WITH_CHANGES'), seat('grok', 'APPROVE_WITH_CHANGES'), seat('claude')])
    expect(m).toMatchObject({ replied: 3, isSplit: true, tally: { REJECT: 1, APPROVE_WITH_CHANGES: 2 } })
    expect(m.consensus).toBe(2 / 3)
    expect(m.severities.S2).toBe(3)
  })

  test('ruling.json keeps valid points and drops the rest', async () => {
    const r = parseRuling(JSON.stringify({
      round: 2, outcome: 'proceed_with_changes',
      points: [
        { id: 'p1', text: 'Add a fallback', seats: ['codex', 'grok'], bucket: 'converge', severity: 'S1', ruling: 'accept' },
        { text: 'Rewrite it', seats: ['gemini'], ruling: 'overrule', reason: 'out of budget' },
        { text: 'bad', ruling: 'maybe' },
      ],
    }))!
    expect(r.round).toBe(2)
    expect(r.points.map(p => p.ruling)).toEqual(['accept', 'overrule'])
    expect(r.points[1]!.id).toBe('p2')
  })
})
