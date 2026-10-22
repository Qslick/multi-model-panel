import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The tool stubs answer loosely typed records: per-tool result types nest too deep for tsc (TS2589), as in grove.
type ToolStub = (event: 'tool.call', matcher: { tool: string }, hook: () => Promise<unknown>) => void
const stubTools = (on: On) => on as unknown as ToolStub

const RUN = '/tmp/scratch/panel-mod-design'
const reply = (v: string, risk: string) => `VERDICT: ${v}\nCONFIDENCE: high\nTOP_RISKS:\n- [S1] ${risk}\nDISAGREEMENTS:\n- none\nGAPS:\n- none\nWOULD_CHANGE_MY_MIND:\n- none\nMODEL_SELF_REPORT: m`
const DISPATCH = (input: string) => `RUN=${RUN}; ROSTER=~/.claude/skills/multi-model-panel/roster.json
( codex exec -s read-only -o "$RUN/codex.md" - < "$RUN/${input}" ) &
( ~/.local/bin/agy -p x > "$RUN/gemini.md" ) &
( ~/.grok/bin/grok --prompt-file "$RUN/${input}" ) &
wait`
const PANE = { title: 'Panel', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

test('a panel run fills the pane: seats, verdicts, split, ruling, and rounds accumulate', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(1_000_000)
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const put = (name: string, text: string) => files.set(`${RUN}/${name}`, { text, mtimeMs: clock.now() })
  on('fs.read', ($, e) => {
    const f = files.get(e.path)
    if (!f) return { deny: 'ENOENT' }
    return { value: f.text }
  })
  on('fs.stat', ($, e) => {
    const f = files.get(e.path)
    if (!f) return { deny: 'ENOENT' }
    return { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  put('meta.json', JSON.stringify({ decision: 'mod-design', title: 'Build the panel-view mod', mode: 'plan', loop: 1, seats: { codex: 'gpt-6-sol/high' } }))

  // Round 1: the CLI seats write while the dispatch runs; Claude answers through Agent.
  stubTools(on)('tool.call', { tool: 'Bash' }, async () => {
    await clock.advance(5_000)
    put('codex.md', reply('REJECT', 'Polling may be refused'))
    put('gemini.md', reply('APPROVE_WITH_CHANGES', 'Cap reply size'))
    put('grok.md', reply('APPROVE_WITH_CHANGES', 'Cap reply size'))
    return { result: { stdout: 'done', stderr: '', interrupted: false } as never }
  })
  stubTools(on)('tool.call', { tool: 'Agent' }, async () => ({
    result: { agentId: 'a1', content: [{ type: 'text', text: reply('APPROVE', 'none really') }], totalToolUseCount: 4, totalDurationMs: 1, totalTokens: 1, resolvedModel: 'claude-opus-5-5' } as never,
  }))
  stubTools(on)('tool.call', { tool: 'Write' }, async () => ({ result: {} as never }))

  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md') } as never)
  await $.tool.call({ tool: 'Agent', description: 'Panel seat: Claude', prompt: 'packet' } as never)
  await clock.advance(8_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'panel-view', surface, component: 'Pane', requestId: 'panel-view', props: PANE })
    await ui.press({ key: 'tab-live' })
    expect(await ui.find({ type: 'Text', text: /Build the panel-view mod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 Reject/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Split: a seat rejects/ })).toBeDefined()
    await ui.press({ key: 'tab-findings' })
    expect(await ui.find({ type: 'Text', text: /Polling may be refused/ })).toBeDefined()
    await ui.unmount()
  }

  // The convener rules on round 1.
  put('ruling.json', JSON.stringify({ round: 1, outcome: 'proceed_with_changes', summary: 'Add the cat fallback', points: [
    { id: 'p1', text: 'Polling may be refused', seats: ['codex'], bucket: 'gap', severity: 'S1', ruling: 'accept_with_revision', reason: 'fallback to cat' },
  ] }))
  await $.tool.call({ tool: 'Write', file_path: `${RUN}/ruling.json`, content: '' } as never)

  // Round 2 overwrites the reply files.
  await clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', command: DISPATCH('round2-codex.md') } as never)
  await clock.advance(8_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'panel-view', surface, component: 'Pane', requestId: 'panel-view', props: PANE })
    await ui.press({ key: 'tab-rounds' })
    expect(await ui.find({ type: 'Text', text: /Loop 1 · Round 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Loop 1 · Round 2/ })).toBeDefined()
    await ui.press({ key: `r-${RUN}#1` })
    await ui.press({ key: 'tab-rulings' })
    // The reason sits inside the collapsed card: open it first.
    if (!(await ui.find({ type: 'Text', text: /fallback to cat/ }))) await ui.press({ key: 'pt-p1' })
    expect(await ui.find({ type: 'Text', text: /fallback to cat/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a background Claude seat and a backgrounded dispatch still land, and the footer reopens the pane', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(5_000_000)
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const put = (name: string, text: string) => files.set(`${RUN}/${name}`, { text, mtimeMs: clock.now() })
  on('fs.read', ($, e) => (files.get(e.path) ? { value: files.get(e.path)!.text } : { deny: 'ENOENT' }))
  on('fs.stat', ($, e) => {
    const f = files.get(e.path)
    return f ? { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } : { deny: 'ENOENT' }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  let opened = 0
  on('ui.open', () => { opened += 1; return { value: { isPlaced: true } } })
  on('ui.render', { component: 'SessionMode' }, ($, e) => $.ui.resolve(e).Text({ dimColor: true, children: e.props.modes.join(' & ') }))
  // run_in_background: the call returns before any seat has answered.
  stubTools(on)('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } as never }))
  stubTools(on)('tool.call', { tool: 'Agent' }, async () => ({ result: { status: 'async_launched', agentId: 'a9', description: 'Panel seat: Claude', prompt: '' } as never }))

  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md'), run_in_background: true } as never)
  await $.tool.call({ tool: 'Agent', description: 'Panel seat: Claude', prompt: 'Read packet.md' } as never)

  // A minute later the seats land, and the convener saves Claude's hand-back to claude.md.
  await clock.advance(60_000)
  put('codex.md', reply('APPROVE', 'none'))
  put('gemini.md', reply('APPROVE', 'none'))
  put('grok.md', reply('APPROVE_WITH_CHANGES', 'a nit'))
  put('claude.md', reply('APPROVE', 'none'))
  await clock.advance(10_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'panel-view', surface, component: 'Pane', requestId: 'panel-view', props: PANE })
    await ui.press({ key: 'tab-live' })
    expect(await ui.find({ type: 'Text', text: /4 of 4 seats answered|4\/4 answered/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 Approve, 1 Approve with changes/ })).toBeDefined()
    await ui.unmount()

    const foot = await $.ui.mount({ plugin: 'panel-view', surface, component: 'SessionMode', props: { modes: [] } })
    const before = opened
    await foot.press({ key: 'panel-open' })
    expect(opened).toBe(before + 1)
    await foot.unmount()
  }
})

const ROOT = '/tmp/scratch'
function rig(on: On, clock: { now: () => number }) {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const put = (path: string, text: string) => files.set(path, { text, mtimeMs: clock.now() })
  const runs: string[][] = []
  const submitted: string[] = []
  on('fs.read', ($, e) => (files.get(e.path) ? { value: files.get(e.path)!.text } : { deny: 'ENOENT' }))
  on('fs.stat', ($, e) => {
    const f = files.get(e.path)
    return f ? { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } : { deny: 'ENOENT' }
  })
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const out = e.argv[0] === 'osascript' && e.argv.join(' ').includes('do script') ? '/dev/ttys009\n' : ''
    // cat and stat stand for files $.fs can read: they fail here, as on a missing file.
    const exitCode = e.argv[0] === 'cat' || e.argv[0] === 'stat' ? 1 : 0
    return { value: { exitCode, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { drop: 'captured by the test' } as never })
  stubTools(on)('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  return { files, put, runs, submitted }
}

test('a seat that needs signing in gets a button; Gemini signs in through Terminal and cleans up after itself', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(9_000_000)
  const { put, runs, submitted } = rig(on, clock)
  const run = `${ROOT}/panel-signin`
  put('/Users/test/.gemini/antigravity-cli/antigravity-oauth-token', 'old')
  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run) } as never)
  put(`${run}/gemini.stderr`, 'You are not logged into Antigravity.')
  put(`${run}/codex.stderr`, 'ERROR: 401 Unauthorized')
  await clock.advance(4_000)

  const ui = await $.ui.mount({ plugin: 'panel-view', surface: 'desktop', component: 'Pane', requestId: 'panel-view', props: PANE })
  await ui.press({ key: 'tab-live' })
  expect(await ui.find({ key: 'signin-gemini' })).toBeDefined()
  expect(await ui.find({ key: 'signin-codex' })).toBeDefined()
  expect(await ui.find({ key: 'signin-grok' })).toBeUndefined()

  // Gemini: a Terminal window runs agy; the token updates; the window's processes end and it closes.
  await ui.press({ key: 'signin-gemini' })
  expect(runs.some(a => a[0] === 'osascript' && a.join(' ').includes('~/.local/bin/agy'))).toBe(true)
  put('/Users/test/.gemini/antigravity-cli/antigravity-oauth-token', 'new')
  // One poll sees the new token, the next confirms it settled.
  await clock.advance(7_000)
  expect(runs).toContainEqual(['pkill', '-t', 'ttys009'])
  expect(runs.some(a => a[0] === 'osascript' && a.join(' ').includes('close w'))).toBe(true)
  expect(await ui.find({ key: 'retry-gemini' })).toBeDefined()

  // Codex: its own login command, run to completion.
  await ui.press({ key: 'signin-codex' })
  await clock.advance(1_000)
  expect(runs).toContainEqual(['/bin/zsh', '-lc', 'codex login'])
  expect(await ui.find({ key: 'retry-codex' })).toBeDefined()

  // Retry asks the convener to rerun the seat under the skill's own rule.
  await ui.press({ key: 'retry-gemini' })
  expect(submitted.at(-1)).toMatch(/gemini seat .* Retry that seat alone/)
  await ui.unmount()

  for (const surface of ['terminal'] as const) {
    const t = await $.ui.mount({ plugin: 'panel-view', surface, component: 'Pane', requestId: 'panel-view', props: PANE })
    await t.press({ key: 'tab-live' })
    expect(await t.find({ key: 'retry-codex' })).toBeDefined()
    await t.unmount()
  }
})

test('a reply file that grows mid-dispatch is read once it settles, and a loop-2 run joins the same decision', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(20_000_000)
  const { put } = rig(on, clock)
  const run1 = `${ROOT}/panel-grow`
  put(`${run1}/meta.json`, JSON.stringify({ decision: 'grow', title: 'Growing files', loop: 1 }))
  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run1) } as never)
  put(`${run1}/gemini.md`, 'Reading the files first…\nVERDICT: APP')
  await clock.advance(2_000)
  put(`${run1}/gemini.md`, `Reading the files first…\n${reply('REJECT', 'Grows mid-write')}`)
  await clock.advance(8_000)
  put(`${run1}/codex.md`, reply('REJECT', 'x'))
  put(`${run1}/grok.md`, reply('REJECT', 'y'))
  await clock.advance(8_000)

  const run2 = `${ROOT}/panel-grow-loop2`
  put(`${run2}/meta.json`, JSON.stringify({ decision: 'grow', title: 'Growing files', loop: 2 }))
  await clock.advance(60_000)
  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run2) } as never)
  await clock.advance(1_000)

  const ui = await $.ui.mount({ plugin: 'panel-view', surface: 'terminal', component: 'Pane', requestId: 'panel-view', props: PANE })
  await ui.press({ key: 'tab-rounds' })
  expect(await ui.find({ type: 'Text', text: /Loop 1 · Round 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Loop 2 · Round 1/ })).toBeDefined()
  await ui.press({ key: `r-${run1}#1` })
  await ui.press({ key: 'tab-findings' })
  expect(await ui.find({ type: 'Text', text: /Grows mid-write/ })).toBeDefined()
  await ui.unmount()
})

