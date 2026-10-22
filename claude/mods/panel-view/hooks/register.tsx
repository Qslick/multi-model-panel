import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Decision, FixState, Round, Seat, SeatName, Selected } from '../types'
import { detectDispatch, isTerminal, newestRound, parseMeta, parseReply, parseRuling, runIdentity, SIGNIN, stderrVerdict } from './parse'
import type { Dispatch, Meta } from './parse'
import { chip, chipIsLive, desktopPane, panelIconSource, terminalPane } from './views'
import type { Actions, ViewData } from './views'

const PANE = 'panel-view'
const decisions = atom({ plugin: 'panel-view', key: 'decisions' } as const, [])
const selected = atom({ plugin: 'panel-view', key: 'selected' } as const, { tab: 'live', filter: 'all' })
const now = atom({ plugin: 'panel-view', key: 'now' } as const, 0)
const fixes = atom({ plugin: 'panel-view', key: 'fixes' } as const, {})
/** A reply is read once its file has stopped changing for this long: agy streams into gemini.md. */
const SETTLE_MS = 4000
/** A reply still missing its closing MODEL_SELF_REPORT line is read only after this long unchanged. */
const INCOMPLETE_MS = 30_000
/** How long a sign-in may take before the pane gives up and cleans up. */
const SIGNIN_MS = 10 * 60_000

/** Grace past a seat's own limit: Codex outlives its alarm and writes late. */
const LATE_MS = 180_000
/** The Claude seat's limit: the convener saves its reply to claude.md when the subagent hands back. */
const CLAUDE_MS = 30 * 60_000
/** How long a run dir is watched for ruling.json, and the ceiling on all polling of a round. */
const WATCH_MS = 60 * 60_000

// Module state: lost on reload, and only ever a cache of what $.state holds.
const watch = new Map<string, { lastRulingMtime?: number }>()
/** A Claude seat's subagent id, and its Agent call's id, to the round it serves. */
const claudeAgents = new Map<string, string>()
const claudeCalls = new Map<string, string>()
const claudeSpawned = new Map<string, string>()
const growing = new Map<string, { size: number; mtimeMs: number; since: number }>()
let timer: Timer | undefined
let ticks = 0

// ───────────── files: $.fs first, `cat`/`stat` when $.fs is refused outside the project ─────────────

/** Directories where $.fs failed but the shell read the file: skip $.fs there from then on. */
const fsRefused = new Set<string>()
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  if (!fsRefused.has(dirOf(path))) {
    try {
      return await $.fs.read(path)
    } catch {
      // Missing, or refused: the shell tells them apart below.
    }
  }
  const r = await $.process.run(['cat', path]).catch(() => undefined)
  if (r && r.exitCode === 0) {
    fsRefused.add(dirOf(path))
    return r.stdout
  }
  return undefined
}

async function statFile($: EngineInterface, path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  if (!fsRefused.has(dirOf(path))) {
    try {
      const s = await $.fs.stat(path)
      return { size: s.size, mtimeMs: s.mtimeMs }
    } catch {
      // Missing, or refused: the shell tells them apart below.
    }
  }
  const r = await $.process.run(['stat', '-f', '%z %m', path]).catch(() => undefined)
  if (!r || r.exitCode !== 0) return undefined
  fsRefused.add(dirOf(path))
  const [size, mtime] = r.stdout.trim().split(' ').map(Number)
  return size === undefined || mtime === undefined ? undefined : { size, mtimeMs: mtime * 1000 }
}

// ───────────── state helpers ─────────────

async function patchRound($: EngineInterface, id: string, fn: (r: Round) => Round) {
  await update($, decisions, ds => ds.map(d => (d.rounds.some(r => r.id === id) ? { ...d, rounds: d.rounds.map(r => (r.id === id ? fn(r) : r)) } : d)))
}

const patchSeat = (name: SeatName, fn: (s: Seat) => Seat) => (r: Round): Round => ({ ...r, seats: r.seats.map(s => (s.name === name ? fn(s) : s)) })

async function findRound($: EngineInterface, id: string): Promise<Round | undefined> {
  for (const d of await read($, decisions)) for (const r of d.rounds) if (r.id === id) return r
  return undefined
}

