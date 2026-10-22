export type SeatName = 'codex' | 'gemini' | 'grok' | 'claude'
export type Verdict = 'APPROVE' | 'APPROVE_WITH_CHANGES' | 'REJECT' | 'NEED_INFO'
export type Severity = 'S1' | 'S2' | 'S3'
export type SeatStatus = 'queued' | 'running' | 'done' | 'unparsed' | 'benched' | 'unavailable' | 'timeout'

export type Risk = { severity?: Severity; text: string }

export type SeatReply = {
  verdict?: Verdict
  confidence?: 'high' | 'medium' | 'low'
  risks: Risk[]
  disagreements: string[]
  gaps: string[]
  wouldChange: string[]
  selfReport?: string
  /** the reply as written, capped */
  raw: string
}

export type Seat = {
  name: SeatName
  model?: string
  status: SeatStatus
  startedAt?: number
  endedAt?: number
  /** after this the seat is timed out: its command's limit plus a grace period */
  deadline?: number
  /** files read (CLI seats) or tool calls (Claude seat) seen so far */
  reads: number
  reply?: SeatReply
  /** why a seat is benched, unavailable or timed out */
  note?: string
  /** a failure the pane can repair with a click: the CLI needs signing in again */
  fix?: 'signin'
}

/** A repair the person started from the pane. */
export type FixState = { state: 'running' | 'done' | 'failed'; message: string; at: number }

export type RulingKind = 'accept' | 'accept_with_revision' | 'overrule' | 'out_of_scope' | 'deferred'

export type RulingPoint = {
  id: string
  text: string
  seats: string[]
  bucket?: 'converge' | 'split' | 'gap'
  severity?: Severity
  ruling: RulingKind
  reason?: string
  verified?: boolean
}

export type Ruling = {
  round: number
  outcome?: string
  summary?: string
  points: RulingPoint[]
}

export type Round = {
  /** `${run}#${round}` */
  id: string
  run: string
  loop: number
  round: number
  startedAt: number
  /** when the dispatch's Bash call returned */
  endedAt?: number
  seats: Seat[]
  ruling?: Ruling
}

export type Decision = {
  id: string
  title: string
  mode?: string
  rounds: Round[]
}

export type Tab = 'live' | 'findings' | 'rulings' | 'rounds'

export type Selected = {
  decision?: string
  /** a Round id; absent follows the newest */
  round?: string
  tab: Tab
  seat?: SeatName
  filter: 'all' | Severity
  /** Findings tab: how cards are grouped, which seats and kinds show, a text search, and the cards opened */
  findGroup?: FindingGroup
  findSeats?: SeatName[]
  findKinds?: FindingKind[]
  findQuery?: string
  expanded?: string[]
}

export type FindingKind = 'risk' | 'disagreement' | 'gap' | 'evidence'
export type FindingGroup = 'severity' | 'seat' | 'kind' | 'ruling'

declare module 'claude-code' {
  interface PluginState {
    'panel-view': { decisions: Decision[]; selected: Selected; now: number; fixes: Partial<Record<SeatName, FixState>> }
  }
}