test('loop-2 findings: echoed packet text, late replies, a retried Claude seat, a Bash-written ruling, and a refused $.fs', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(40_000_000)
  const run = `${ROOT}/panel-loop2-findings`
  // $.fs is refused for this run dir; the shell reads it.
  const disk = new Map<string, { text: string; mtimeMs: number }>()
  const put = (name: string, text: string) => disk.set(`${run}/${name}`, { text, mtimeMs: clock.now() })
  let fsCalls = 0
  on('fs.read', () => { fsCalls += 1; return { deny: 'outside the project' } })
  on('fs.stat', () => { fsCalls += 1; return { deny: 'outside the project' } })
  on('process.run', ($, e) => {
    const [cmd, ...rest] = e.argv
    const f = disk.get(rest.at(-1) ?? '')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'cat') return f ? ok(f.text) : { value: { exitCode: 1, stdout: '', stderr: 'No such file', isStdoutTruncated: false, isStderrTruncated: false } }
    if (cmd === 'stat') return f ? ok(`${f.text.length} ${Math.floor(f.mtimeMs / 1000)}`) : { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  stubTools(on)('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  let agentCalls = 0
  stubTools(on)('tool.call', { tool: 'Agent' }, async () => {
    agentCalls += 1
    return agentCalls === 1 ? { deny: 'Agent type not found' } : { result: { status: 'async_launched', agentId: 'a2' } as never }
  })

  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run) } as never)
  // Codex echoes the packet into stderr: words like "unauthenticated" there are not a failure.
  put('codex.stderr', 'user\nAUTH_RE = /unauthenticated|401|keyring/\nexec rg -n "401" parse.ts\n  62: unauthenticated|keyring')
  await clock.advance(4_000)
  // The first Claude call fails; the §2 fallback call minutes later must still join this round.
  await $.tool.call({ tool: 'Agent', description: 'Panel seat: Claude', prompt: 'packet' } as never)
  await clock.advance(180_000)
  await $.tool.call({ tool: 'Agent', description: 'Panel seat: Claude', prompt: 'packet', subagent_type: 'general-purpose' } as never)
  put('codex.md', reply('APPROVE_WITH_CHANGES', 'a'))
  put('gemini.md', reply('APPROVE', 'b'))
  put('grok.md', reply('APPROVE', 'c'))
  put('claude.md', reply('APPROVE', 'd'))
  await clock.advance(12_000)
  // The convener writes the ruling with Bash, not the Write tool.
  put('ruling.json', JSON.stringify({ round: 1, outcome: 'proceed', points: [{ id: 'p1', text: 'Ship it', seats: ['Codex'], ruling: 'accept' }] }))
  await clock.advance(6_000)

  const ui = await $.ui.mount({ plugin: 'panel-view', surface: 'terminal', component: 'Pane', requestId: 'panel-view', props: PANE })
  await ui.press({ key: 'tab-live' })
  expect(await ui.find({ type: 'Text', text: /3 Approve, 1 Approve with changes/ })).toBeDefined()
  expect(await ui.find({ key: 'signin-codex' })).toBeUndefined()
  await ui.press({ key: 'tab-rulings' })
  expect(await ui.find({ type: 'Text', text: /Ship it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Codex/ })).toBeDefined()
  await ui.unmount()
  // $.fs is tried until the shell first reads a file there, then skipped: about 200 polls, a handful of $.fs calls.
  expect(fsCalls).toBeLessThan(20)
})

