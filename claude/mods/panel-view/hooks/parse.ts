import type { Decision, Risk, Round, Ruling, RulingPoint, Seat, SeatName, SeatReply, Severity, Verdict } from '../types'

export const SEATS: readonly SeatName[] = ['codex', 'gemini', 'grok', 'claude']
export const RAW_CAP = 20_000

const VERDICTS: readonly Verdict[] = ['APPROVE_WITH_CHANGES', 'APPROVE', 'REJECT', 'NEED_INFO']
const SECTIONS = ['TOP_RISKS', 'DISAGREEMENTS', 'GAPS', 'WOULD_CHANGE_MY_MIND'] as const

/** One line as §3 reads it: leading `*`, `#`, backticks and spaces stripped. */
const clean = (line: string) => line.replace(/^[\s*#`>]+/, '').replace(/[*`]+$/, '').trim()

/** Parses a seat's reply in the packet template's REQUIRED REPLY FORMAT. Undefined without a VERDICT line. */
export function parseReply(text: string): SeatReply | undefined {
  const lines = text.split(/\r?\n/).map(clean)
  // Grok can glue narration onto the label: find VERDICT anywhere on its line.
  const vi = lines.findIndex(l => /\bVERDICT:/.test(l))
  if (vi < 0) return undefined
  const after = (label: string) => {
    const l = lines.find(x => x.startsWith(`${label}:`))
    return l?.slice(label.length + 1).trim()
  }
  const vLine = lines[vi]!.slice(lines[vi]!.indexOf('VERDICT:') + 8).trim().toUpperCase()
  const verdict = VERDICTS.find(v => vLine.startsWith(v))
  const conf = after('CONFIDENCE')?.toLowerCase()
  const lists: Record<(typeof SECTIONS)[number], string[]> = { TOP_RISKS: [], DISAGREEMENTS: [], GAPS: [], WOULD_CHANGE_MY_MIND: [] }
  let cur: (typeof SECTIONS)[number] | undefined
  for (const l of lines.slice(vi + 1)) {
    const head = SECTIONS.find(s => l.startsWith(`${s}:`))
    if (head) {
      cur = head
      const rest = l.slice(head.length + 1).trim()
      if (rest) lists[head].push(rest.replace(/^-\s*/, ''))
      continue
    }
    if (/^(MODEL_SELF_REPORT|CONFIDENCE|VERDICT):/.test(l)) { cur = undefined; continue }
    if (cur && l.startsWith('-')) lists[cur].push(l.replace(/^-\s*/, ''))
    else if (cur && l && lists[cur].length > 0) lists[cur][lists[cur].length - 1] += ` ${l}`
  }
  const real = (xs: string[]) => xs.filter(x => x && !/^none\.?$/i.test(x))
  const risks: Risk[] = real(lists.TOP_RISKS).map(x => {
    const m = /^\[?(S[123])\]?[\s:—-]*(.*)$/.exec(x)
    return m ? { severity: m[1] as Severity, text: m[2]!.trim() } : { text: x }
  })
  return {
    verdict,
    confidence: conf === 'high' || conf === 'medium' || conf === 'low' ? conf : undefined,
    risks,
    disagreements: real(lists.DISAGREEMENTS),
    gaps: real(lists.GAPS),
    wouldChange: real(lists.WOULD_CHANGE_MY_MIND),
    selfReport: after('MODEL_SELF_REPORT'),
    raw: text.length > RAW_CAP ? `${text.slice(0, RAW_CAP)}\n… (cut)` : text,
  }
}

/** §3's out-of-usage signature, on a seat's stderr tail. */
export const BENCH_RE = /usage limit|limit reached|hit your limit|quota|rate.?limit|too many requests|resource.?exhausted|insufficient (credits|balance|quota)|out of credits|credit balance/i

const ERROR_LINE = /^\s*(ERROR|Error|error|fatal|FATAL)\b|jetski:|SKIPPED:|"type":"error"|"is_error":true/

/** A CLI that needs signing in again: agy's, Codex's and Grok's own wording, and the HTTP forms. */
export const AUTH_RE = /not (logged|signed) in|not logged into|please (log|sign) ?in|log back in|\(\/login\)|unauthenticated|unauthori[sz]ed|\b401\b|login required|(authentication|auth) (failed|required|expired|error)|invalid[_ ](token|grant|credentials)|token (has )?expired|refresh token|keyring|re-?authenticate/i

export function stderrVerdict(stderr: string, seat?: SeatName): { status: 'benched' | 'unavailable'; note: string; fix?: 'signin' } | undefined {
  // Sign-in first. agy says so without an error prefix; Codex echoes the packet, its reads and its own
  // reply into stderr, so for Codex only an error line counts.
  const auth = stderr.split(/\r?\n/).filter(Boolean).slice(-20)
    .find(l => AUTH_RE.test(l) && !/^\s*exec\b/.test(l) && (seat !== 'codex' || ERROR_LINE.test(l)))
  if (auth) return { status: 'unavailable', note: `needs signing in: ${auth.trim().slice(0, 160)}`, fix: 'signin' }
  // Only lines a CLI writes as errors: a Codex `exec` line quoting "usage limit" is a read, not a signature.
  const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-20).filter(l => ERROR_LINE.test(l))
  const bench = tail.find(l => BENCH_RE.test(l))
  if (bench) return { status: 'benched', note: bench.trim().slice(0, 200) }
  const denied = tail.find(l => /no output produced|auto-denied/i.test(l))
  if (denied) return { status: 'unavailable', note: denied.trim().slice(0, 200) }
  const skipped = tail.find(l => /SKIPPED:/.test(l))
  if (skipped) return { status: 'unavailable', note: skipped.trim().slice(0, 200) }
  return undefined
}

export type Dispatch = { run: string; seats: SeatName[]; round: number; /** the longest per-seat limit in the command */ limitMs: number }

/** Recognizes the SKILL.md §2 dispatch: the roster read, a RUN, and which CLI seats it starts. */
export function detectDispatch(command: string): Dispatch | undefined {
  if (!/multi-model-panel\/roster\.json/.test(command)) return undefined
  const m = /(?:^|[\s;])RUN=("([^"]+)"|'([^']+)'|([^\s;]+))/.exec(command)
  const run = m ? (m[2] ?? m[3] ?? m[4])! : undefined
  if (!run) return undefined
  const seats: SeatName[] = []
  if (/\bcodex exec\b/.test(command)) seats.push('codex')
  if (/agy\s+-p\b/.test(command)) seats.push('gemini')
  if (/grok\/bin\/grok\b|--prompt-file\b/.test(command)) seats.push('grok')
  if (seats.length === 0) return undefined
  const round = /round2-/.test(command) ? 2 : 1
  const alarms = [...command.matchAll(/alarm (\d+)/g)].map(m => Number(m[1]) * 1000)
  const prints = [...command.matchAll(/--print-timeout (\d+)m/g)].map(m => Number(m[1]) * 60_000)
  const limitMs = Math.max(600_000, ...alarms, ...prints)
  return { run: run.replace(/\/+$/, ''), seats, round, limitMs }
}

