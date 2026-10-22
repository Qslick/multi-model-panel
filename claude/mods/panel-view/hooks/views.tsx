import type { Elements, RenderElement } from 'claude-code'

import type { Decision, FindingGroup, FindingKind, FixState, Round, RulingKind, RulingPoint, Seat, SeatName, Selected, Severity, Tab, Verdict } from '../types'
import { metrics, roundLabel, SIGNIN } from './parse'
import type { Metrics } from './parse'
import {
  agreementMatrix, blocks, bucketGrid, keyIcon, outcomeBadge, rulingBar, seatUptake, KIND_GLYPH, KIND_WORD, kindIcon, panelIcon, roundsChart, RULING_GLYPH, RULING_THEME, RULING_WORD, rulingIcon,
  SEAT_HEX, SEAT_WORD, seatIcon, seatTimeline, SEV_GLYPH, SEV_THEME, SEV_WORD, severityBars, severityIcon, STATUS_GLYPH, STATUS_THEME,
  STATUS_WORD, statusIcon, tabIcon, VERDICT_GLYPH, VERDICT_THEME, VERDICT_WORD, verdictDonut, verdictIcon, verdictPill,
} from './svg'

export type Actions = {
  tab: (t: Tab) => void
  round: (id: string) => void
  decision: (id: string) => void
  seat: (s: SeatName | undefined) => void
  filter: (f: Selected['filter']) => void
  signIn: (s: SeatName) => void
  retry: (s: SeatName) => void
  group: (g: FindingGroup) => void
  toggleSeat: (s: SeatName) => void
  toggleKind: (k: FindingKind) => void
  query: (q: string) => void
  toggle: (id: string) => void
  expandAll: (ids: string[]) => void
  collapseAll: () => void
  openReply: (s: SeatName) => void
}

export type ViewData = {
  decisions: readonly Decision[]
  decision?: Decision
  round?: Round
  selected: Selected
  now: number
  fixes: Partial<Record<SeatName, FixState>>
}

const TABS: readonly [Tab, string, string][] = [['live', 'Live', '1'], ['findings', 'Findings', '2'], ['rulings', 'Rulings', '3'], ['rounds', 'Rounds', '4']]
const VERDICTS: readonly Verdict[] = ['APPROVE', 'APPROVE_WITH_CHANGES', 'NEED_INFO', 'REJECT']
const SEVS: readonly Severity[] = ['S1', 'S2', 'S3']

export const elapsed = (from?: number, to?: number) => {
  if (from === undefined || to === undefined) return ''
  const s = Math.max(0, Math.round((to - from) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}
const seatTime = (s: Seat, now: number) => elapsed(s.startedAt, s.endedAt ?? (s.status === 'running' ? now : undefined))
const roundWords = (r: Round) => `Loop ${r.loop} · Round ${r.round}`
const modeWord = (m?: string) => (m === 'completion' ? 'Completion check' : m === 'plan' ? 'Plan review' : m === 'decide' ? 'Decision' : m)
const outcomeWord = (o?: string) => o?.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** Every verdict in words, e.g. "1 Reject, 2 Approve with changes". */
export const tallyWords = (m: Metrics) =>
  m.replied === 0 ? 'No verdicts yet' : VERDICTS.filter(v => m.tally[v]).map(v => `${m.tally[v]} ${VERDICT_WORD[v]}`).join(', ')

/** One sentence on whether the seats agree. */
export function agreementWords(m: Metrics, ruling?: Round['ruling']): string {
  const splitPoints = ruling?.points.filter(p => p.bucket === 'split').length ?? 0
  if (m.isSplit) return `Split: a seat rejects what others approve. Round 2 is due.${splitPoints ? ` The ruling marks ${splitPoints} split point${splitPoints > 1 ? 's' : ''}.` : ''}`
  if (splitPoints) return `Split on ${splitPoints} point${splitPoints > 1 ? 's' : ''}, per the convener's ruling.`
  if (m.replied < 2) return 'Waiting for more seats to answer.'
  const top = Math.max(0, ...Object.values(m.tally))
  return top === m.replied ? 'All answering seats agree.' : 'No conflict: the seats differ only in degree.'
}

export type Finding = { id: string; seat: SeatName; kind: FindingKind; severity?: Severity; text: string }

const STOP = new Set('the a an and or of to in on for is are be it this that with as by at not no from its was were has have can will when then than into only'.split(' '))
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))

