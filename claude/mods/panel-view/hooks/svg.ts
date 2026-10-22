import type { RulingKind, Seat, SeatName, SeatStatus, Severity, Verdict } from '../types'
import type { Metrics } from './parse'

// ───────────── palette: fixed hues that read in light and dark themes ─────────────

export const VERDICT_HEX: Record<Verdict, string> = { APPROVE: '#2da44e', APPROVE_WITH_CHANGES: '#d4a72c', REJECT: '#e5534b', NEED_INFO: '#8b949e' }
export const SEAT_HEX: Record<SeatName, string> = { codex: '#10a37f', gemini: '#4285f4', grok: '#a371f7', claude: '#d97757' }
export const SEV_HEX: Record<Severity, string> = { S1: '#e5534b', S2: '#d4a72c', S3: '#8b949e' }
export const STATUS_HEX: Record<SeatStatus, string> = {
  queued: '#8b949e', running: '#539bf5', done: '#2da44e', unparsed: '#d4a72c', benched: '#8b949e', unavailable: '#e5534b', timeout: '#e5534b',
}
export const RULING_HEX: Record<RulingKind, string> = { accept: '#2da44e', accept_with_revision: '#d4a72c', overrule: '#e5534b', out_of_scope: '#8b949e', deferred: '#8b949e' }
const MUTED = '#8b949e'
const FONT = 'ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif'

// Theme keys for Text, so terminal colors follow the person's theme.
export const VERDICT_THEME: Record<Verdict, string> = { APPROVE: 'success', APPROVE_WITH_CHANGES: 'warning', REJECT: 'error', NEED_INFO: 'inactive' }
export const STATUS_THEME: Record<SeatStatus, string> = {
  queued: 'inactive', running: 'suggestion', done: 'success', unparsed: 'warning', benched: 'inactive', unavailable: 'error', timeout: 'error',
}
export const SEV_THEME: Record<Severity, string> = { S1: 'error', S2: 'warning', S3: 'inactive' }
export const RULING_THEME: Record<RulingKind, string> = { accept: 'success', accept_with_revision: 'warning', overrule: 'error', out_of_scope: 'inactive', deferred: 'inactive' }

// ───────────── words: every abbreviation spelled out ─────────────

export const VERDICT_WORD: Record<Verdict, string> = { APPROVE: 'Approve', APPROVE_WITH_CHANGES: 'Approve with changes', REJECT: 'Reject', NEED_INFO: 'Needs more info' }
export const SEV_WORD: Record<Severity, string> = { S1: 'Blocker', S2: 'Fix before merge', S3: 'Nice to have' }
export const STATUS_WORD: Record<SeatStatus, string> = {
  queued: 'Waiting', running: 'Reviewing', done: 'Answered', unparsed: 'Answered, unreadable', benched: 'Benched', unavailable: 'Unavailable', timeout: 'Timed out',
}
export const RULING_WORD: Record<RulingKind, string> = { accept: 'Accepted', accept_with_revision: 'Accepted with revision', overrule: 'Overruled', out_of_scope: 'Out of scope', deferred: 'Deferred' }
export const SEAT_WORD: Record<SeatName, string> = { codex: 'Codex', gemini: 'Gemini', grok: 'Grok', claude: 'Claude' }

// Terminal glyphs, one per meaning.
export const VERDICT_GLYPH: Record<Verdict, string> = { APPROVE: '✔', APPROVE_WITH_CHANGES: '✎', REJECT: '✖', NEED_INFO: '?' }
export const STATUS_GLYPH: Record<SeatStatus, string> = { queued: '◌', running: '◐', done: '●', unparsed: '◍', benched: '⏸', unavailable: '⊘', timeout: '⧗' }
export const SEV_GLYPH: Record<Severity, string> = { S1: '⛔', S2: '▲', S3: '•' }
export const RULING_GLYPH: Record<RulingKind, string> = { accept: '✔', accept_with_revision: '✎', overrule: '⊘', out_of_scope: '↗', deferred: '⏳' }
export const KIND_GLYPH = { risk: '▲', disagreement: '⇄', gap: '◇', evidence: '⚖' } as const
export const KIND_WORD = { risk: 'Risk', disagreement: 'Disagreement', gap: 'Gap', evidence: 'Would change its mind' } as const