async function openRound($: EngineInterface, dispatch: Dispatch, meta: Meta | undefined, at: number): Promise<string> {
  const ident = runIdentity(dispatch.run)
  const decisionId = meta?.decision ?? ident.decision
  const loop = meta?.loop ?? ident.loop
  const id = `${dispatch.run}#${dispatch.round}`
  const benched = new Set(meta?.benched ?? [])
  const make = (name: SeatName): Seat => {
    const model = meta?.seats?.[name]
    if (benched.has(name)) return { name, model, status: 'benched', reads: 0, note: 'benched earlier this session' }
    if (name === 'claude') return { name, model, status: 'queued', reads: 0 }
    return dispatch.seats.includes(name)
      ? { name, model, status: 'running', startedAt: at, deadline: at + dispatch.limitMs + LATE_MS, reads: 0 }
      : { name, model, status: 'benched', reads: 0, note: 'not dispatched' }
  }
  await update($, decisions, ds => {
    const existing = ds.find(d => d.id === decisionId)
    const prior = existing?.rounds.find(r => r.id === id)
    // A §3 retry re-dispatches some seats into the same round: restart just those.
    const round: Round = prior
      ? {
          ...prior,
          endedAt: undefined,
          seats: prior.seats.map(s => (dispatch.seats.includes(s.name)
            ? { ...s, status: 'running', startedAt: at, endedAt: undefined, deadline: at + dispatch.limitMs + LATE_MS, note: undefined, reply: undefined, reads: 0 }
            : s)),
        }
      : { id, run: dispatch.run, loop, round: dispatch.round, startedAt: at, seats: (['codex', 'gemini', 'grok', 'claude'] as const).map(make) }
    const decision: Decision = existing
      ? { ...existing, title: meta?.title ?? existing.title, mode: meta?.mode ?? existing.mode, rounds: prior ? existing.rounds.map(r => (r.id === id ? round : r)) : [...existing.rounds, round] }
      : { id: decisionId, title: meta?.title ?? decisionId.replace(/[-_]/g, ' '), mode: meta?.mode, rounds: [round] }
    return [...ds.filter(d => d.id !== decisionId), decision]
  })
  await update($, selected, s => ({ ...s, decision: decisionId, round: undefined, seat: undefined }))
  return id
}

/** The round a Claude seat joins: the newest one in its round number started in the last two minutes. */
/** The round a Claude seat call serves, from what is already recorded: no waiting. */
async function claudeRoundNow($: EngineInterface, roundNo: number, at: number): Promise<string | undefined> {
  const all = (await read($, decisions)).flatMap(d => d.rounds)
  const newest = (rs: Round[]) => rs.sort((a, b) => b.startedAt - a.startedAt)[0]?.id
  return newest(all.filter(r => r.round === roundNo && at - r.startedAt < 120_000))
    // A retry: the newest recent round whose Claude seat is still waiting, or failed.
    ?? newest(all.filter(r => at - r.startedAt < 30 * 60_000 && r.seats.some(s => s.name === 'claude' && ['queued', 'unavailable', 'timeout', 'unparsed'].includes(s.status))))
}

/** The Agent call can land just before the Bash dispatch of the same message: wait up to 5 s for it. */
async function claudeRoundSoon($: EngineInterface, roundNo: number, at: number): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    await $.clock.sleep(250)
    const id = await claudeRoundNow($, roundNo, at)
    if (id) return id
  }
  return undefined
}

// ───────────── polling ─────────────