/** Ruling points that likely answer a finding: same seat, and enough shared words. */
export function relatedRulings(f: Finding, round: Round | undefined): RulingPoint[] {
  const fw = words(f.text)
  return (round?.ruling?.points ?? [])
    .filter(p => p.seats.includes(f.seat))
    .map(p => {
      const pw = words(`${p.text} ${p.reason ?? ''}`)
      const shared = [...fw].filter(w => pw.has(w)).length
      return { p, score: shared / Math.max(1, Math.min(fw.size, pw.size)) }
    })
    .filter(x => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(x => x.p)
}

const KINDS: readonly FindingKind[] = ['risk', 'disagreement', 'gap', 'evidence']
const SEATS: readonly SeatName[] = ['codex', 'gemini', 'grok', 'claude']

/** The findings the Findings tab shows after its filters and search. */
export function filteredFindings(r: Round | undefined, sel: Selected): Finding[] {
  const q = (sel.findQuery ?? '').trim().toLowerCase()
  return findings(r).filter(f =>
    (sel.filter === 'all' || f.severity === sel.filter) &&
    (!sel.findSeats?.length || sel.findSeats.includes(f.seat)) &&
    (!sel.findKinds?.length || sel.findKinds.includes(f.kind)) &&
    (!q || f.text.toLowerCase().includes(q) || SEAT_WORD[f.seat].toLowerCase().includes(q)))
}

/** Findings in groups, in display order. */
export function groupFindings(list: readonly Finding[], by: FindingGroup, r: Round | undefined): [string, Finding[]][] {
  const key = (f: Finding): string =>
    by === 'seat' ? SEAT_WORD[f.seat]
    : by === 'kind' ? KIND_WORD[f.kind]
    : by === 'ruling' ? (relatedRulings(f, r)[0] ? RULING_WORD[relatedRulings(f, r)[0]!.ruling] : r?.ruling ? 'No matching ruling' : 'Not ruled yet')
    : f.severity ? `${f.severity} · ${SEV_WORD[f.severity]}` : KIND_WORD[f.kind]
  const order = by === 'seat' ? SEATS.map(s => SEAT_WORD[s])
    : by === 'kind' ? KINDS.map(k => KIND_WORD[k])
    : by === 'ruling' ? [...(['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const).map(k => RULING_WORD[k]), 'No matching ruling', 'Not ruled yet']
    : [...SEVS.map(s => `${s} · ${SEV_WORD[s]}`), ...KINDS.filter(k => k !== 'risk').map(k => KIND_WORD[k]), KIND_WORD.risk]
  const groups = new Map<string, Finding[]>()
  for (const f of list) groups.set(key(f), [...(groups.get(key(f)) ?? []), f])
  return order.filter(k => groups.has(k)).map(k => [k, groups.get(k)!])
}

export function findings(round: Round | undefined): Finding[] {
  const out: Finding[] = []
  for (const s of round?.seats ?? []) {
    s.reply?.risks.forEach((r, i) => out.push({ id: `f:${s.name}:risk:${i}`, seat: s.name, kind: 'risk', severity: r.severity, text: r.text }))
    s.reply?.disagreements.forEach((x, i) => out.push({ id: `f:${s.name}:disagreement:${i}`, seat: s.name, kind: 'disagreement', text: x }))
    s.reply?.gaps.forEach((x, i) => out.push({ id: `f:${s.name}:gap:${i}`, seat: s.name, kind: 'gap', text: x }))
    s.reply?.wouldChange.forEach((x, i) => out.push({ id: `f:${s.name}:evidence:${i}`, seat: s.name, kind: 'evidence', text: x }))
  }
  const rank = (f: Finding) => (f.severity ? Number(f.severity[1]) : f.kind === 'disagreement' ? 4 : f.kind === 'gap' ? 5 : 6)
  return out.sort((a, b) => rank(a) - rank(b))
}

function lead(r: Round): Verdict | undefined {
  const m = metrics(r.seats)
  return (Object.entries(m.tally) as [Verdict, number][]).sort((a, b) => b[1] - a[1])[0]?.[0]
}

const sevCount = (s: Seat): Record<Severity, number> => {
  const c = { S1: 0, S2: 0, S3: 0 }
  for (const r of s.reply?.risks ?? []) if (r.severity) c[r.severity] += 1
  return c
}

// ───────────────────────── desktop ─────────────────────────

type D = Elements['desktop']

function legend(el: D, kind: 'verdict' | 'severity' | 'ruling' | 'agreement'): RenderElement {
  const { Box, Svg, Text } = el
  const item = (key: string, source: string, label: string) => (
    <Box key={key} flexDirection="row" alignItems="center" gap="xs">
      <Svg source={source} alt={label} width={14} height={14} />
      <Text dimColor size="caption">{label}</Text>
    </Box>
  )
  const swatch = (c: string, o = 1) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="3" fill="${c}" fill-opacity="${o}"/></svg>`
  const items = kind === 'verdict' ? VERDICTS.map(v => item(`lv-${v}`, verdictIcon(v, 14), VERDICT_WORD[v]))
    : kind === 'severity' ? SEVS.map(s => item(`ls-${s}`, severityIcon(s, 14), `${s} = ${SEV_WORD[s]}`))
    : kind === 'ruling' ? (['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const).map(r => item(`lr-${r}`, rulingIcon(r, 14), RULING_WORD[r]))
    : [item('la-same', swatch('#2da44e', 0.85), '= Same verdict'), item('la-comp', swatch('#d4a72c', 0.8), '≈ Compatible (approve, approve with changes)'), item('la-conf', swatch('#e5534b', 0.85), '≠ Conflict (reject against approve)'), item('la-none', swatch('#8b949e', 0.15), 'Not both answered')]
  return <Box flexDirection="row" gap="sm" flexWrap="wrap">{items}</Box>
}

function section(el: D, key: string, title: string, children: RenderElement | RenderElement[], hint?: string): RenderElement {
  const { Box, Text } = el
  return (
    <Box key={key} flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text weight="semibold" size="footnote">{title}</Text>
        {hint && <Text dimColor size="caption">{hint}</Text>}
      </Box>
      {children}
    </Box>
  )
}

/** One chart in the Live tab's responsive row: side by side when the pane is wide, stacked when narrow. */
/** Box sizes are character cells on every surface (an Svg's are CSS pixels): about 8 px a cell, plus the padding. */
const cells = (px: number) => Math.ceil(px / 8) + 4

function card(el: D, key: string, title: string, hint: string, chartPx: number, children: RenderElement): RenderElement {
  const { Box, Text } = el
  // A natural width that shrinks to fit a narrow pane but never stretches: the charts keep their size.
  return (
    <Box key={key} flexDirection="column" gap="sm" padding="sm" borderStyle="round" borderColor="subtle" width={cells(chartPx)} minWidth={Math.min(cells(chartPx), 36)} flexGrow={0} flexShrink={1}>
      <Box flexDirection="column" gap="xs">
        <Text weight="semibold" size="footnote">{title}</Text>
        <Text dimColor size="caption" wrap="wrap">{hint}</Text>
      </Box>
      {children}
    </Box>
  )
}

/** A seat the pane can repair: its sign-in button, then progress, then a retry. */
const RETRYABLE = new Set(['unavailable', 'timeout', 'unparsed'])

function repairDesktop(el: D, s: Seat, fix: FixState | undefined, act: Actions): RenderElement | null {
  const { Box, Button, Svg, Text } = el
  if (s.name === 'claude' || (!s.fix && !fix)) {
    if (!RETRYABLE.has(s.status)) return null
    return (
      <Box key={`retrybox-${s.name}`} flexDirection="row" alignItems="center" gap="xs">
        <Button key={`retry-${s.name}`} label={`Retry ${SEAT_WORD[s.name]} seat`} onPress={() => act.retry(s.name)} />
      </Box>
    )
  }
  const plan = SIGNIN[s.name]
  return (
    <Box key={`fix-${s.name}`} flexDirection="column" gap="xs" padding="xs" borderStyle="round" borderColor={fix?.state === 'failed' ? 'error' : fix?.state === 'done' ? 'success' : 'suggestion'}>
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Svg source={fix?.state === 'running' ? statusIcon('running', 14) : fix?.state === 'done' ? statusIcon('done', 14) : keyIcon(14)} alt="sign in" width={14} height={14} />
        <Text size="caption" weight="semibold">{fix?.state === 'running' ? 'Signing in…' : fix?.state === 'done' ? 'Signed in' : fix?.state === 'failed' ? 'Sign-in failed' : 'Needs signing in'}</Text>
      </Box>
      <Text dimColor size="caption" wrap="wrap">{fix?.message ?? plan.detail}</Text>
      {fix?.state === 'done'
        ? <Button key={`retry-${s.name}`} label={`Retry ${SEAT_WORD[s.name]} seat`} variant="primary" onPress={() => act.retry(s.name)} />
        : fix?.state !== 'running' && <Button key={`signin-${s.name}`} label={fix?.state === 'failed' ? 'Try again' : plan.label} variant="primary" onPress={() => act.signIn(s.name)} />}
    </Box>
  )
}

export function desktopPane(el: D, d: ViewData, act: Actions): RenderElement {
  const { Box, Text, Button, Svg } = el
  const r = d.round
  if (!d.decision || !r) {
    return (
      <Box flexDirection="column" gap="sm" padding="sm">
        <Svg key="svg-panelIcon-1" source={panelIcon(false, 28)} alt="panel" width={28} height={28} />
        <Text weight="semibold">No panel has run in this session yet</Text>
        <Text dimColor size="footnote">Run /multi-model-panel and this view fills in live: every seat, its verdict and findings, how far the seats agree, and the convener's rulings, round by round.</Text>
      </Box>
    )
  }
  const tabs = (
    <Box flexDirection="row" gap="sm" flexWrap="wrap">
      {TABS.map(([t, label, key]) => (
        <Box key={`tabbox-${t}`} flexDirection="row" alignItems="center" gap="xs">
          <Svg key="svg-tabIcon-2" source={tabIcon(t, d.selected.tab === t)} alt={label} width={16} height={16} />
          <Button key={`tab-${t}`} label={label} hotkey={key} variant={d.selected.tab === t ? 'primary' : 'secondary'} onPress={() => act.tab(t)} />
        </Box>
      ))}
    </Box>
  )
  const body = d.selected.tab === 'live' ? desktopLive(el, d, r, act)
    : d.selected.tab === 'findings' ? desktopFindings(el, d, r, act)
    : d.selected.tab === 'rulings' ? desktopRulings(el, r, d, act)
    : desktopRounds(el, d, act)
  const isLive = r.seats.some(s => s.status === 'running' || s.status === 'queued')
  return (
    <Box flexDirection="column" gap="md" padding="sm">
      <Box flexDirection="column" gap="xs">
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Svg key="svg-panelIcon-3" source={panelIcon(isLive, 18)} alt={isLive ? 'running' : 'idle'} width={18} height={18} />
          <Text size="heading" weight="semibold" wrap="wrap">{d.decision.title}</Text>
        </Box>
        <Text dimColor size="caption">
          {[modeWord(d.decision.mode), roundWords(r), `${isLive ? 'running for' : 'took'} ${elapsed(r.startedAt, r.endedAt ?? d.now)}`].filter(Boolean).join('  ·  ')}
        </Text>
      </Box>
      {tabs}
      {body}
    </Box>
  )
}

function desktopLive(el: D, d: ViewData, r: Round, act: Actions): RenderElement {
  const { Box, Text, Button, Svg, Markdown } = el
  const m = metrics(r.seats)
  const expected = r.seats.filter(s => s.status !== 'benched').length
  const open = d.selected.seat ? r.seats.find(s => s.name === d.selected.seat) : undefined
  const answered = r.seats.filter(s => s.reply?.verdict)
  return (
    <Box flexDirection="column" gap="lg">
      <Box flexDirection="row" alignItems="center" gap="lg" flexWrap="wrap">
        <Svg key="svg-verdictDonut-4" source={verdictDonut(m, expected)} alt={`${m.replied} of ${expected} answered: ${tallyWords(m)}`} width={132} height={132} />
        <Box flexDirection="column" gap="xs" flexShrink={1}>
          <Text weight="semibold" color={m.isSplit ? 'error' : m.replied > 1 ? 'success' : 'inactive'}>{agreementWords(m, r.ruling)}</Text>
          <Text size="footnote">{tallyWords(m)}</Text>
          <Text dimColor size="caption">{m.replied} of {expected} seats answered{r.seats.length > expected ? `, ${r.seats.length - expected} sitting out` : ''}</Text>
          {legend(el, 'verdict')}
        </Box>
      </Box>

      {section(el, 'sec-seats', 'Seats', (
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          {r.seats.map(s => {
            const pill = s.reply?.verdict ? verdictPill(s.reply.verdict) : undefined
            const sev = sevCount(s)
            return (
              <Box key={`card-${s.name}`} flexDirection="column" gap="xs" padding="sm" borderStyle="round" borderColor={d.selected.seat === s.name ? SEAT_HEX[s.name] : 'subtle'} minWidth={24}>
                <Box flexDirection="row" alignItems="center" gap="xs">
                  <Svg key="svg-seatIcon-5" source={seatIcon(s.name)} alt={SEAT_WORD[s.name]} width={20} height={20} />
                  <Text weight="semibold">{SEAT_WORD[s.name]}</Text>
                  <Svg isInteractive={s.status === 'running' ? true : undefined} key="svg-statusIcon-6" source={statusIcon(s.status)} alt={STATUS_WORD[s.status]} width={16} height={16} />
                  <Text color={STATUS_THEME[s.status]} size="caption">{STATUS_WORD[s.status]}</Text>
                </Box>
                <Text dimColor size="caption" wrap="truncate">{s.model ?? 'model not recorded'}</Text>
                {pill
                  ? <Box flexDirection="row" alignItems="center" gap="xs">
                      <Svg source={pill.source} alt={VERDICT_WORD[s.reply!.verdict!]} width={pill.width} height={22} />
                      {s.reply?.confidence && <Text dimColor size="caption">{s.reply.confidence} confidence</Text>}
                    </Box>
                  : <Text dimColor size="footnote" wrap="wrap">{s.note ? s.note.slice(0, 120) : s.status === 'running' ? 'Reviewing the packet…' : '—'}</Text>}
                {repairDesktop(el, s, d.fixes[s.name], act)}
                {s.reply && (
                  <Box flexDirection="row" alignItems="center" gap="sm">
                    {SEVS.filter(k => sev[k]).map(k => (
                      <Box key={`sv-${s.name}-${k}`} flexDirection="row" alignItems="center" gap="xs">
                        <Svg key="svg-severityIcon-7" source={severityIcon(k, 12)} alt={SEV_WORD[k]} width={12} height={12} />
                        <Text size="caption" tabular>{sev[k]}</Text>
                      </Box>
                    ))}
                    {!sev.S1 && !sev.S2 && !sev.S3 && <Text dimColor size="caption">No risks raised</Text>}
                  </Box>
                )}
                <Text dimColor size="caption" tabular>
                  {[seatTime(s, d.now), s.reads ? `${s.reads} file reads` : s.status === 'done' ? 'judged from the packet only' : ''].filter(Boolean).join('  ·  ')}
                </Text>
                {s.reply && <Button key={`open-${s.name}`} label={d.selected.seat === s.name ? 'Hide full reply' : 'Show full reply'} onPress={() => act.seat(d.selected.seat === s.name ? undefined : s.name)} />}
              </Box>
            )
          })}
        </Box>
      ))}

      {open?.reply && (
        <Box flexDirection="column" gap="xs" padding="sm" borderStyle="round" borderColor={SEAT_HEX[open.name]}>
          <Text weight="semibold">{SEAT_WORD[open.name]}'s full reply</Text>
          <Markdown key={`reply-${open.name}`} text={'```\n' + open.reply.raw + '\n```'} />
        </Box>
      )}

      <Box key="charts" flexDirection="row" flexWrap="wrap" gap="md" alignItems="flex-start">
        {card(el, 'card-time', 'Activity', 'When each seat ran; dashed bars are still reviewing.', 420,
          <Svg key="svg-timeline" source={seatTimeline(r.seats, r.startedAt, d.now)} alt="when each seat ran" />)}
        {answered.length > 1 && card(el, 'card-agree', 'Who agrees with whom', 'Each square compares two seats\' verdicts.', 280, (
          <Box flexDirection="column" gap="sm" alignItems="center">
            <Svg key="svg-agreement" source={agreementMatrix(r.seats)} alt="agreement between seats" width={248} height={206} />
            {legend(el, 'agreement')}
          </Box>
        ))}
        {answered.length > 0 && card(el, 'card-sev', 'Risks raised', 'Risks each seat raised, by severity.', 380, (
          <Box flexDirection="column" gap="sm">
            <Svg key="svg-severity" source={severityBars(r.seats)} alt="risks per seat by severity" />
            {legend(el, 'severity')}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function desktopFindings(el: D, d: ViewData, r: Round, act: Actions): RenderElement {
  const { Box, Text, Button, Svg, Input } = el
  const sel = d.selected
  const all = findings(r)
  const shown = filteredFindings(r, sel)
  const by = sel.findGroup ?? 'severity'
  const open = new Set(sel.expanded ?? [])
  const chip = (key: string, label: string, isOn: boolean, press: () => void) =>
    <Button key={key} label={label} variant={isOn ? 'primary' : 'secondary'} onPress={press} />
  const count = (pred: (f: Finding) => boolean) => all.filter(pred).length
  return (
    <Box flexDirection="column" gap="md">
      <Box flexDirection="column" gap="sm" padding="sm" borderStyle="round" borderColor="subtle">
        <Input key="find-query" placeholder="Search findings…" value={sel.findQuery ?? ''} onInput={v => act.query(v)} onSubmit={v => act.query(v)} />
        <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          <Text dimColor size="caption">Group by</Text>
          {(['severity', 'seat', 'kind', 'ruling'] as const).map(g => chip(`g-${g}`, g === 'kind' ? 'Type' : g === 'ruling' ? 'Ruling' : g[0]!.toUpperCase() + g.slice(1), by === g, () => act.group(g)))}
        </Box>
        <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          <Text dimColor size="caption">Seats</Text>
          {SEATS.filter(s => count(f => f.seat === s)).map(s => chip(`fs-${s}`, `${SEAT_WORD[s]} ${count(f => f.seat === s)}`, !!sel.findSeats?.includes(s), () => act.toggleSeat(s)))}
        </Box>
        <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          <Text dimColor size="caption">Types</Text>
          {KINDS.filter(k => count(f => f.kind === k)).map(k => chip(`fk-${k}`, `${KIND_WORD[k]} ${count(f => f.kind === k)}`, !!sel.findKinds?.includes(k), () => act.toggleKind(k)))}
        </Box>
        <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
          <Text dimColor size="caption">Severity</Text>
          {chip('f-all', 'Any', sel.filter === 'all', () => act.filter('all'))}
          {SEVS.filter(s => count(f => f.severity === s)).map(s => chip(`f-${s}`, `${SEV_WORD[s]} ${count(f => f.severity === s)}`, sel.filter === s, () => act.filter(s)))}
        </Box>
      </Box>
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text size="footnote" weight="semibold">{shown.length} of {all.length} findings</Text>
        {shown.length > 0 && <Button key="expand-all" label="Expand all" onPress={() => act.expandAll(shown.map(f => f.id))} />}
        {open.size > 0 && <Button key="collapse-all" label="Collapse all" onPress={() => act.collapseAll()} />}
      </Box>
      {shown.length === 0 && <Text dimColor>{all.length ? 'No finding matches these filters.' : 'No findings yet.'}</Text>}
      {groupFindings(shown, by, r).map(([title, list]) => (
        <Box key={`grp-${title}`} flexDirection="column" gap="sm">
          <Text weight="semibold" size="footnote">{title} <Text dimColor size="caption">({list.length})</Text></Text>
          {list.map(f => findingCard(el, f, r, open.has(f.id), act))}
        </Box>
      ))}
    </Box>
  )
}

/** One finding: a readable summary row that opens into its details. */
function findingCard(el: D, f: Finding, r: Round, isOpen: boolean, act: Actions): RenderElement {
  const { Box, Text, Button, Svg } = el
  const seat = r.seats.find(s => s.name === f.seat)
  const related = isOpen ? relatedRulings(f, r) : []
  const tag = f.severity ? `${KIND_WORD[f.kind]} · ${SEV_WORD[f.severity]}` : KIND_WORD[f.kind]
  return (
    <Box key={`card-${f.id}`} flexDirection="column" gap="xs" padding="sm" borderStyle="round" borderColor={isOpen ? SEAT_HEX[f.seat] : 'subtle'}>
      <Box flexDirection="row" gap="sm" alignItems="flex-start">
        <Svg key={`ic-${f.id}`} source={f.severity ? severityIcon(f.severity, 18) : kindIcon(f.kind, 18)} alt={tag} width={18} height={18} />
        <Box flexDirection="column" gap="xs" flexGrow={1} flexShrink={1}>
          <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
            <Svg key={`si-${f.id}`} source={seatIcon(f.seat, 14)} alt={SEAT_WORD[f.seat]} width={14} height={14} />
            <Text size="caption" weight="semibold" color={SEAT_HEX[f.seat]}>{SEAT_WORD[f.seat]}</Text>
            <Text dimColor size="caption">· {tag}</Text>
          </Box>
          <Text size="body" wrap={isOpen ? 'wrap' : 'truncate-end'}>{f.text}</Text>
        </Box>
        <Button key={`tg-${f.id}`} label={isOpen ? 'Less' : 'More'} onPress={() => act.toggle(f.id)} />
      </Box>
      {isOpen && (
        <Box flexDirection="column" gap="xs" paddingLeft="lg">
          {seat?.reply?.verdict && (
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Svg key={`vi-${f.id}`} source={verdictIcon(seat.reply.verdict, 14)} alt={VERDICT_WORD[seat.reply.verdict]} width={14} height={14} />
              <Text size="footnote">{SEAT_WORD[f.seat]}'s verdict: {VERDICT_WORD[seat.reply.verdict]}{seat.reply.confidence ? `, ${seat.reply.confidence} confidence` : ''}</Text>
            </Box>
          )}
          <Text dimColor size="footnote">Raised in {roundWords(r)}{seat?.reads ? ` after ${seat.reads} file reads` : seat?.status === 'done' ? ', judged from the packet only' : ''}.</Text>
          {related.length > 0 && <Text size="footnote" weight="semibold">The convener's ruling</Text>}
          {related.map(p => (
            <Box key={`rel-${f.id}-${p.id}`} flexDirection="row" gap="xs" alignItems="flex-start">
              <Svg key={`ri-${f.id}-${p.id}`} source={rulingIcon(p.ruling, 14)} alt={RULING_WORD[p.ruling]} width={14} height={14} />
              <Text size="footnote" wrap="wrap"><Text color={RULING_THEME[p.ruling]} weight="semibold">{RULING_WORD[p.ruling]}</Text>{p.reason ? ` — ${p.reason}` : ''}</Text>
            </Box>
          ))}
          {r.ruling && related.length === 0 && <Text dimColor size="footnote">No ruling point matched this finding's wording.</Text>}
          <Box flexDirection="row" gap="xs">
            <Button key={`rp-${f.id}`} label={`Open ${SEAT_WORD[f.seat]}'s full reply`} onPress={() => act.openReply(f.seat)} />
          </Box>
        </Box>
      )}
    </Box>
  )
}

function desktopRulings(el: D, r: Round, d: ViewData, act: Actions): RenderElement {
  const { Box, Text, Svg, Button } = el
  const ru = r.ruling
  if (!ru) {
    return (
      <Box flexDirection="column" gap="xs">
        <Text weight="semibold">Waiting for the convener's ruling</Text>
        <Text dimColor size="footnote">Rulings appear here when the convener writes ruling.json for this round: each point accepted, revised, overruled or set aside, with the reason.</Text>
      </Box>
    )
  }
  const badge = outcomeBadge(ru.outcome)
  const open = new Set(d.selected.expanded ?? [])
  const kinds = ['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const
  const BUCKET_WORD: Record<string, string> = { converge: 'Raised by two or more seats', split: 'Seats disagreed', gap: 'Raised by one seat' }
  return (
    <Box flexDirection="column" gap="md">
      <Box flexDirection="column" gap="sm">
        <Svg key="outcome" source={badge.source} alt={badge.word} width={badge.width} height={36} />
        {ru.summary && <Text wrap="wrap">{ru.summary}</Text>}
      </Box>
      <Box key="rul-charts" flexDirection="row" flexWrap="wrap" gap="md" alignItems="flex-start">
        {card(el, 'card-rbar', 'How the points were ruled', `${ru.points.length} points in all.`, 400, (
          <Box flexDirection="column" gap="sm">
            <Svg key="rbar" source={rulingBar(ru.points)} alt="points by ruling" />
            {legend(el, 'ruling')}
          </Box>
        ))}
        {card(el, 'card-grid', 'Where points came from', 'Rows: how many seats raised it. Columns: the ruling.', 410, (
          <Svg key="bgrid" source={bucketGrid(ru.points)} alt="points by origin and ruling" />
        ))}
        {card(el, 'card-uptake', 'Whose points were taken', 'Each seat\'s points, by how they were ruled.', 380, (
          <Svg key="uptake" source={seatUptake(ru.points)} alt="points per seat by ruling" />
        ))}
      </Box>
      {kinds.filter(k => ru.points.some(p => p.ruling === k)).map(k => {
        const ps = ru.points.filter(p => p.ruling === k)
        return (
          <Box key={`rk-${k}`} flexDirection="column" gap="sm">
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Svg key={`rki-${k}`} source={rulingIcon(k, 16)} alt={RULING_WORD[k]} width={16} height={16} />
              <Text weight="semibold" color={RULING_THEME[k]}>{RULING_WORD[k]}</Text>
              <Text dimColor size="caption">({ps.length})</Text>
            </Box>
            {ps.map(p => {
              const id = `p:${r.id}:${p.id}`
              const isOpen = open.has(id)
              return (
                <Box key={`pc-${p.id}`} flexDirection="column" gap="xs" padding="sm" borderStyle="round" borderColor={isOpen ? RULING_THEME[p.ruling] : 'subtle'}>
                  <Box flexDirection="row" gap="sm" alignItems="flex-start">
                    {p.severity
                      ? <Svg key={`ps-${p.id}`} source={severityIcon(p.severity, 16)} alt={SEV_WORD[p.severity]} width={16} height={16} />
                      : <Svg key={`ps-${p.id}`} source={rulingIcon(p.ruling, 16)} alt={RULING_WORD[p.ruling]} width={16} height={16} />}
                    <Box flexDirection="column" gap="xs" flexGrow={1} flexShrink={1}>
                      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
                        {p.seats.map(s => (s in SEAT_HEX
                          ? <Svg key={`pss-${p.id}-${s}`} source={seatIcon(s as SeatName, 14)} alt={s} width={14} height={14} />
                          : <Text key={`pss-${p.id}-${s}`} dimColor size="caption">{s}</Text>))}
                        <Text dimColor size="caption">{p.seats.map(s => (s in SEAT_WORD ? SEAT_WORD[s as SeatName] : s)).join(', ')}{p.bucket ? ` · ${BUCKET_WORD[p.bucket]}` : ''}{p.severity ? ` · ${SEV_WORD[p.severity]}` : ''}</Text>
                      </Box>
                      <Text wrap={isOpen ? 'wrap' : 'truncate-end'}>{p.text}</Text>
                    </Box>
                    <Button key={`pt-${p.id}`} label={isOpen ? 'Less' : 'Why'} onPress={() => act.toggle(id)} />
                  </Box>
                  {isOpen && (
                    <Box flexDirection="column" gap="xs" paddingLeft="lg">
                      {p.reason && <Text size="footnote" wrap="wrap"><Text weight="semibold">Why: </Text>{p.reason}</Text>}
                      <Text size="footnote" color={p.verified === true ? 'success' : p.verified === false ? 'error' : 'inactive'}>
                        {p.verified === true ? '✓ Checked against its source, and it held.' : p.verified === false ? '✗ Checked against its source, and it did not hold.' : 'Not checked against its source.'}
                      </Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}

function desktopRounds(el: D, d: ViewData, act: Actions): RenderElement {
  const { Box, Text, Button, Svg } = el
  const rounds = d.decision?.rounds ?? []
  const chart = rounds.map(r => {
    const m = metrics(r.seats)
    return { label: roundLabel(r), tally: m.tally, seats: r.seats.filter(s => s.status !== 'benched').length, agreement: m.consensus, current: r.id === d.round?.id }
  })
  return (
    <Box flexDirection="column" gap="md">
      {section(el, 'sec-traj', 'Verdicts and agreement, round by round', (
        <Box flexDirection="column" gap="xs">
          <Svg key="svg-roundsChart-15" source={roundsChart(chart)} alt="verdicts per round" width={380} height={150} />
          <Text dimColor size="caption">L = loop (a fresh review of the changed item), R = round (a second pass on a split). The blue line is the share of seats agreeing.</Text>
          {legend(el, 'verdict')}
        </Box>
      ))}
      {section(el, 'sec-list', 'Rounds', rounds.map(r => {
        const l = lead(r)
        return (
          <Box key={`rrow-${r.id}`} flexDirection="row" alignItems="center" gap="sm">
            {l ? <Svg key="svg-verdictIcon-16" source={verdictIcon(l, 16)} alt={VERDICT_WORD[l]} width={16} height={16} /> : <Svg key="svg-statusIcon-17" source={statusIcon('running', 16)} alt="running" width={16} height={16} />}
            <Button key={`r-${r.id}`} plain onPress={() => act.round(r.id)}>
              <Text weight={d.round?.id === r.id ? 'bold' : 'regular'}>{roundWords(r)}</Text>
              {'  '}
              <Text dimColor>{tallyWords(metrics(r.seats))}{r.ruling?.outcome ? ` → ${outcomeWord(r.ruling.outcome)}` : ''}</Text>
            </Button>
          </Box>
        )
      }), 'select one to view it')}
      {d.decisions.length > 1 && section(el, 'sec-dec', 'Other decisions this session', d.decisions.filter(x => x.id !== d.decision?.id).map(x => (
        <Button key={`d-${x.id}`} plain onPress={() => act.decision(x.id)}>{x.title} <Text dimColor>· {x.rounds.length} round{x.rounds.length > 1 ? 's' : ''}</Text></Button>
      )))}
    </Box>
  )
}

// ───────────────────────── terminal ─────────────────────────

export function terminalPane(el: Elements['terminal'], d: ViewData, act: Actions, columns: number): RenderElement {
  const { Box, Text, Button, Markdown, Input } = el
  const r = d.round
  if (!d.decision || !r) return <Text dimColor>No panel has run in this session yet. Run /multi-model-panel and it fills in live.</Text>
  const m = metrics(r.seats)
  const expected = r.seats.filter(s => s.status !== 'benched').length
  const w = Math.max(10, Math.min(30, columns - 40))
  const tab = d.selected.tab
  const vLegend = VERDICTS.map(v => `${VERDICT_GLYPH[v]} ${VERDICT_WORD[v]}`).join('   ')
  const sLegend = SEVS.map(s => `${SEV_GLYPH[s]} ${s} ${SEV_WORD[s]}`).join('   ')
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{d.decision.title}</Text>
      <Text dimColor>{[modeWord(d.decision.mode), roundWords(r), elapsed(r.startedAt, r.endedAt ?? d.now)].filter(Boolean).join(' · ')}</Text>
      <Box flexDirection="row" gap={1}>
        {TABS.map(([t, label, key]) => <Button key={`tab-${t}`} label={label} hotkey={key} variant={tab === t ? 'primary' : 'secondary'} onPress={() => act.tab(t)} />)}
      </Box>
      {tab === 'live' && (
        <Box flexDirection="column">
          <Text>
            <Text color={m.isSplit ? 'error' : 'success'}>{blocks(m.consensus, w)}</Text> {m.replied}/{expected} answered · {tallyWords(m)}
          </Text>
          <Text color={m.isSplit ? 'error' : 'inactive'}>{agreementWords(m, r.ruling)}</Text>
          {r.seats.map(s => (
            <Text key={`row-${s.name}`} wrap="truncate">
              <Text color={STATUS_THEME[s.status]}>{STATUS_GLYPH[s.status]} </Text>
              <Text bold color={SEAT_HEX[s.name]}>{SEAT_WORD[s.name].padEnd(7)}</Text>
              {s.reply?.verdict
                ? <Text color={VERDICT_THEME[s.reply.verdict]}>{VERDICT_GLYPH[s.reply.verdict]} {VERDICT_WORD[s.reply.verdict].padEnd(21)}</Text>
                : <Text dimColor>{STATUS_WORD[s.status].padEnd(23)}</Text>}
              <Text dimColor>{[seatTime(s, d.now), s.reads ? `${s.reads} reads` : '', s.reply ? SEVS.map(k => `${SEV_GLYPH[k]}${sevCount(s)[k]}`).join(' ') : '', s.note ?? ''].filter(Boolean).join(' · ')}</Text>
            </Text>
          ))}
          {r.seats.filter(s => (s.name === 'claude' || (!s.fix && !d.fixes[s.name])) && RETRYABLE.has(s.status)).map(s => (
            <Button key={`retry-${s.name}`} label={`Retry ${SEAT_WORD[s.name]} seat`} onPress={() => act.retry(s.name)} />
          ))}
          {r.seats.filter(s => s.name !== 'claude' && (s.fix || d.fixes[s.name])).map(s => {
            const fix = d.fixes[s.name]
            const plan = SIGNIN[s.name as 'codex' | 'gemini' | 'grok']
            return (
              <Box key={`tfix-${s.name}`} flexDirection="column">
                <Text color={fix?.state === 'failed' ? 'error' : 'suggestion'} wrap="wrap">🔑 {SEAT_WORD[s.name]}: {fix?.message ?? plan.detail}</Text>
                {fix?.state === 'done'
                  ? <Button key={`retry-${s.name}`} label={`Retry ${SEAT_WORD[s.name]} seat`} variant="primary" onPress={() => act.retry(s.name)} />
                  : fix?.state !== 'running' && <Button key={`signin-${s.name}`} label={fix?.state === 'failed' ? 'Try again' : plan.label} variant="primary" onPress={() => act.signIn(s.name)} />}
              </Box>
            )
          })}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {r.seats.filter(s => s.reply).map(s => (
              <Button key={`open-${s.name}`} label={`${d.selected.seat === s.name ? 'Hide' : 'Reply:'} ${SEAT_WORD[s.name]}`} onPress={() => act.seat(d.selected.seat === s.name ? undefined : s.name)} />
            ))}
          </Box>
          {d.selected.seat && r.seats.find(s => s.name === d.selected.seat)?.reply && (
            <Markdown key={`reply-${d.selected.seat}`} text={'```\n' + r.seats.find(s => s.name === d.selected.seat)!.reply!.raw + '\n```'} />
          )}
          <Text dimColor wrap="wrap">{STATUS_GLYPH.running} reviewing  {STATUS_GLYPH.done} answered  {STATUS_GLYPH.benched} benched  {STATUS_GLYPH.unavailable} unavailable  {STATUS_GLYPH.timeout} timed out</Text>
          <Text dimColor wrap="wrap">{vLegend}</Text>
        </Box>
      )}
      {tab === 'findings' && (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>Group:</Text>
            {(['severity', 'seat', 'kind', 'ruling'] as const).map(g => (
              <Button key={`g-${g}`} label={g === 'kind' ? 'type' : g} variant={(d.selected.findGroup ?? 'severity') === g ? 'primary' : 'secondary'} onPress={() => act.group(g)} />
            ))}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>Seats:</Text>
            {(['codex', 'gemini', 'grok', 'claude'] as const).map(s => (
              <Button key={`fs-${s}`} label={SEAT_WORD[s]} variant={d.selected.findSeats?.includes(s) ? 'primary' : 'secondary'} onPress={() => act.toggleSeat(s)} />
            ))}
          </Box>
          <Input key="find-query" placeholder="search" value={d.selected.findQuery ?? ''} onInput={v => act.query(v)} onSubmit={v => act.query(v)} />
          {filteredFindings(r, d.selected).length === 0 && <Text dimColor>{findings(r).length ? 'No finding matches these filters.' : 'No findings yet.'}</Text>}
          {groupFindings(filteredFindings(r, d.selected), d.selected.findGroup ?? 'severity', r).map(([title, list]) => (
            <Box key={`grp-${title}`} flexDirection="column">
              <Text bold>{title} ({list.length})</Text>
              {list.map(f => {
                const isOpen = !!d.selected.expanded?.includes(f.id)
                const rel = isOpen ? relatedRulings(f, r) : []
                return (
                  <Box key={`f-${f.id}`} flexDirection="column">
                    <Button key={`tg-${f.id}`} plain onPress={() => act.toggle(f.id)}>
                      <Text color={f.severity ? SEV_THEME[f.severity] : 'inactive'}>{isOpen ? '▾' : '▸'} {f.severity ? SEV_GLYPH[f.severity] : KIND_GLYPH[f.kind]} </Text>
                      <Text color={SEAT_HEX[f.seat]}>{SEAT_WORD[f.seat]}</Text><Text dimColor>: </Text><Text>{isOpen ? f.text : f.text.length > columns - 20 ? `${f.text.slice(0, Math.max(20, columns - 23))}…` : f.text}</Text>
                    </Button>
                    {isOpen && rel.map(p => <Text key={`rel-${f.id}-${p.id}`} dimColor wrap="wrap">    {RULING_GLYPH[p.ruling]} {RULING_WORD[p.ruling]}{p.reason ? `: ${p.reason}` : ''}</Text>)}
                  </Box>
                )
              })}
            </Box>
          ))}
          <Text dimColor wrap="wrap">{sLegend}   {KIND_GLYPH.disagreement} Disagreement   {KIND_GLYPH.gap} Gap   {KIND_GLYPH.evidence} Would change its mind</Text>
        </Box>
      )}
      {tab === 'rulings' && (
        <Box flexDirection="column">
          {!r.ruling && <Text dimColor>Waiting for the convener's ruling (ruling.json).</Text>}
          {r.ruling && <Text bold>{outcomeBadge(r.ruling.outcome).word}</Text>}
          {r.ruling?.summary && <Text wrap="wrap">{r.ruling.summary}</Text>}
          {r.ruling && (
            <Text>
              {(['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const).map(k => {
                const n = r.ruling!.points.filter(p => p.ruling === k).length
                return n ? <Text key={`rb-${k}`} color={RULING_THEME[k]}>{'█'.repeat(n * 2)}</Text> : null
              })}
              <Text dimColor> {r.ruling.points.length} points</Text>
            </Text>
          )}
          {(['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as const).filter(k => r.ruling?.points.some(p => p.ruling === k)).map(k => (
            <Box key={`rk-${k}`} flexDirection="column">
              <Text color={RULING_THEME[k]} bold>{RULING_GLYPH[k]} {RULING_WORD[k]} ({r.ruling!.points.filter(p => p.ruling === k).length})</Text>
              {r.ruling!.points.filter(p => p.ruling === k).map(p => {
                const id = `p:${r.id}:${p.id}`
                const isOpen = !!d.selected.expanded?.includes(id)
                return (
                  <Box key={`p-${p.id}`} flexDirection="column">
                    <Button key={`pt-${p.id}`} plain onPress={() => act.toggle(id)}>
                      <Text dimColor>{isOpen ? '▾' : '▸'} </Text>{p.severity ? <Text color={SEV_THEME[p.severity]}>{SEV_GLYPH[p.severity]} </Text> : ''}<Text dimColor>{p.seats.map(s => (s in SEAT_WORD ? SEAT_WORD[s as SeatName] : s)).join(', ')}: </Text><Text>{p.text}</Text>
                    </Button>
                    {isOpen && p.reason && <Text dimColor wrap="wrap">    Why: {p.reason}</Text>}
                    {isOpen && <Text dimColor>    {p.verified === true ? '✓ checked, held' : p.verified === false ? '✗ checked, did not hold' : 'not checked'}</Text>}
                  </Box>
                )
              })}
            </Box>
          ))}
          {r.ruling && <Text dimColor wrap="wrap">{(['accept', 'accept_with_revision', 'overrule', 'out_of_scope', 'deferred'] as RulingKind[]).map(k => `${RULING_GLYPH[k]} ${RULING_WORD[k]}`).join('   ')}</Text>}
        </Box>
      )}
      {tab === 'rounds' && (
        <Box flexDirection="column">
          {d.decision.rounds.map(x => {
            const l = lead(x)
            return (
              <Button key={`r-${x.id}`} plain onPress={() => act.round(x.id)}>
                <Text bold={x.id === r.id}>{roundWords(x)}</Text> <Text color={l ? VERDICT_THEME[l] : 'inactive'}>{l ? VERDICT_GLYPH[l] : STATUS_GLYPH.running}</Text> <Text dimColor>{blocks(metrics(x.seats).consensus, 10)} {tallyWords(metrics(x.seats))}</Text>
              </Button>
            )
          })}
          {d.decisions.filter(x => x.id !== d.decision?.id).map(x => (
            <Button key={`d-${x.id}`} plain onPress={() => act.decision(x.id)}>{x.title} <Text dimColor>({x.rounds.length} rounds)</Text></Button>
          ))}
          <Text dimColor>Loop = a fresh review of the changed item; Round 2 = a second pass on a split.</Text>
        </Box>
      )}
    </Box>
  )
}

/** The footer button's text: live progress, else the outcome in words. */
export function chip(r: Round | undefined): string | undefined {
  if (!r) return undefined
  const live = r.seats.some(s => s.status === 'running' || s.status === 'queued')
  const m = metrics(r.seats)
  if (live) return `Panel: ${m.replied} of ${r.seats.filter(s => s.status !== 'benched').length} answered`
  const l = lead(r)
  return l ? `Panel: ${VERDICT_GLYPH[l]} ${m.isSplit ? 'split' : VERDICT_WORD[l]}` : 'Panel'
}

export const chipIsLive = (r: Round | undefined) => !!r && r.seats.some(s => s.status === 'running' || s.status === 'queued')
export const panelIconSource = panelIcon