// ───────────── primitives ─────────────

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
/** A chart that scales to the width of its card: the viewBox keeps its proportions. */
const fluid = (w: number, h: number, body: string, title?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet">${title ? `<title>${esc(title)}</title>` : ''}${body}</svg>`
const svg = (w: number, h: number, body: string, title?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${title ? `<title>${esc(title)}</title>` : ''}${body}</svg>`
const f = (n: number) => n.toFixed(1)

/** Icon paths on a 16×16 grid, stroked with `c`. */
const PATH = {
  check: (c: string) => `<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: (c: string) => `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  pencil: (c: string) => `<path d="M3 13l1-3.5 6.5-6.5 2.5 2.5-6.5 6.5z" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.2 4.3l2.5 2.5" stroke="${c}" stroke-width="1.6"/>`,
  question: (c: string) => `<path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12.6" r="1" fill="${c}"/>`,
  clock: (c: string) => `<circle cx="8" cy="8" r="5.5" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  pause: (c: string) => `<rect x="4.5" y="4" width="2.4" height="8" rx="1" fill="${c}"/><rect x="9.1" y="4" width="2.4" height="8" rx="1" fill="${c}"/>`,
  ban: (c: string) => `<circle cx="8" cy="8" r="5.5" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M4.2 11.8l7.6-7.6" stroke="${c}" stroke-width="1.8"/>`,
  hourglass: (c: string) => `<path d="M4.5 2.5h7M4.5 13.5h7M5 2.5c0 3 6 3.5 6 5.5s-6 2.5-6 5.5M11 2.5c0 3-6 3.5-6 5.5s6 2.5 6 5.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  warn: (c: string) => `<path d="M8 2.5l6 10.5H2z" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5v3" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".9" fill="${c}"/>`,
  octagon: (c: string) => `<path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z" fill="${c}"/><path d="M8 5v3.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11" r="1" fill="#fff"/>`,
  triangle: (c: string) => `<path d="M8 2.5l6 10.5H2z" fill="${c}"/>`,
  dot: (c: string) => `<circle cx="8" cy="8" r="3.5" fill="${c}"/>`,
  arrows: (c: string) => `<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  gap: (c: string) => `<rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.5 2"/>`,
  out: (c: string) => `<path d="M7 3H3.5v9.5H13V9M9.5 2.5H13.5v4M13.5 2.5L8 8" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  pulse: (c: string) => `<path d="M1.5 8.5h3l1.5-4 3 8 1.5-4h4" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  list: (c: string) => `<path d="M6 4.5h8M6 8h8M6 11.5h8" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="3" cy="4.5" r="1" fill="${c}"/><circle cx="3" cy="8" r="1" fill="${c}"/><circle cx="3" cy="11.5" r="1" fill="${c}"/>`,
  scale: (c: string) => `<path d="M8 2.5v11M4.5 13.5h7M3 5.5h10M3 5.5L1.5 9.5h3zM13 5.5l-1.5 4h3z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`,
  rounds: (c: string) => `<circle cx="3" cy="8" r="1.8" fill="${c}"/><circle cx="8" cy="8" r="1.8" fill="${c}"/><circle cx="13" cy="8" r="1.8" fill="${c}"/><path d="M4.8 8h1.4M9.8 8h1.4" stroke="${c}" stroke-width="1.4"/>`,
  panel: (c: string) => `<rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M9.5 3v10" stroke="${c}" stroke-width="1.5"/><circle cx="5" cy="6.5" r="1" fill="${c}"/><circle cx="5" cy="9.5" r="1" fill="${c}"/>`,
}

const icon = (body: string, size: number, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><title>${esc(title)}</title>${body}</svg>`

export const verdictIcon = (v: Verdict, size = 16) =>
  icon((v === 'APPROVE' ? PATH.check : v === 'REJECT' ? PATH.cross : v === 'NEED_INFO' ? PATH.question : PATH.pencil)(VERDICT_HEX[v]), size, VERDICT_WORD[v])

export const severityIcon = (s: Severity, size = 14) =>
  icon((s === 'S1' ? PATH.octagon : s === 'S2' ? PATH.triangle : PATH.dot)(SEV_HEX[s]), size, `${s}: ${SEV_WORD[s]}`)

export const kindIcon = (k: 'risk' | 'disagreement' | 'gap' | 'evidence', size = 14) =>
  icon((k === 'risk' ? PATH.warn : k === 'disagreement' ? PATH.arrows : k === 'gap' ? PATH.gap : PATH.scale)(MUTED), size, KIND_WORD[k])

export const keyIcon = (size = 14) =>
  icon(`<circle cx="5.5" cy="8" r="3" fill="none" stroke="#539bf5" stroke-width="1.6"/><path d="M8.5 8h6M12.5 8v2.5M14.5 8v2" stroke="#539bf5" stroke-width="1.6" stroke-linecap="round"/>`, size, 'Sign in')

export const rulingIcon = (r: RulingKind, size = 16) =>
  icon((r === 'accept' ? PATH.check : r === 'accept_with_revision' ? PATH.pencil : r === 'overrule' ? PATH.ban : r === 'out_of_scope' ? PATH.out : PATH.clock)(RULING_HEX[r]), size, RULING_WORD[r])

export const tabIcon = (t: 'live' | 'findings' | 'rulings' | 'rounds', active: boolean, size = 16) =>
  icon((t === 'live' ? PATH.pulse : t === 'findings' ? PATH.list : t === 'rulings' ? PATH.scale : PATH.rounds)(active ? '#539bf5' : MUTED), size, t)

export const panelIcon = (busy: boolean, size = 14) =>
  icon(PATH.panel(busy ? '#539bf5' : MUTED) + (busy ? `<circle cx="12.5" cy="3.5" r="2.5" fill="#539bf5"><animate attributeName="opacity" values="1;.25;1" dur="1.2s" repeatCount="indefinite"/></circle>` : ''), size, 'Open the panel view')

/** A status icon; running spins. */
export function statusIcon(s: SeatStatus, size = 16): string {
  const c = STATUS_HEX[s]
  if (s === 'running') {
    return icon(`<circle cx="8" cy="8" r="5.5" fill="none" stroke="${c}" stroke-opacity=".25" stroke-width="2"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.9s" repeatCount="indefinite"/></path>`, size, STATUS_WORD[s])
  }
  const body = s === 'done' ? `<circle cx="8" cy="8" r="6.5" fill="${c}"/>${PATH.check('#fff')}`
    : s === 'queued' ? PATH.clock(c)
    : s === 'benched' ? PATH.pause(c)
    : s === 'unavailable' ? PATH.ban(c)
    : s === 'timeout' ? PATH.hourglass(c)
    : PATH.warn(c)
  return icon(body, size, STATUS_WORD[s])
}

