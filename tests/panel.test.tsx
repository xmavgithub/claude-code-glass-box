import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'glass-box',
  component: 'Pane',
  requestId: 'glass-box',
  props: {
    title: 'Glass Box',
    isFocused: false,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 12,
  output_tokens: 340,
  cache_read_input_tokens: 41_000,
  cache_creation_input_tokens: 1_200,
  model: 'claude-opus-5-5',
}

const texts = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

const has = (all: string[], pattern: RegExp) => all.some(t => pattern.test(t))

test('a turn shows its prompt, its steps, and under each step the tool calls it asked for', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('command.register', () => ({ value: { command: 'glass-box' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    if (e.index === 0) {
      yield { kind: 'text', index: 0, text: 'Let me list the files.' } as const
      yield { kind: 'tool', index: 1, id: 'toolu_1', name: 'Bash' } as const
    }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: e.index === 0 ? 'Let me list the files.' : 'There are two files.',
      toolUses: e.index === 0 ? [{ name: 'Bash', input: { command: 'ls' } }] : [],
      stopReason: e.index === 0 ? 'tool_use' : 'end_turn',
      usage: USAGE,
    } as const
  })
  on('tool.check', () => ({ decision: 'allow', rule: 'Bash(ls:*)' }) as const)
  on('tool.call', () => ({ result: {}, text: 'a.txt\nb.txt' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 'T1', text: 'list the files here' })
  const step0 = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 })
  for await (const _chunk of step0) {
    // drain the stream, as the engine would
  }
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'toolu_1' })
  const step1 = $.turn.step({ turnId: 'T1', index: 1, model: 'claude-opus-5-5', effort: 'high', messageCount: 5 })
  for await (const _chunk of step1) {
    // drain
  }
  await $.turn.complete({
    turnId: 'T1',
    reason: 'answer',
    answer: 'There are two files.',
    durationMs: 4200,
    isAborted: false,
  } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)

    expect(all).toContain('1 turn · 2 steps · 1 tool call · 0 failed')
    expect(all).toContain('“list the files here”')
    expect(has(all, /^✓ Turn · \d\d:\d\d · 2 steps · 1 tool call · context 42\.2k · 4\.2s$/)).toBe(true)
    // The model shows on the first step only, as it does not change.
    expect(has(all, /^✓ Step 1 · opus-5-5 · high effort · [\d.]+m?s · wrote 340 tokens · asked for 1 tool$/)).toBe(true)
    expect(has(all, /^✓ Step 2 · [\d.]+m?s · wrote 340 tokens · answered$/)).toBe(true)
    expect(all).toContain('› Let me list the files.')
    expect(has(all, /^✓ Bash {2}[\d.]+m?s {2}allowed: rule Bash\(ls:\*\) {2}ls$/)).toBe(true)
    // The call sits under step 1, before step 2: no "Other tool calls" section.
    const order = all
      .filter(t => /^✓ (Step \d|Bash) /.test(t))
      .map(t => (t.startsWith('✓ Bash') ? 'Bash' : t.slice(2, 8)))
    expect(order).toEqual(['Step 1', 'Bash', 'Step 2'])
    expect(has(all, /Other tool calls/)).toBe(false)
    await ui.unmount()
  }
})

test('opening a step shows its token breakdown and its calls in full', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'tool', index: 0, id: 'toolu_9', name: 'Bash' } as const
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: USAGE } as const
  })
  on('tool.check', () => ({ decision: 'allow', reason: 'Read-only command' }) as const)
  on('tool.call', () => ({ result: {}, text: 'file1\nfile2' }))

  await $.turn.start({ turnId: 'T1', text: 'go' })
  const step = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _chunk of step) {
    // drain
  }
  await $.tool.check({ tool: 'Bash', input: { command: 'ls -la' }, tool_use_id: 'toolu_9' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls -la', tool_use_id: 'toolu_9' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(has(await texts(ui), /^✓ Bash {2}1\.5s {2}allowed {2}ls -la$/)).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeUndefined()

  await ui.press({ key: 's:T1:0' })
  const open = await texts(ui)
  expect(has(open, /^tokens: 42\.2k context \(41\.0k cached, 1\.2k written, 12 new\) · 340 output$/)).toBe(true)
  expect(has(open, /"command": "ls -la"/)).toBe(true)
  expect(open).toContain('file1\nfile2')
  expect(open).toContain('Allowed without asking: Read-only command')
  expect(open).toContain('decision: allow\nreason: Read-only command')

  await ui.press({ key: 's:T1:0' })
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeUndefined()
  await ui.unmount()
})

test('an ask shows its outcome: rejected when nobody could approve it', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'Writes outside the project' }) as const)
  on('tool.call', () => ({ result: {}, text: 'never runs' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'toolu_7' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'toolu_7' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await texts(ui)
  expect(has(all, /^✗ Bash .* {2}rejected {2}rm x$/)).toBe(true)
  expect(has(all, /approved/)).toBe(false)
  await ui.unmount()
})

test('paths read relative to the project, home as ~, and MCP tools by their short name', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/proj/src/a.ts', tool_use_id: 'toolu_a' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/other/b.ts', tool_use_id: 'toolu_b' })
  await $.tool.call({ tool: 'mcp__srv__do_it', folder: '/Users/me/proj/x', tool_use_id: 'toolu_c' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(has(all, / {2}src\/a\.ts$/)).toBe(true)
  expect(has(all, / {2}~\/other\/b\.ts$/)).toBe(true)
  expect(has(all, /^✓ do_it ·srv .* {2}x$/)).toBe(true)
  await ui.unmount()
})