async function pollSeat($: EngineInterface, r: Round, s: Seat, at: number) {
  const base = `${r.run}/${s.name}`
  const md = await statFile($, `${base}.md`)
  // Fresh means written since this seat (re)started: a retry or round 2 never reads the last attempt's file.
  const fresh = md && md.size > 0 && md.mtimeMs >= (s.startedAt ?? r.startedAt) - 2000
  if (fresh) {
    // Wait for the file to settle: a redirect writes it as the reply streams.
    const key = `${r.id}:${s.name}`
    const prev = growing.get(key)
    if (!prev || prev.size !== md.size || prev.mtimeMs !== md.mtimeMs) {
      growing.set(key, { size: md.size, mtimeMs: md.mtimeMs, since: at })
      return
    }
    if (at - prev.since < SETTLE_MS) return
    const text = await readText($, `${base}.md`)
    if (text && text.trim()) {
      const reply = parseReply(text)
      // The reply format ends with MODEL_SELF_REPORT: without it the seat may only have paused, so wait 30 s.
      if (!reply?.selfReport && at - prev.since < INCOMPLETE_MS) return
      growing.delete(key)
      await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, status: reply ? 'done' : 'unparsed', endedAt: at, reply: reply ?? { risks: [], disagreements: [], gaps: [], wouldChange: [], raw: text.slice(0, 20_000) } })))
      return
    }
  }
  if (s.name === 'claude') {
    if (s.deadline !== undefined && at > s.deadline) await patchRound($, r.id, patchSeat('claude', x => ({ ...x, status: 'timeout', note: 'no reply saved to claude.md', endedAt: at })))
    return
  }
  if (ticks % 3 !== 0) return
  // Live reads: Grok's tool results in its stream, Codex's exec lines.
  const log = s.name === 'grok' ? await readText($, `${base}.ndjson`) : s.name === 'codex' ? await readText($, `${base}.stderr`) : undefined
  if (log !== undefined) {
    const reads = s.name === 'grok' ? (log.match(/"type":"user"/g) ?? []).length : (log.match(/^exec\b/gm) ?? []).length
    if (reads !== s.reads) await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, reads })))
  }
  const err = await readText($, `${base}.stderr`)
  const verdict = err ? stderrVerdict(err, s.name) : undefined
  if (verdict) {
    await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, status: verdict.status, note: verdict.note, fix: verdict.fix, endedAt: at })))
  } else if (s.deadline !== undefined && at > s.deadline) {
    await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, status: 'timeout', note: 'no reply within its time limit', endedAt: at })))
  }
}

/** Only the reply file: a seat already marked failed that still answers is shown as answered. */
async function pollReply($: EngineInterface, r: Round, s: Seat, at: number) {
  const md = await statFile($, `${r.run}/${s.name}.md`)
  const since = Math.max((s.startedAt ?? r.startedAt) - 2000, s.status === 'done' || s.status === 'unparsed' ? (s.endedAt ?? 0) : 0)
  if (!md || md.size === 0 || md.mtimeMs <= since || at - md.mtimeMs < SETTLE_MS) return
  const text = await readText($, `${r.run}/${s.name}.md`)
  const reply = text ? parseReply(text) : undefined
  if (reply) await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, status: 'done', note: undefined, fix: undefined, endedAt: at, reply })))
  else if (s.status === 'done') await patchRound($, r.id, patchSeat(s.name, x => ({ ...x, endedAt: at })))
}

async function pollRuling($: EngineInterface, run: string, at: number) {
  const w = watch.get(run)
  const st = await statFile($, `${run}/ruling.json`)
  if (!st || st.mtimeMs === w?.lastRulingMtime) return
  const text = await readText($, `${run}/ruling.json`)
  const ruling = text ? parseRuling(text) : undefined
  if (!ruling) return
  watch.set(run, { ...w, lastRulingMtime: st.mtimeMs })
  await patchRound($, `${run}#${ruling.round}`, r => ({ ...r, ruling }))
  void at
}

async function tick($: EngineInterface) {
  ticks += 1
  const at = await $.clock.now()
  // Elapsed times move in 5 s steps: a write here redraws every reader of `now`.
  if (ticks % 5 === 1) await update($, now, () => at)
  let isBusy = false
  for (const d of await read($, decisions)) {
    for (const r of d.rounds) {
      if (!watch.has(r.run) || at - r.startedAt > WATCH_MS) continue
      for (const s of r.seats) {
        if (s.status === 'running') {
          isBusy = true
          await pollSeat($, r, s, at)
        } else if ((s.status === 'unavailable' || s.status === 'timeout') && (s.name === 'claude' || (s.deadline !== undefined && at < s.deadline + LATE_MS))) {
          // A stderr verdict can be wrong, Codex can write after its alarm, and the convener can save
          // Claude's hand-back late: keep reading the reply file.
          isBusy = true
          await pollReply($, r, s, at)
        } else if (s.name === 'claude' && s.status === 'queued') {
          await pollReply($, r, s, at)
          if (at - r.startedAt > 15 * 60_000) {
            await patchRound($, r.id, patchSeat('claude', x => (x.status === 'queued' ? { ...x, status: 'unavailable', note: 'no Claude seat was dispatched', endedAt: at } : x)))
          } else {
            isBusy = true
          }
        } else if ((s.status === 'done' || s.status === 'unparsed') && ticks % 5 === 0) {
          // A reply file rewritten after it was read (a retry, a late finish) is read again.
          await pollReply($, r, s, at)
        }
      }
      // The round ends when its last seat does.
      const fresh = await findRound($, r.id)
      if (fresh && fresh.endedAt === undefined && fresh.seats.every(isTerminal)) {
        const last = Math.max(fresh.startedAt, ...fresh.seats.map(x => x.endedAt ?? 0))
        await patchRound($, r.id, x => ({ ...x, endedAt: last }))
      }
      // Watch for the ruling until this round has one; a later rewrite arrives through the Write hook.
      if (!r.ruling) {
        isBusy = true
        if (ticks % 3 === 0) await pollRuling($, r.run, at)
      }
    }
  }
  if (!isBusy) stopPolling()
}