/** A seat's mark: a family-colored tile with a distinct shape per seat. */
export function seatIcon(seat: SeatName, size = 20): string {
  const c = SEAT_HEX[seat]
  const shape = seat === 'codex' ? `<path d="M8 3l4.3 2.5v5L8 13l-4.3-2.5v-5z" fill="none" stroke="#fff" stroke-width="1.5"/>`
    : seat === 'gemini' ? `<path d="M8 2.8C8.6 6 10 7.4 13.2 8 10 8.6 8.6 10 8 13.2 7.4 10 6 8.6 2.8 8 6 7.4 7.4 6 8 2.8z" fill="#fff"/>`
    : seat === 'grok' ? `<circle cx="8" cy="8" r="4.3" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M4.5 11.5l7-7" stroke="#fff" stroke-width="1.5"/>`
    : `<path d="M8 2.8v10.4M2.8 8h10.4M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`
  return icon(`<rect width="16" height="16" rx="4" fill="${c}"/>${shape}`, size, SEAT_WORD[seat])
}

/** A verdict pill: icon and the full word on a tinted ground. */
export function verdictPill(v: Verdict): { source: string; width: number } {
  const label = VERDICT_WORD[v]
  const w = Math.round(30 + label.length * 6.6)
  const c = VERDICT_HEX[v]
  const glyph = (v === 'APPROVE' ? PATH.check : v === 'REJECT' ? PATH.cross : v === 'NEED_INFO' ? PATH.question : PATH.pencil)(c)
  return {
    width: w,
    source: svg(w, 22, `<rect x=".5" y=".5" width="${w - 1}" height="21" rx="11" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-opacity=".5"/><g transform="translate(6 3)">${glyph}</g><text x="25" y="15" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${c}">${esc(label)}</text>`, label),
  }
}

// ───────────── charts ─────────────

const ORDER: Verdict[] = ['APPROVE', 'APPROVE_WITH_CHANGES', 'NEED_INFO', 'REJECT']