test('a reply that pauses mid-write is not frozen early, and a packet that only mentions round2- stays round 1', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(60_000_000)
  const { put } = rig(on, clock)
  stubTools(on)('tool.call', { tool: 'Agent' }, async () => ({ result: { status: 'async_launched', agentId: 'a3' } as never }))
  const run = `${ROOT}/panel-pause`
  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run) } as never)
  await $.tool.call({ tool: 'Agent', description: 'Panel seat: Claude', prompt: 'The pane matches `round2-` files in a round-2 dispatch.' } as never)
  // Gemini writes its verdict, then pauses 10 s while it reads, then finishes.
  put(`${run}/gemini.md`, 'VERDICT: APPROVE\nCONFIDENCE: low\nTOP_RISKS:\n')
  await clock.advance(10_000)
  put(`${run}/gemini.md`, reply('REJECT', 'Found late'))
  put(`${run}/claude.md`, reply('APPROVE', 'none'))
  await clock.advance(10_000)

  const ui = await $.ui.mount({ plugin: 'panel-view', surface: 'terminal', component: 'Pane', requestId: 'panel-view', props: PANE })
  await ui.press({ key: 'tab-findings' })
  expect(await ui.find({ type: 'Text', text: /Found late/ })).toBeDefined()
  await ui.press({ key: 'tab-rounds' })
  expect(await ui.find({ type: 'Text', text: /Loop 1 · Round 2/ })).toBeUndefined()
  await ui.press({ key: 'tab-live' })
  expect(await ui.find({ type: 'Text', text: /1 Reject, 1 Approve|1 Approve, 1 Reject/ })).toBeDefined()
  await ui.unmount()
})