function startPolling($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(1000, () => void tick($))
}

function stopPolling() {
  timer?.cancel()
  timer = undefined
}

async function loadMeta($: EngineInterface, run: string): Promise<Meta | undefined> {
  const text = await readText($, `${run}/meta.json`)
  return text ? parseMeta(text) : undefined
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Panel' })
}

async function view($: EngineInterface): Promise<ViewData> {
  const ds = await read($, decisions)
  const sel = await read($, selected)
  const decision = ds.find(d => d.id === sel.decision) ?? ds[ds.length - 1]
  const round = decision?.rounds.find(r => r.id === sel.round) ?? newestRound(decision)
  return { decisions: [...ds].reverse(), decision, round, selected: sel, now: await read($, now), fixes: await read($, fixes) }
}

// ───────────── repairs ─────────────

async function setFix($: EngineInterface, seat: SeatName, fix: Omit<FixState, 'at'>) {
  const at = await $.clock.now()
  await update($, fixes, f => ({ ...f, [seat]: { ...fix, at } }))
}

/** Signs a seat's CLI in again, then cleans up whatever it started. */
async function signIn($: EngineInterface, seat: SeatName) {
  if (seat === 'claude') return
  const plan = SIGNIN[seat]
  const home = (await $.env.get('HOME')) ?? ''
  if ((await read($, fixes))[seat]?.state === 'running') return
  await setFix($, seat, { state: 'running', message: plan.detail })
  try {
    if (plan.kind === 'process') {
      try {
        const r = await $.process.run(plan.argv(home), { timeoutMs: SIGNIN_MS })
        if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.exitCode}`)
      } catch (err) {
        // A login left waiting on the browser is ended here, whatever the timeout did to it.
        await $.process.run(['pkill', '-f', `${seat} login`]).catch(() => undefined)
        throw err
      }
    } else {
      await signInThroughTerminal($, plan.command, plan.tokenFile(home))
    }
    await setFix($, seat, { state: 'done', message: 'Signed in. Retry the seat to run it again.' })
    $.ui.toast(`${plan.label.replace('Sign in to ', '')} is signed in`)
  } catch (err) {
    await setFix($, seat, { state: 'failed', message: `Sign-in did not finish: ${String((err as Error).message ?? err).slice(0, 160)}` })
  }
}

/** agy signs in from its interactive screen: run it in a Terminal window, wait for the token, then close it. */
async function signInThroughTerminal($: EngineInterface, command: string, tokenFile: string) {
  const before = (await statFile($, tokenFile))?.mtimeMs ?? 0
  const open = await $.process.run(['osascript',
    '-e', 'tell application "Terminal"',
    '-e', `set t to do script "clear; echo 'Sign in with Google in the browser that opens. This window closes by itself once you are signed in.'; ${command}; exit"`,
    '-e', 'activate',
    '-e', 'return tty of t',
    '-e', 'end tell'])
  const tty = open.stdout.trim()
  if (open.exitCode !== 0 || !tty.startsWith('/dev/')) throw new Error(open.stderr.trim() || 'Terminal did not open')
  const start = await $.clock.now()
  let isSignedIn = false
  try {
    while ((await $.clock.now()) - start < SIGNIN_MS) {
      await $.clock.sleep(2000)
      // Signed in once the token was rewritten and has stayed put for one more poll (no partial write).
      const st = await statFile($, tokenFile)
      if (st && st.size > 0 && st.mtimeMs > before) {
        await $.clock.sleep(2000)
        const again = await statFile($, tokenFile)
        if (again && again.mtimeMs === st.mtimeMs && again.size === st.size) {
          isSignedIn = true
          break
        }
      }
    }
  } finally {
    // Clean up: end agy and its shell on that terminal only, then close the window.
    await $.process.run(['pkill', '-t', tty.replace('/dev/', '')]).catch(() => undefined)
    await $.process.run(['osascript',
      '-e', 'tell application "Terminal"',
      '-e', `repeat with w in windows`,
      '-e', `if (tty of selected tab of w) is "${tty}" then close w`,
      '-e', 'end repeat',
      '-e', 'end tell']).catch(() => undefined)
  }
  if (!isSignedIn) throw new Error('no new token within 10 minutes')
}

/** Asks the convener to run a repaired seat again, through the skill's own retry rule. */
async function retrySeat($: EngineInterface, seat: SeatName) {
  const r = (await view($)).round
  if (!r) return
  const why = (await read($, fixes))[seat]?.state === 'done' ? 'is signed in again' : `ended as ${r.seats.find(s => s.name === seat)?.status ?? 'failed'}`
  try {
    await $.prompt.submit({ text: `The ${seat} seat of the panel run in ${r.run} ${why}. Retry that seat alone for round ${r.round}, as SKILL.md §3 retries a seat: the §2 command with only that seat's subshell, keeping its roster.json read and RUN=${r.run}. Then fold its reply into the synthesis.` })
    await update($, fixes, f => ({ ...f, [seat]: undefined }))
  } catch (err) {
    $.ui.toast(`Could not ask for the retry: ${String((err as Error).message ?? err).slice(0, 120)}`)
  }
}

function actions($: EngineInterface): Actions {
  const set = (fn: (s: Selected) => Selected) => void update($, selected, fn)
  return {
    signIn: seat => void signIn($, seat),
    retry: seat => void retrySeat($, seat),
    tab: t => set(s => ({ ...s, tab: t })),
    round: id => set(s => ({ ...s, round: id, tab: 'live', seat: undefined })),
    decision: id => set(s => ({ ...s, decision: id, round: undefined, tab: 'live', seat: undefined })),
    seat: seat => set(s => ({ ...s, seat })),
    filter: filter => set(s => ({ ...s, filter })),
    group: findGroup => set(s => ({ ...s, findGroup })),
    toggleSeat: seat => set(s => ({ ...s, findSeats: s.findSeats?.includes(seat) ? s.findSeats.filter(x => x !== seat) : [...(s.findSeats ?? []), seat] })),
    toggleKind: kind => set(s => ({ ...s, findKinds: s.findKinds?.includes(kind) ? s.findKinds.filter(x => x !== kind) : [...(s.findKinds ?? []), kind] })),
    query: findQuery => set(s => ({ ...s, findQuery })),
    toggle: id => set(s => ({ ...s, expanded: s.expanded?.includes(id) ? s.expanded.filter(x => x !== id) : [...(s.expanded ?? []), id].slice(-200) })),
    expandAll: ids => set(s => ({ ...s, expanded: [...new Set([...(s.expanded ?? []), ...ids])].slice(-200) })),
    collapseAll: () => set(s => ({ ...s, expanded: [] })),
    openReply: seat => set(s => ({ ...s, tab: 'live', seat })),
  }
}

// ───────────── hooks ─────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel-view', description: 'Open the multi-model panel view' })
    // A reload drops a sign-in's process handle: show it as interrupted, so its button comes back.
    await update($, fixes, f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v?.state === 'running' ? { ...v, state: 'failed', message: 'Sign-in was interrupted by a reload.' } : v])))
    return next(e)
  })

  on('command.run', { command: 'panel-view' }, async $ => {
    await openPane($)
    return { text: 'Panel view opened.' }
  })

  // The §2 dispatch: the CLI seats run inside this one Bash call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const dispatch = detectDispatch(e.command)
    if (!dispatch) return next(e)
    const at = await $.clock.now()
    const id = await openRound($, dispatch, await loadMeta($, dispatch.run), at)
    watch.set(dispatch.run, { ...watch.get(dispatch.run) })
    await update($, fixes, f => Object.fromEntries(Object.entries(f).filter(([k]) => !dispatch.seats.includes(k as SeatName))))
    startPolling($)
    void openPane($)
    const ran = await next(e)
    // A backgrounded dispatch returns at once; its seats keep their own deadlines, so nothing ends here.
    void id
    void tick($)
    return ran
  }).catch(($, e, next) => next(e))

  // The Claude seat: a subagent whose description names it.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (e.description.startsWith('Panel seat') && r.agentId) {
      claudeSpawned.set(e.tool_use_id, r.agentId)
      const round = claudeCalls.get(e.tool_use_id)
      if (round) claudeAgents.set(r.agentId, round)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (!e.description.startsWith('Panel seat')) return next(e)
    const at = await $.clock.now()
    // Round 2 only by §5's own markers: a packet that merely mentions round 2 is still round 1.
    const roundNo = /YOUR ROUND-1 REPLY \(you wrote this|round2-claude\.md/.test(e.prompt) ? 2 : 1
    const attach = async (id: string) => {
      claudeCalls.set(e.tool_use_id, id)
      const agent = claudeSpawned.get(e.tool_use_id)
      if (agent) claudeAgents.set(agent, id)
      await patchRound($, id, patchSeat('claude', s => ({ ...s, status: 'running', startedAt: at, endedAt: undefined, deadline: at + CLAUDE_MS, reply: undefined, note: undefined, model: s.model ?? e.subagent_type })))
      startPolling($)
    }
    let id = await claudeRoundNow($, roundNo, at)
    if (id) await attach(id)
    // Never hold the Agent call: when its round is not recorded yet, look for it while the call runs.
    const pending = next(e)
    if (!id) {
      id = await claudeRoundSoon($, roundNo, at)
      if (id) await attach(id)
    }
    const ran = await pending
    if (!id) return ran
    const end = await $.clock.now()
    if (ran.deny !== undefined || ran.isError) {
      const msg = ran.deny ?? ran.text ?? 'the Agent call failed'
      const v = stderrVerdict(`error: ${msg}`)
      await patchRound($, id, patchSeat('claude', s => ({ ...s, status: v?.status ?? 'unavailable', note: (v?.note ?? msg).slice(0, 200), endedAt: end })))
      return ran
    }
    // A foreground call carries the reply; a background one (the default) hands back later,
    // and the convener saves it to $RUN/claude.md, which the poll reads.
    const res = ran.result as { content?: { text?: string }[]; totalToolUseCount?: number; resolvedModel?: string } | undefined
    const text = (res?.content ?? []).map(c => c.text ?? '').join('\n')
    const reply = text.trim() ? parseReply(text) : undefined
    if (reply) {
      await patchRound($, id, patchSeat('claude', s => ({ ...s, status: 'done', endedAt: end, reads: res?.totalToolUseCount ?? s.reads, model: res?.resolvedModel ?? s.model, reply })))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The Claude seat's own tool calls: its live read count.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId === undefined ? undefined : claudeAgents.get(e.agentId)
    if (!id) return next(e)
    await patchRound($, id, patchSeat('claude', s => (s.status === 'running' ? { ...s, reads: s.reads + 1 } : s)))
    return next(e)
  }).catch(($, e, next) => next(e))

  // meta.json and ruling.json written by the convener.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    const m = /^(.*)\/(ruling|meta)\.json$/.exec(e.file_path)
    if (m) {
      const run = m[1]!
      const at = await $.clock.now()
      if (m[2] === 'ruling') {
        watch.set(run, { ...watch.get(run), lastRulingMtime: undefined })
        await pollRuling($, run, at)
      } else {
        const meta = await loadMeta($, run)
        if (meta?.title) await update($, decisions, ds => ds.map(d => (d.rounds.some(r => r.run === run) ? { ...d, title: meta.title ?? d.title, mode: meta.mode ?? d.mode } : d)))
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = await view($)
    const act = actions($)
    if (e.surface === 'desktop') return desktopPane($.ui.resolve(e), data, act)
    if (e.surface === 'terminal') return terminalPane($.ui.resolve(e), data, act, e.props.bodyColumns)
    const { Text } = $.ui.resolve(e)
    return <Text>{chip(data.round) ?? 'No panel yet.'}</Text>
  })

  // The footer: whatever is beneath, then a button that (re)opens the pane, once a panel has run this session.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const inner = await next(e)
    const r = newestRound((await read($, decisions)).at(-1))
    const label = chip(r)
    if (!label || (e.surface !== 'desktop' && e.surface !== 'terminal')) return inner
    const open = () => void openPane($)
    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {inner}
          <Svg key="svg-panelIconSource-1" source={panelIconSource(chipIsLive(r), 14)} alt="panel" width={14} height={14} />
          <Button key="panel-open" plain onPress={open}>{label}</Button>
        </Box>
      )
    }
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        {inner}
        <Button key="panel-open" plain onPress={open}>{label}</Button>
      </Box>
    )
  })
}