/** Verdicts as a donut: one arc per seat that answered, a dashed arc per seat still out; agreement in the middle. */
export function verdictDonut(m: Metrics, expected: number, size = 132): string {
  const n = Math.max(expected, m.replied, 1)
  const r = size / 2 - 12
  const c = size / 2
  const C = 2 * Math.PI * r
  const gap = n > 1 ? 3 : 0
  let at = 0
  const arcs: string[] = []
  for (const v of ORDER) {
    for (let i = 0; i < (m.tally[v] ?? 0); i++) {
      const len = C / n - gap
      arcs.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${VERDICT_HEX[v]}" stroke-width="14" stroke-dasharray="${f(len)} ${f(C)}" stroke-dashoffset="${f(-at)}" transform="rotate(-90 ${c} ${c})"><title>${VERDICT_WORD[v]}</title></circle>`)
      at += C / n
    }
  }
  for (let i = m.replied; i < n; i++) {
    arcs.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${MUTED}" stroke-opacity=".35" stroke-width="14" stroke-dasharray="${f(C / n - gap)} ${f(C)}" stroke-dashoffset="${f(-at)}" transform="rotate(-90 ${c} ${c})"><title>Still reviewing</title></circle>`)
    at += C / n
  }
  const top = Math.max(0, ...Object.values(m.tally))
  const head = m.replied ? `${top}/${m.replied}` : '—'
  const sub = m.replied ? (m.isSplit ? 'split' : top === m.replied ? 'agree' : 'majority') : 'waiting'
  const subColor = m.isSplit ? VERDICT_HEX.REJECT : top === m.replied && m.replied > 0 ? VERDICT_HEX.APPROVE : MUTED
  return svg(size, size,
    `${arcs.join('')}<text x="${c}" y="${c + 2}" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="700" fill="${subColor}">${head}</text>` +
    `<text x="${c}" y="${c + 20}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}" letter-spacing=".04em">${sub.toUpperCase()}</text>`,
    `${m.replied} of ${n} seats answered; ${top} share the leading verdict${m.isSplit ? '; material split' : ''}`)
}

/** When each seat ran: one lane per seat, a bar from start to end, dashed and growing while running. */
export function seatTimeline(seats: readonly Seat[], start: number, now: number, w = 380): string {
  const lane = 22
  const left = 74
  const h = seats.length * lane + 22
  const end = Math.max(now, ...seats.map(s => s.endedAt ?? 0), start + 60_000)
  const span = end - start
  const x = (t: number) => left + ((t - start) / span) * (w - left - 8)
  const stepMin = span > 10 * 60_000 ? 5 : span > 4 * 60_000 ? 2 : 1
  const ticks: string[] = []
  for (let t = 0; t <= span; t += stepMin * 60_000) {
    ticks.push(`<line x1="${f(x(start + t))}" x2="${f(x(start + t))}" y1="4" y2="${h - 16}" stroke="${MUTED}" stroke-opacity=".18"/><text x="${f(x(start + t))}" y="${h - 4}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${MUTED}">${t / 60_000}m</text>`)
  }
  const rows = seats.map((s, i) => {
    const y = 6 + i * lane
    const label = `<text x="0" y="${y + 12}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${SEAT_HEX[s.name]}">${SEAT_WORD[s.name]}</text>`
    if (s.startedAt === undefined) {
      return `${label}<text x="${left}" y="${y + 12}" font-family="${FONT}" font-size="11" fill="${MUTED}">${STATUS_WORD[s.status]}</text>`
    }
    const x0 = x(s.startedAt)
    const x1 = Math.max(x0 + 3, x(s.endedAt ?? now))
    const color = s.reply?.verdict ? VERDICT_HEX[s.reply.verdict] : STATUS_HEX[s.status]
    const stripes = s.status === 'running'
      ? `<rect x="${f(x0)}" y="${y + 2}" width="${f(x1 - x0)}" height="14" rx="4" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2"/><circle cx="${f(x1)}" cy="${y + 9}" r="3.5" fill="${color}"/>`
      : ''
    const secs = Math.round(((s.endedAt ?? now) - s.startedAt) / 1000)
    return `${label}<rect x="${f(x0)}" y="${y + 2}" width="${f(x1 - x0)}" height="14" rx="4" fill="${color}" fill-opacity="${s.status === 'running' ? 0.3 : 0.9}"><title>${SEAT_WORD[s.name]}: ${STATUS_WORD[s.status]}, ${secs}s</title></rect>${stripes}`
  })
  const defs = ''
  return fluid(w, h, defs + ticks.join('') + rows.join(''), 'When each seat ran')
}