test('Findings groups, filters, searches and opens a card onto its ruling; Rulings draws its charts', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(80_000_000)
  const { put } = rig(on, clock)
  const run = `${ROOT}/panel-findings`
  await $.tool.call({ tool: 'Bash', command: DISPATCH('packet.md').replace(RUN, run) } as never)
  put(`${run}/codex.md`, reply('REJECT', 'Polling keeps the timer alive forever'))
  put(`${run}/gemini.md`, reply('APPROVE_WITH_CHANGES', 'Retry targets the newest round'))
  put(`${run}/grok.md`, reply('APPROVE', 'Charts flash on redraw'))
  put(`${run}/claude.md`, reply('APPROVE', 'none'))
  await clock.advance(10_000)
  put(`${run}/ruling.json`, JSON.stringify({ round: 1, outcome: 'proceed_with_changes', summary: 'Fix two things', points: [
    { id: 'p1', text: 'Polling keeps the timer alive', seats: ['codex'], bucket: 'gap', severity: 'S1', ruling: 'accept', reason: 'Stops once ruled' },
    { id: 'p2', text: 'Charts flash', seats: ['grok'], bucket: 'gap', severity: 'S1', ruling: 'overrule', reason: 'Not reproduced' },
  ] }))
  await clock.advance(6_000)

  const ui = await $.ui.mount({ plugin: 'panel-view', surface: 'desktop', component: 'Pane', requestId: 'panel-view', props: PANE })
  await ui.press({ key: 'tab-findings' })
  await ui.press({ key: 'g-seat' })
  expect(await ui.find({ type: 'Text', text: /^Codex/ })).toBeDefined()
  // Seat filter: only Grok's finding stays.
  await ui.press({ key: 'fs-grok' })
  expect(await ui.find({ type: 'Text', text: /Charts flash on redraw/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Retry targets/ })).toBeUndefined()
  await ui.press({ key: 'fs-grok' })
  // Search.
  await ui.input({ key: 'find-query', text: 'retry', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /Retry targets/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Polling keeps/ })).toBeUndefined()
  await ui.input({ key: 'find-query', text: '', kind: 'change' })
  // Open Codex's finding: its verdict and the matching ruling show.
  await ui.press({ key: 'tg-f:codex:risk:0' })
  expect(await ui.find({ type: 'Text', text: /Codex's verdict: Reject/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Stops once ruled/ })).toBeDefined()

  await ui.press({ key: 'tab-rulings' })
  expect(await ui.find({ type: 'Text', text: /How the points were ruled/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Where points came from/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Whose points were taken/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Overruled$/ })).toBeDefined()
  await ui.unmount()
})
