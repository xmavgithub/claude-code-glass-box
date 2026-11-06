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

    expect(all[0]).toBe('1 turns · 2 steps · 1 tool calls · 0 failed/denied')
    expect(all).toContain('“list the files here”')
    expect(all.some(t => /^\d\d:\d\d:\d\d · 2 steps · 1 tools · 4\.2s · answered$/.test(t))).toBe(true)
    expect(all.some(t => /^opus-5-5 high · .* · 42\.2k in · 340 out · → tools$/.test(t))).toBe(true)
    expect(all.some(t => /· done$/.test(t))).toBe(true)
    expect(all).toContain('Let me list the files.')
    expect(all).toContain('allowed by Bash(ls:*)')
    // The call sits under step 1, before step 2: no "Other tool calls" section.
    const order = all.filter(t => t === 'Step 1' || t === 'Bash' || t === 'Step 2')
    expect(order).toEqual(['Step 1', 'Bash', 'Step 2'])
    expect(all).not.toContain('Other tool calls')
    await ui.unmount()
  }
})

test('clicking a call opens its input, output and permission verdict', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1500) }))
  on('tool.check', () => ({ decision: 'allow', reason: 'Read-only command' }) as const)
  on('tool.call', () => ({ result: {}, text: 'file1\nfile2' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'ls -la' }, tool_use_id: 'toolu_9' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls -la', tool_use_id: 'toolu_9' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // With no step recorded, the call lands in the "Other tool calls" section.
  expect(await texts(ui)).toContain('Other tool calls')
  expect(await texts(ui)).toContain('allowed')
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeUndefined()

  await ui.press({ key: 'c:toolu_9' })
  const open = await texts(ui)
  expect(open.some(t => t.includes('"command": "ls -la"'))).toBe(true)
  expect(open).toContain('file1\nfile2')
  expect(open).toContain('decision: allow\nreason: Read-only command')

  await ui.press({ key: 'c:toolu_9' })
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeUndefined()
  await ui.unmount()
})

test('an ask nobody can answer shows as asked, and the call as refused', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask', reason: 'Writes outside the project' }) as const)
  on('tool.call', () => ({ result: {}, text: 'never runs' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, tool_use_id: 'toolu_7' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm x', tool_use_id: 'toolu_7' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await texts(ui)
  expect(all).toContain('approval asked')
  expect(all).toContain('✗')
  expect(all).not.toContain('✓')
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
  expect(await texts(ui)).toContain('answer of T2')
  expect(await texts(ui)).not.toContain('answer of T1')

  await ui.press({ key: 't:T1' })
  expect(await texts(ui)).toContain('answer of T1')
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
  expect(all.some(t => / · no response$/.test(t))).toBe(true)
  expect(all.some(t => / · running$/.test(t) && t.startsWith('opus'))).toBe(false)
  await ui.unmount()
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ tool: 'Bash' }], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await texts(ui)).toContain('Nothing yet: send a prompt and watch it unfold here.')
  await ui.unmount()
})