/** Whether each pair of seats agrees: same verdict, compatible (approve and approve with changes), or in conflict. */
export function agreementMatrix(seats: readonly Seat[], cell = 46): string {
  const left = 64
  const top = 22
  const w = left + seats.length * cell
  const h = top + seats.length * cell
  const ok = (v: Verdict) => v === 'APPROVE' || v === 'APPROVE_WITH_CHANGES'
  const rel = (a?: Verdict, b?: Verdict) => {
    if (!a || !b) return { c: MUTED, o: 0.12, mark: '', t: 'not both answered' }
    if (a === b) return { c: VERDICT_HEX.APPROVE, o: 0.85, mark: '=', t: 'same verdict' }
    if (ok(a) && ok(b)) return { c: VERDICT_HEX.APPROVE_WITH_CHANGES, o: 0.8, mark: '≈', t: 'compatible' }
    if ((a === 'REJECT' && ok(b)) || (b === 'REJECT' && ok(a))) return { c: VERDICT_HEX.REJECT, o: 0.85, mark: '≠', t: 'conflict' }
    return { c: MUTED, o: 0.5, mark: '~', t: 'different' }
  }
  const heads = seats.map((s, i) =>
    // Row names on the left, column names on top: horizontal and inside the drawing.
    `<text x="${left - 8}" y="${top + i * cell + cell / 2 + 4}" text-anchor="end" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${SEAT_HEX[s.name]}">${SEAT_WORD[s.name]}</text>` +
    `<text x="${left + i * cell + cell / 2}" y="${top - 8}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${SEAT_HEX[s.name]}">${SEAT_WORD[s.name]}</text>`)
  const cells = seats.flatMap((a, i) => seats.map((b, j) => {
    const x = left + j * cell + 2
    const y = top + i * cell + 2
    const size = cell - 4
    if (i === j) return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="${SEAT_HEX[a.name]}" fill-opacity=".18"/>`
    const r = rel(a.reply?.verdict, b.reply?.verdict)
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="${r.c}" fill-opacity="${r.o}"><title>${SEAT_WORD[a.name]} and ${SEAT_WORD[b.name]}: ${r.t}</title></rect>` +
      (r.mark ? `<text x="${x + size / 2}" y="${y + size / 2 + 6}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="700" fill="#fff">${r.mark}</text>` : '')
  }))
  return svg(w, h, heads.join('') + cells.join(''), 'Which seats agree with each other')
}

/** Risks per seat by severity, as horizontal stacked bars. */
export function severityBars(seats: readonly Seat[], w = 380): string {
  const lane = 20
  const left = 74
  const counts = seats.map(s => {
    const c = { S1: 0, S2: 0, S3: 0 }
    for (const r of s.reply?.risks ?? []) if (r.severity) c[r.severity] += 1
    return c
  })
  const max = Math.max(1, ...counts.map(c => c.S1 + c.S2 + c.S3))
  const unit = (w - left - 30) / max
  const rows = seats.map((s, i) => {
    const y = 4 + i * lane
    let x = left
    const segs = (['S1', 'S2', 'S3'] as const).map(k => {
      const n = counts[i]![k]
      if (!n) return ''
      const seg = `<rect x="${f(x)}" y="${y}" width="${f(n * unit - 2)}" height="13" rx="3" fill="${SEV_HEX[k]}"><title>${SEAT_WORD[s.name]}: ${n} ${SEV_WORD[k]}</title></rect>`
      x += n * unit
      return seg
    }).join('')
    const total = counts[i]!.S1 + counts[i]!.S2 + counts[i]!.S3
    return `<text x="0" y="${y + 11}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${SEAT_HEX[s.name]}">${SEAT_WORD[s.name]}</text>${segs}<text x="${f(x + 4)}" y="${y + 11}" font-family="${FONT}" font-size="11" fill="${MUTED}">${s.reply ? total : ''}</text>`
  })
  return fluid(w, seats.length * lane + 6, rows.join(''), 'Risks raised per seat, by severity')
}