test('a step whose stream is closed early (an interrupted turn) does not stay running', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 100) }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'Let me' } as const
    yield { kind: 'text', index: 0, text: ' think' } as const
    return { turnId: e.turnId, index: e.index, answer: 'Let me think', toolUses: [], stopReason: 'end_turn', usage: null } as const
  })

  const step = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await step.next()
  await step.return(undefined as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await texts(ui)
  expect(has(all, /^✗ Step 1 · .* · no response \(interrupted or failed\)$/)).toBe(true)
  expect(has(all, /^● Step 1/)).toBe(false)
  await ui.unmount()
})

test('only the newest turn is open; an older one opens on a click', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 100) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: `answer of ${e.turnId}`, toolUses: [], stopReason: 'end_turn', usage: null } as const
  })
  for (const id of ['T1', 'T2']) {
    await $.turn.start({ turnId: id, text: `prompt ${id}` })
    const step = $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _chunk of step) {
      // drain
    }
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await texts(ui)).toContain('› answer of T2')
  expect(await texts(ui)).not.toContain('› answer of T1')

  await ui.press({ key: 't:T1' })
  expect(await texts(ui)).toContain('› answer of T1')
  await ui.unmount()
})

test('the Stats tab sums up tools, permissions and the model', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'tool', index: 0, id: 'toolu_1', name: 'Bash' } as const
    yield { kind: 'tool', index: 1, id: 'toolu_2', name: 'Bash' } as const
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: USAGE } as const
  })
  on('tool.check', () => ({ decision: 'allow', rule: 'Bash(ls:*)' }) as const)
  on('tool.call', (_, e) =>
    e.tool_use_id === 'toolu_2' ? { result: {}, text: 'boom', isError: true } : { result: {}, text: 'ok' },
  )

  await $.turn.start({ turnId: 'T1', text: 'go' })
  const step = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _chunk of step) {
    // drain
  }
  for (const id of ['toolu_1', 'toolu_2']) {
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: id } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: id })
  }

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Tools' })).toBeUndefined()

    await ui.press({ key: 'v:stats' })
    const all = await texts(ui)
    expect(all).toContain('Tools')
    expect(has(all, /^Bash *  2 calls · 1 failed · 2\.0s · avg 1\.0s$/)).toBe(true)
    expect(has(all, /^2 *  by a settings rule$/)).toBe(true)
    expect(has(all, /^2 *  rule Bash\(ls:\*\)$/)).toBe(true)
    expect(has(all, /^output *  340 tokens written$/)).toBe(true)
    expect(has(all, /^context *  largest 42\.2k tokens · 97% read from cache$/)).toBe(true)

    await ui.press({ key: 'v:timeline' })
    expect(await ui.find({ type: 'Text', text: 'Tools' })).toBeUndefined()
    await ui.unmount()
  }
})

test('How it works explains the loop, with the numbers of the last turn', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'Hi', toolUses: [], stopReason: 'end_turn', usage: USAGE } as const
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const empty = await $.ui.mount({ ...PANE, surface })
    await empty.press({ key: 'v:guide' })
    expect(await texts(empty)).toContain('Once you send a message, your own numbers appear here.')
    await empty.press({ key: 'v:timeline' })
    await empty.unmount()
  }

  await $.turn.start({ turnId: 'T1', text: 'hello' })
  const step = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _chunk of step) {
    // drain
  }
  await $.turn.complete({ turnId: 'T1', reason: 'answer', answer: 'Hi', durationMs: 2500, isAborted: false } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'v:guide' })
  const all = await texts(ui)
  expect(all).toContain('The loop')
  expect(has(all, /^2\. Step\. Claude Code sends the whole conversation/)).toBe(true)
  expect(all).toContain('Your last turn: 1 step, 0 tool calls, 340 tokens written, 2.5s.')
  expect(has(all, /^Context\. Everything the model reads at a step/)).toBe(true)
  await ui.unmount()
})

test('the advisor shows as its own row: time, model, and its advice read from the transcript', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { advisorModel: 'fable' } }))
  on('command.register', () => ({ value: { command: 'glass-box' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Done.',
      toolUses: [],
      serverToolUses: [{ id: 'srvtoolu_1', name: 'advisor', input: {}, startedAt: 1000, endedAt: 4200 }],
      stopReason: 'end_turn',
      usage: USAGE,
    } as const
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', content: [{ type: 'text', text: 'review this' }] },
      {
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'advisor_result', text: 'Check the edge case first.' } },
          { type: 'text', text: 'Done.' },
        ],
      },
    ],
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 'T1', text: 'review this' })
  const step = $.turn.step({ turnId: 'T1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _chunk of step) {
    // drain
  }
  await $.turn.complete({ turnId: 'T1', reason: 'answer', answer: 'Done.', durationMs: 5000, isAborted: false } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(has(await texts(ui), /^✓ advisor {2}3\.2s {2}ran by the model API {2}model fable \(from your settings\)$/)).toBe(true)

  await ui.press({ key: 's:T1:0' })
  const open = await texts(ui)
  expect(open).toContain('Check the edge case first.')
  expect(has(open, /^The model API ran advisor itself, inside this step/)).toBe(true)

  await ui.press({ key: 'v:stats' })
  expect(has(await texts(ui), /^advisor ·server tool *  1 call · 3\.2s · avg 3\.2s$/)).toBe(true)
  await ui.unmount()
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ tool: 'Bash' }], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(has(await texts(ui), /^Nothing yet\. Send Claude a message/)).toBe(true)
  await ui.unmount()
})