/** A run dir's loop number and the decision slug its loops share. */
export function runIdentity(run: string): { decision: string; loop: number } {
  const base = run.split('/').filter(Boolean).pop() ?? run
  const m = /^(.*?)-loop(\d+)$/.exec(base)
  const stem = (m ? m[1]! : base).replace(/^panel-/, '')
  return { decision: stem || base, loop: m ? Number(m[2]) : 1 }
}

export type Meta = { decision?: string; title?: string; mode?: string; loop?: number; seats?: Record<string, string>; benched?: string[] }

const obj = (text: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function parseMeta(text: string): Meta | undefined {
  const o = obj(text)
  if (!o) return undefined
  const seats = o.seats && typeof o.seats === 'object' ? (o.seats as Record<string, unknown>) : {}
  return {
    decision: str(o.decision),
    title: str(o.title),
    mode: str(o.mode),
    loop: typeof o.loop === 'number' ? o.loop : undefined,
    seats: Object.fromEntries(Object.entries(seats).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    benched: Array.isArray(o.benched) ? o.benched.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase()) : [],
  }
}

const RULINGS = ['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const

export function parseRuling(text: string): Ruling | undefined {
  const o = obj(text)
  if (!o || !Array.isArray(o.points)) return undefined
  const points: RulingPoint[] = o.points.flatMap((p, i): RulingPoint[] => {
    if (!p || typeof p !== 'object') return []
    const q = p as Record<string, unknown>
    const ruling = RULINGS.find(r => r === q.ruling)
    const text = str(q.text)
    if (!ruling || !text) return []
    const sev = q.severity === 'S1' || q.severity === 'S2' || q.severity === 'S3' ? q.severity : undefined
    const bucket = q.bucket === 'converge' || q.bucket === 'split' || q.bucket === 'gap' ? q.bucket : undefined
    return [{
      id: str(q.id) ?? `p${i + 1}`,
      text,
      seats: Array.isArray(q.seats) ? q.seats.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase()) : [],
      bucket,
      severity: sev,
      ruling,
      reason: str(q.reason),
      verified: typeof q.verified === 'boolean' ? q.verified : undefined,
    }]
  })
  return { round: typeof o.round === 'number' ? o.round : 1, outcome: str(o.outcome), summary: str(o.summary), points }
}

export type Metrics = {
  replied: number
  tally: Partial<Record<Verdict, number>>
  /** the largest verdict bucket over the seats that replied, 0..1 */
  consensus: number
  /** §5: any REJECT against an APPROVE or APPROVE_WITH_CHANGES */
  isSplit: boolean
  severities: Record<Severity, number>
}

export function metrics(seats: readonly Seat[]): Metrics {
  const tally: Partial<Record<Verdict, number>> = {}
  const severities: Record<Severity, number> = { S1: 0, S2: 0, S3: 0 }
  let replied = 0
  for (const s of seats) {
    const v = s.reply?.verdict
    if (v) {
      replied += 1
      tally[v] = (tally[v] ?? 0) + 1
    }
    for (const r of s.reply?.risks ?? []) if (r.severity) severities[r.severity] += 1
  }
  const top = Math.max(0, ...Object.values(tally))
  const isSplit = (tally.REJECT ?? 0) > 0 && ((tally.APPROVE ?? 0) + (tally.APPROVE_WITH_CHANGES ?? 0)) > 0
  return { replied, tally, consensus: replied ? top / replied : 0, isSplit, severities }
}

export const SHORT: Record<Verdict, string> = { APPROVE: 'APPROVE', APPROVE_WITH_CHANGES: 'AWC', REJECT: 'REJECT', NEED_INFO: 'NEED_INFO' }

export const tallyText = (m: Metrics) =>
  m.replied === 0
    ? 'no verdicts yet'
    : (Object.entries(m.tally) as [Verdict, number][]).map(([v, n]) => `${SHORT[v]} ×${n}`).join(', ')

export const isTerminal = (s: Seat) => s.status !== 'queued' && s.status !== 'running'

export const roundLabel = (r: Round) => `L${r.loop} R${r.round}`

export function newestRound(d: Decision | undefined): Round | undefined {
  return d?.rounds.reduce<Round | undefined>((a, r) => (!a || r.startedAt >= a.startedAt ? r : a), undefined)
}

export type SigninPlan =
  | { kind: 'process'; argv: (home: string) => string[]; label: string; detail: string }
  | { kind: 'terminal'; command: string; tokenFile: (home: string) => string; label: string; detail: string }

/** How each seat's CLI signs in again. agy has no login command: its interactive first run does it. */
export const SIGNIN: Record<'codex' | 'gemini' | 'grok', SigninPlan> = {
  codex: { kind: 'process', argv: () => ['/bin/zsh', '-lc', 'codex login'], label: 'Sign in to Codex', detail: 'Runs codex login: your browser opens, and the command ends itself once you are signed in.' },
  grok: { kind: 'process', argv: home => [`${home}/.grok/bin/grok`, 'login', '--oauth'], label: 'Sign in to Grok', detail: 'Runs grok login --oauth: your browser opens, and the command ends itself once you are signed in.' },
  gemini: {
    kind: 'terminal',
    command: '~/.local/bin/agy',
    tokenFile: home => `${home}/.gemini/antigravity-cli/antigravity-oauth-token`,
    label: 'Sign in to Gemini',
    detail: 'Opens a Terminal window running agy. Choose to sign in with Google there; the window closes by itself once your token is saved.',
  },
}