/** Every round: a stacked column of verdicts, the agreement line across them, axis labels. */
export function roundsChart(rounds: readonly { label: string; tally: Partial<Record<Verdict, number>>; seats: number; agreement: number; current: boolean }[], w = 380, h = 150): string {
  if (rounds.length === 0) return svg(w, h, '')
  const left = 34
  const bottom = 26
  const top = 10
  const plotH = h - bottom - top
  const step = (w - left - 10) / rounds.length
  const bw = Math.min(34, step * 0.55)
  const maxSeats = Math.max(1, ...rounds.map(r => r.seats))
  const grid = [0, 0.5, 1].map(p => {
    const y = top + plotH * (1 - p)
    return `<line x1="${left}" x2="${w - 6}" y1="${f(y)}" y2="${f(y)}" stroke="${MUTED}" stroke-opacity=".2"/><text x="${left - 6}" y="${f(y + 4)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${MUTED}">${Math.round(p * 100)}%</text>`
  })
  const cols = rounds.map((r, i) => {
    const cx = left + step * i + step / 2
    let y = top + plotH
    const segs = ORDER.map(v => {
      const n = r.tally[v] ?? 0
      if (!n) return ''
      const sh = (n / maxSeats) * plotH
      y -= sh
      return `<rect x="${f(cx - bw / 2)}" y="${f(y)}" width="${f(bw)}" height="${f(sh - 1.5)}" rx="3" fill="${VERDICT_HEX[v]}" fill-opacity="${r.current ? 1 : 0.7}"><title>${r.label}: ${n} ${VERDICT_WORD[v]}</title></rect>`
    }).join('')
    return `${segs}<text x="${f(cx)}" y="${h - 8}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="${r.current ? 700 : 400}" fill="${r.current ? '#539bf5' : MUTED}">${esc(r.label)}</text>`
  })
  const pts = rounds.map((r, i) => [left + step * i + step / 2, top + plotH * (1 - r.agreement)] as const)
  const line = pts.length > 1 ? `<path d="${pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${f(x)} ${f(y)}`).join(' ')}" fill="none" stroke="#539bf5" stroke-width="2"/>` : ''
  const dots = pts.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="4" fill="#fff" stroke="#539bf5" stroke-width="2"><title>${rounds[i]!.label}: ${Math.round(rounds[i]!.agreement * 100)}% agree</title></circle>`).join('')
  return svg(w, h, grid.join('') + cols.join('') + line + dots, 'Verdicts per round, with the share of seats agreeing')
}

/** Terminal bar. */
export const blocks = (share: number, n: number) => '█'.repeat(Math.round(share * n)) + '░'.repeat(n - Math.round(share * n))

// ───────────── rulings ─────────────

const RULINGS: readonly RulingKind[] = ['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred']
const OUTCOME = {
  proceed: { word: 'Proceed', c: '#2da44e', icon: PATH.check },
  proceed_with_changes: { word: 'Proceed with changes', c: '#d4a72c', icon: PATH.pencil },
  stop: { word: 'Stop', c: '#e5534b', icon: PATH.cross },
  need_info: { word: 'Needs more info', c: '#8b949e', icon: PATH.question },
} as const

/** The convener's outcome as a large badge. */
export function outcomeBadge(outcome?: string): { source: string; width: number; word: string } {
  const o = OUTCOME[(outcome ?? '') as keyof typeof OUTCOME] ?? { word: outcome ? outcome.replace(/_/g, ' ') : 'No outcome', c: MUTED, icon: PATH.question }
  const w = Math.round(52 + o.word.length * 9.4)
  return {
    word: o.word,
    width: w,
    source: svg(w, 36, `<rect x=".5" y=".5" width="${w - 1}" height="35" rx="18" fill="${o.c}" fill-opacity=".16" stroke="${o.c}" stroke-opacity=".6"/><g transform="translate(10 8) scale(1.25)">${o.icon(o.c)}</g><text x="40" y="23.5" font-family="${FONT}" font-size="15" font-weight="700" fill="${o.c}">${esc(o.word)}</text>`, o.word),
  }
}

/** How the points were ruled: one stacked bar, each kind labelled with its count. */
export function rulingBar(points: readonly { ruling: RulingKind }[], w = 380): string {
  const n = Math.max(1, points.length)
  let x = 0
  const parts = RULINGS.flatMap(k => {
    const c = points.filter(p => p.ruling === k).length
    if (!c) return []
    const bw = (c / n) * w
    const seg = `<rect x="${f(x)}" y="0" width="${f(Math.max(2, bw - 2))}" height="22" rx="5" fill="${RULING_HEX[k]}" fill-opacity="${k === 'out_of_scope' || k === 'deferred' ? 0.55 : 0.9}"><title>${c} ${RULING_WORD[k]}</title></rect>` +
      (bw > 22 ? `<text x="${f(x + bw / 2 - 1)}" y="15.5" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#fff">${c}</text>` : '')
    x += bw
    return [seg]
  })
  return fluid(w, 22, parts.join(''), 'How the points were ruled')
}

/** Where points came from (converge, split, gap) against how they were ruled: a bubble per cell. */
export function bucketGrid(points: readonly { ruling: RulingKind; bucket?: string }[]): string {
  const rows = [['converge', 'Converge'], ['split', 'Split'], ['gap', 'Gap']] as const
  const left = 70
  const top = 46
  const cw = 64
  const ch = 34
  const w = left + RULINGS.length * cw
  const h = top + rows.length * ch
  const max = Math.max(1, ...rows.flatMap(([b]) => RULINGS.map(k => points.filter(p => p.bucket === b && p.ruling === k).length)))
  const LABEL: Record<RulingKind, string[]> = { accept: ['Accepted'], accept_with_revision: ['Accepted,', 'revised'], overrule: ['Overruled'], out_of_scope: ['Out of', 'scope'], deferred: ['Deferred'] }
  const heads = RULINGS.map((k, j) => LABEL[k].map((l, i) =>
    `<text x="${left + j * cw + cw / 2}" y="${LABEL[k].length === 1 ? 20 : 14 + i * 12}" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${RULING_HEX[k]}" font-weight="600">${esc(l)}</text>`).join(''))
  const body = rows.flatMap(([b, label], i) => {
    const y = top + i * ch + ch / 2
    return [`<text x="${left - 10}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${MUTED}">${label}</text>`,
      ...RULINGS.map((k, j) => {
        const c = points.filter(p => p.bucket === b && p.ruling === k).length
        const cx = left + j * cw + cw / 2
        if (!c) return `<circle cx="${cx}" cy="${y}" r="2" fill="${MUTED}" fill-opacity=".4"/>`
        const r = 7 + 9 * Math.sqrt(c / max)
        return `<circle cx="${cx}" cy="${y}" r="${f(r)}" fill="${RULING_HEX[k]}" fill-opacity=".85"><title>${c} ${label.toLowerCase()} point${c > 1 ? 's' : ''} ${RULING_WORD[k].toLowerCase()}</title></circle><text x="${cx}" y="${y + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="#fff">${c}</text>`
      })]
  })
  return fluid(w, h, heads.join('') + body.join(''), 'Where each point came from, and how it was ruled')
}

/** Whose points the convener took: per seat, its points by ruling. */
export function seatUptake(points: readonly { ruling: RulingKind; seats: readonly string[] }[], w = 380): string {
  const seats = (['codex', 'gemini', 'grok', 'claude'] as const)
  const lane = 22
  const left = 74
  const counts = seats.map(s => RULINGS.map(k => points.filter(p => p.ruling === k && p.seats.includes(s)).length))
  const max = Math.max(1, ...counts.map(c => c.reduce((a, b) => a + b, 0)))
  const unit = (w - left - 34) / max
  const rows = seats.map((s, i) => {
    const y = 4 + i * lane
    let x = left
    const segs = RULINGS.map((k, j) => {
      const n = counts[i]![j]!
      if (!n) return ''
      const seg = `<rect x="${f(x)}" y="${y}" width="${f(n * unit - 2)}" height="14" rx="3" fill="${RULING_HEX[k]}" fill-opacity="${k === 'out_of_scope' || k === 'deferred' ? 0.55 : 0.9}"><title>${SEAT_WORD[s]}: ${n} ${RULING_WORD[k]}</title></rect>`
      x += n * unit
      return seg
    }).join('')
    const total = counts[i]!.reduce((a, b) => a + b, 0)
    return `<text x="0" y="${y + 11}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${SEAT_HEX[s]}">${SEAT_WORD[s]}</text>${segs}<text x="${f(x + 4)}" y="${y + 11}" font-family="${FONT}" font-size="11" fill="${MUTED}">${total || ''}</text>`
  })
  return fluid(w, seats.length * lane + 6, rows.join(''), 'Whose points the convener took')
}
