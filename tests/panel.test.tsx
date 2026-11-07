import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'glass-box',
  component: 'Pane',
  requestId: 'glass-box',
  props: {
    title: 'Glass Box',
    isFocused: false,
    // Wide, so the assertions below read whole lines; a narrow pane has its own test.
    bodyColumns: 160,
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

test('the Guide explains the loop with the numbers of the last turn, the tabs and every mark', async ($, on) => {
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
  // The tabs, and every mark the Timeline draws, are explained.
  expect(all).toContain('The tabs')
  for (const mark of ['∴ text', 'rewritten', 'Subagent', 'Turn titles', '✎', '↳', '+', '✉', '⇣', '/ and ⚙', '⊘ blocked', 'Mod.', 'Telemetry.']) {
    expect(has(all, new RegExp(`^${mark.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`))).toBe(true)
  }
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

test('a call a PreToolUse hook rewrote shows what the model asked for and what ran', async ($, on) => {
  // Stands for a settings hook such as one that prefixes commands.
  on('classic.PreToolUse', (_, e) =>
    e.tool === 'Bash' ? { updatedInput: { command: `rtk ${e.command}` } } : {},
  )
  on('tool.call', () => ({ result: {}, text: 'clean' }))
  await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'toolu_r' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(has(await texts(ui), /^✓ Bash .* {2}rewritten {2}git status → rtk git status$/)).toBe(true)

  await ui.press({ key: 'o:others' })
  const open = await texts(ui)
  expect(open).toContain('rewritten before running')
  expect(open).toContain('command: git status → rtk git status')
  await ui.unmount()
})

test('text added to the context is listed under its turn, by who wrote it', async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  await $.turn.start({ turnId: 'T1', text: 'hello' })
  await $.prompt.attachment({
    type: 'hook_additional_context',
    text: 'Use the sandbox tools.',
    origin: { kind: 'hook', event: 'SessionStart' },
  })
  await $.prompt.attachment({ type: 'todo_reminder', text: 'Your to-do list is empty.', origin: { kind: 'engine' } })
  // Carried again with the next request: listed once.
  await $.prompt.attachment({ type: 'todo_reminder', text: 'Your to-do list is empty.', origin: { kind: 'engine' } })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(has(await texts(ui), /^\+ Added to the context · 2 items · 47 chars \(~12 tokens\) · hooks 22, Claude Code 25$/)).toBe(true)

    await ui.press({ key: 'i:T1' })
    const open = await texts(ui)
    expect(has(open, /^SessionStart hook · hook_additional_context · 22 chars/)).toBe(true)
    expect(open).toContain('Use the sandbox tools.')
    expect(has(open, /^Claude Code · todo_reminder · 25 chars/)).toBe(true)
    await ui.press({ key: 'i:T1' })

    await ui.press({ key: 'v:stats' })
    expect(has(await texts(ui), /^25 *  Claude Code · todo_reminder \(1×\)$/)).toBe(true)
    await ui.press({ key: 'v:timeline' })
    await ui.unmount()
  }
})

test('the Prompt tab shows the system prompt, the first message’s blocks, the tools and the skills', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1000) }))
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
      { id: 'env', text: 'Working directory: /Users/me/proj', scope: 'session' },
    ],
  }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
  on('skill.prompt', (_, e) => ({ text: `Instructions of ${e.skill}.` }))
  on('tool.describe', (_, e) => ({ description: e.description, isDeferred: e.isDeferred }))
  on('command.register', () => ({ value: { command: 'glass-box' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: ['Bash', 'Read', 'WebFetch'],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
    traits: [],
  } as never)
  // The same prompt composed again on the next request is recorded once.
  await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: ['Bash', 'Read', 'WebFetch'],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
    traits: [],
  } as never)
  // A render that only measures the prompt (as /context does) is told apart.
  await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: ['Bash', 'Read', 'WebFetch'],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
    traits: ['analysis'],
  } as never)
  await $.prompt.context({
    blocks: [{ name: 'claudeMd', text: 'Always answer in Italian.' }, { name: 'currentDate', text: '2026-11-06' }],
    instructionFiles: [
      { path: '/Users/me/.claude/CLAUDE.md', kind: 'user', content: 'Always answer in Italian.' },
      { path: '/Users/me/.claude/RTK.md', kind: 'user', content: 'rtk', parent: '/Users/me/.claude/CLAUDE.md' },
    ],
  } as never)
  await $.tool.describe({ tool: 'Bash', description: 'Runs a shell command.', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.describe({ tool: 'WebFetch', description: 'Fetches a URL.', isDeferred: true, provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.tool.describe({ tool: 'mcp__ctx__search', description: 'Searches.', isDeferred: true, provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.skill.prompt({ skill: 'commit', source: 'built-in', text: 'raw', frontmatter: {} } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'v:instructions' })
    const all = await texts(ui)

    expect(has(all, /^opus-5-5 · sent to the model · 2 sections · 53 chars \(~13 tokens\) · 20 shared, 33 yours · 3 tools offered · updated/)).toBe(true)
    // The prompt sent to the model comes first, the measurement after.
    const prompts = all.filter(t => /^opus-5-5 · /.test(t))
    expect(prompts.length).toBe(2)
    expect(prompts[1]).toMatch(/^opus-5-5 · measured only, as \/context does: not sent · .* · traits: analysis · /)
    expect(has(all, /^intro · shared · 20 chars$/)).toBe(true)
    expect(has(all, /^claudeMd · 25 chars/)).toBe(true)
    expect(has(all, /^user *  3 chars · ~\/\.claude\/RTK\.md · imported by CLAUDE\.md$/)).toBe(true)
    expect(has(all, /^3 tools · 1 loaded \(21 chars \(~5 tokens\)\) · 2 behind ToolSearch$/)).toBe(true)
    expect(has(all, /^commit · built-in · 23 chars/)).toBe(true)

    await ui.press({ key: 'n:s:claude-opus-5-5|:intro' })
    expect(await texts(ui)).toContain('You are Claude Code.')
    await ui.press({ key: 'n:s:claude-opus-5-5|:intro' })

    await ui.press({ key: 'n:tools' })
    const toolsOpen = await texts(ui)
    expect(toolsOpen).toContain('loaded: Bash 21')
    expect(toolsOpen).toContain('behind ToolSearch: WebFetch')
    expect(toolsOpen).toContain('behind ToolSearch: search')
    await ui.press({ key: 'n:tools' })
    await ui.press({ key: 'v:timeline' })
    await ui.unmount()
  }
})

test('on a narrow pane a long command is cut to one line, on every surface', async ($, on) => {
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const command = `python3 - <<'EOF'\n${'print("a very long line of a heredoc command")\n'.repeat(12)}EOF`
  await $.tool.call({ tool: 'Bash', command, tool_use_id: 'toolu_long' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 48 } })
    const row = (await texts(ui)).find(t => t.startsWith('✓ Bash'))
    expect(row).toBeDefined()
    expect(row!.endsWith('…')).toBe(true)
    // The terminal counts cells; the others write in a narrower proportional font.
    expect(row!.length).toBeLessThanOrEqual(surface === 'terminal' ? 48 : Math.floor(48 * 1.6))
    if (surface !== 'terminal') expect(row!.length).toBeGreaterThan(48)
    expect(row!.includes('\n')).toBe(false)
    await ui.unmount()
  }
})

test('Context shows the window, what fills it, cost per turn, rate limits and compactions', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 1000) }))
  let usd = 1
  const resetsAt = new Date(Date.now() + 2 * 3_600_000 + 30 * 60_000).toISOString()
  const measured = {
    context: { tokens: 61_500, window: 1_000_000, percent: 6 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 38, resetsAt }],
  }
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      ...measured,
      context: {
        ...measured.context,
        breakdown: (e as { breakdown?: string }).breakdown === undefined
          ? undefined
          : {
              categories: [
                { name: 'System prompt', tokens: 12_000, color: 'x', isDeferred: false, kind: 'used' },
                { name: 'Messages', tokens: 40_000, color: 'x', isDeferred: false, kind: 'used' },
                { name: 'Free space', tokens: 900_000, color: 'x', isDeferred: false, kind: 'free' },
              ],
              totalTokens: 61_500,
              maxTokens: 1_000_000,
              rawMaxTokens: 1_000_000,
              autocompactSource: 'model-default',
              percentage: 6,
              gridRows: [],
              model: 'claude-opus-5-5',
              memoryFiles: [{ path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 900 }],
              mcpTools: [
                { name: 'mcp__ctx__a', serverName: 'ctx', tokens: 300, isLoaded: true },
                { name: 'mcp__ctx__b', serverName: 'ctx', tokens: 200, isLoaded: false },
              ],
              agents: [],
              autoCompactThreshold: 920_000,
              isAutoCompactEnabled: true,
              apiUsage: null,
            },
      },
      cost: { usd },
    },
  }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 182_000, tokensAfter: 24_000 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'glass-box' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 'T1', text: 'refactor the parser' })
  // The model answered: the session now costs $0.42 more.
  usd = 1.42
  await $.session.measure({ ...measured, cost: { usd: 1.42 }, changed: ['context', 'cost'] } as never)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
  await $.turn.complete({ turnId: 'T1', reason: 'answer', answer: 'Done.', durationMs: 9000, isAborted: false } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const timeline = await texts(ui)
  expect(has(timeline, /^✓ Turn · .* · 9\.0s · \$0\.42$/)).toBe(true)
  expect(has(timeline, /^⇣ Context compacted · automatic, the context was nearly full · 182\.0k → 24\.0k tokens/)).toBe(true)

  await ui.press({ key: 'v:context' })
  const all = await texts(ui)
  expect(all).toContain('6% · 61.5k of 1.00M tokens')
  // The meter is two boxes of set widths: 1 of 20 cells filled at 6%.
  expect(await ui.find({ key: 'c-fill-fill' })).toBeDefined()
  expect(await ui.find({ key: 'c-fill-rest' })).toBeDefined()
  expect(has(all, /^System prompt +12\.0k tokens · 1%$/)).toBe(true)
  expect(all).toContain('Auto-compaction is on: it runs at about 920.0k tokens.')
  expect(has(all, /^User +900 tokens · ~\/\.claude\/CLAUDE\.md$/)).toBe(true)
  expect(has(all, /^ctx +500 tokens · 2 tools, 1 loaded$/)).toBe(true)
  expect(has(all, /^this session +\$1\.42$/)).toBe(true)
  expect(has(all, /^\d\d:\d\d +\$0\.42 · “refactor the parser”$/)).toBe(true)
  expect(has(all, /^38% · resets in 2h (29|30)m \(\d\d:\d\d\)$/)).toBe(true)
  await ui.unmount()

  // The meter's boxes are drawn by every surface.
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    expect(await other.find({ key: 'c-fill-fill' })).toBeDefined()
    expect(await other.find({ key: 'c-rl-five_hour-fill' })).toBeDefined()
    await other.unmount()
  }
})

test('Clear empties the timeline', async ($, on) => {
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Read', file_path: '/a', tool_use_id: 'toolu_x' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(has(await texts(ui), /^✓ Read/)).toBe(true)
  await ui.press({ key: 'clear' })
  expect(has(await texts(ui), /^✓ Read/)).toBe(false)
  expect(has(await texts(ui), /^Nothing yet\./)).toBe(true)
  await ui.unmount()
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ tool: 'Bash' }], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(has(await texts(ui), /^Nothing yet\. Send Claude a message/)).toBe(true)
  await ui.unmount()
})

test('a subagent is drawn under the Agent call that started it, with its type, model, prompt and turns', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    if (e.turnId === 'T1' && e.index === 0) yield { kind: 'tool', index: 0, id: 'toolu_A', name: 'Agent' } as const
    if (e.turnId === 'S1') yield { kind: 'tool', index: 0, id: 'toolu_R', name: 'Read' } as const
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as const
  })
  on('tool.check', () => ({ decision: 'allow' }) as const)
  // The Agent call stays open while its subagent works, as in the engine.
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async (_, e) => {
    if (e.tool === 'Agent') await gate
    return { result: {}, text: 'done' }
  })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const drain = async (turnId: string, index: number, agentId?: string) => {
    const step = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
    for await (const _chunk of step) {
      // drain
    }
  }

  // A subagent turn whose call Glass Box never saw stays at the top level.
  await $.turn.start({ turnId: 'S2', text: 'an older helper', agentId: 'B9' } as never)
  await $.turn.start({ turnId: 'T1', text: 'look around' })
  await drain('T1', 0)
  await $.tool.check({ tool: 'Agent', input: { description: 'find the config', prompt: 'Find where the config is read.' }, tool_use_id: 'toolu_A' } as never)
  const agentCall = $.tool.call({ tool: 'Agent', description: 'find the config', prompt: 'Find where the config is read.', tool_use_id: 'toolu_A' } as never)
  await $.agent.spawn({
    tool_use_id: 'toolu_A',
    prompt: 'Find where the config is read.',
    description: 'find the config',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'haiku',
    parentModel: 'claude-opus-5-5',
    permissionMode: 'default',
    background: false,
    fork: false,
  } as never)
  await $.turn.start({ turnId: 'S1', text: 'Find where the config is read.', agentId: 'A1' } as never)
  await drain('S1', 0, 'A1')

  // While it works, the subagent is open: its prompt and its turn show.
  const live = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const during = await texts(live)
  expect(has(during, /^● Subagent Explore · haiku-5-5 · 1 step · 1 tool call · running$/)).toBe(true)
  expect(during).toContain('Find where the config is read.')
  expect(has(during, /model: claude-haiku-5-5 \(the call asked for haiku\)/)).toBe(true)
  await live.unmount()

  await $.tool.call({ tool: 'Read', file_path: '/x', tool_use_id: 'toolu_R', agentId: 'A1' } as never)
  await $.turn.complete({ turnId: 'S1', agentId: 'A1', reason: 'answer', answer: 'In app.ts', durationMs: 3000, isAborted: false } as never)
  release()
  await agentCall
  await $.turn.complete({ turnId: 'T1', reason: 'answer', answer: 'Found it', durationMs: 5000, isAborted: false } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(has(all, /^✓ Subagent Explore · haiku-5-5 · 1 step · 1 tool call · 3\.0s$/)).toBe(true)
    // Done, it folds away: its turn is not drawn, and is not a top-level turn.
    expect(all).not.toContain('“Find where the config is read.”')
    // Running: ● on the terminal, a pulsing dot (an SVG) elsewhere.
    expect(has(all, /^(● | )Subagent · /)).toBe(true)
    if (surface !== 'terminal') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    // The agent's line sits right under the Agent call.
    const order = all.filter(t => /^. (Agent|Subagent Explore)\b/.test(t)).map(t => t.split(' ')[1])
    expect(order).toEqual(['Agent', 'Subagent'])

    await ui.press({ key: 'a:toolu_A|A1' })
    const open = await texts(ui)
    expect(has(open, /this call started a subagent of type Explore\. It is a separate loop/)).toBe(true)
    expect(open).toContain('permission mode: default (inherited from the parent)')
    expect(open).toContain('“Find where the config is read.”')
    expect(has(open, /^✓ Read /)).toBe(true)
    await ui.press({ key: 'a:toolu_A|A1' })
    await ui.unmount()
  }

  // A subagent with no turn recorded is as done as the call that started it.
  release()
  await $.tool.call({ tool: 'Agent', description: 'again', prompt: 'Look again.', tool_use_id: 'toolu_Z' } as never)
  await $.agent.spawn({
    tool_use_id: 'toolu_Z',
    prompt: 'Look again.',
    description: 'again',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(has(await texts(ui), /^✓ Subagent general-purpose · haiku-5-5 · 0 steps · 0 tool calls · 0ms · background$/)).toBe(true)
  await ui.press({ key: 'a:toolu_Z|A1' })
  const none = await texts(ui)
  expect(has(none, /^No turn of it is recorded/)).toBe(true)
  expect(has(none, /the call named none: the agent type’s own model, else the parent’s, opus-5-5/)).toBe(true)
  await ui.press({ key: 't:S2' })
  expect(has(await texts(ui), /Glass Box did not record the call that started it/)).toBe(true)
  await ui.unmount()

  // A background agent's report reaches the main loop as a new message: the
  // turn it starts is told apart from yours by the frame around the text.
  await $.turn.start({
    turnId: 'T2',
    text: '<agent-message from="A1">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Found it in app.ts\n  line 12\n</agent-message>',
  })
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const report = await texts(after)
  expect(has(report, /^● Report from subagent Explore · /)).toBe(true)
  expect(report).toContain('Found it in app.ts\nline 12')
  expect(has(report, /^Not typed by you\. The Explore subagent started at .* ran in the background/)).toBe(true)
  expect(has(report, /^<agent-message from="A1">/)).toBe(true)
  expect(has(report, /^✓ Subagent .* · reported back \d\d:\d\d$/)).toBe(true)
  await after.unmount()

  await $.turn.start({
    turnId: 'T3',
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>',
  })
  const last = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const task = await texts(last)
  expect(has(task, /^(● | )Background task ended · /)).toBe(true)
  expect(has(task, /a background task ended \(Build finished\)/)).toBe(true)
  await last.unmount()
})

test('a step shows its thinking, and what the transcript says when no text of it came', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const long = 'x'.repeat(5000)
  on('turn.step', async function* (_, e) {
    if (e.turnId === 'T1' && e.index === 0) {
      yield { kind: 'thinking', index: 0, text: 'I should list the files first.' } as const
      yield { kind: 'thinking', index: 0, text: '\nThen read the README.' } as const
      yield { kind: 'text', index: 1, text: 'Listing.' } as const
    }
    if (e.turnId === 'T1' && e.index === 1) yield { kind: 'thinking', index: 0, text: long } as const
    return { turnId: e.turnId, index: e.index, answer: 'Done.', toolUses: [], stopReason: 'end_turn', usage: USAGE } as const
  })
  // The model's last message as the transcript keeps it, set per turn below.
  let lastBlocks: { type: string; [field: string]: unknown }[] = []
  on('session.messages', () => ({
    value: [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: lastBlocks },
    ],
  }))

  const run = async (turnId: string, steps: number, blocks: typeof lastBlocks) => {
    lastBlocks = blocks
    await $.turn.start({ turnId, text: 'go' })
    for (let index = 0; index < steps; index++) {
      const step = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1 })
      for await (const _chunk of step) {
        // drain
      }
    }
    await $.turn.complete({ turnId, reason: 'answer', answer: 'Done.', durationMs: 1000, isAborted: false } as never)
  }
  // T1: two steps stream their thinking; the third thought with no text sent.
  await run('T1', 3, [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Done.' }])
  await run('T2', 1, [{ type: 'text', text: 'Done.' }])
  await run('T3', 1, [{ type: 'redacted_thinking', data: 'abc' }, { type: 'text', text: 'Done.' }])
  await run('T4', 1, [{ type: 'thinking', thinking: 'Recovered from the transcript.', signature: 'sig' }, { type: 'text', text: 'Done.' }])

  const keys = ['t:T1', 't:T2', 't:T3', 's:T1:0', 's:T1:1', 's:T1:2', 's:T2:0', 's:T3:0', 's:T4:0']
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // T4 is the newest, open by default: the text read back shows closed.
    expect(await texts(ui)).toContain('∴ Recovered from the transcript.')
    for (const key of keys) await ui.press({ key })
    const all = await texts(ui)
    expect(all).toContain('∴ Recovered from the transcript.'.slice(2))
    expect(all).toContain('thinking · 52 chars')
    expect(all).toContain('I should list the files first.\nThen read the README.')
    expect(all).toContain('thinking · 5.0k chars')
    expect(all).toContain(`${'x'.repeat(3000)}…`)
    expect(has(all, /^The model thought in this step, but the text of its thinking was not sent/)).toBe(true)
    expect(all).toContain('No thinking in this step: the transcript has none.')
    expect(has(all, /^The model thought in this step, but its thinking came back redacted/)).toBe(true)
    // Closed again, steps before their turns.
    for (const key of [...keys].reverse()) await ui.press({ key })
    await ui.unmount()
  }
})

test('each turn says where its message came from, what a hook changed, and what arrived meanwhile', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) =>
    e.text === 'secret'
      ? { drop: 'it names a secret' }
      : { text: e.text === 'fix it' ? 'fix it, and run the tests' : e.text, origin: e.origin },
  )

  const submit = (text: string, origin: Record<string, unknown>, turnId?: string) =>
    $.prompt.submit({ text, origin, wait: false, attachments: [], context: [], ...(turnId ? { turnId } : {}) } as never)

  await submit('hello', { kind: 'composer' })
  await $.turn.start({ turnId: 'T1', text: 'hello' })
  await submit('fix it', { kind: 'composer' })
  await $.turn.start({ turnId: 'T2', text: 'fix it, and run the tests' })
  await submit('also check the README', { kind: 'composer' }, 'T2')
  await submit('Build finished', { kind: 'task-notification' }, 'T2')
  await submit('daily summary', { kind: 'plugin', name: 'reminder' })
  await $.turn.start({ turnId: 'T3', text: 'daily summary' })
  await submit('secret', { kind: 'composer' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all0 = await texts(ui)
    // The blocked message is the newest row, open by default.
    expect(has(all0, /^⊘ Message · \d\d:\d\d · blocked$/)).toBe(true)
    expect(has(all0, /^This message did not enter, so no turn ran: it names a secret\. You sent it/)).toBe(true)
    expect(has(all0, /^(● | )Prompt from plugin reminder · /)).toBe(true)
    expect(all0).toContain('“hello”')
    expect(all0).toContain('✎ changed by a hook before the model read it')

    const open = ['t:T1', 't:T2', 't:T3']
    for (const key of open) await ui.press({ key })
    const all = await texts(ui)
    expect(has(all, /It was sent as: “fix it”\. The model read the text above\./)).toBe(true)
    expect(has(all, /^↳ You · .* · arrived while this turn ran$/)).toBe(true)
    expect(all).toContain('“also check the README”')
    expect(has(all, /^↳ A background task, ending · /)).toBe(true)
    expect(has(all, /^Not typed by you: A plugin \(reminder\) sent this message, and it started this turn\. Claude Code stamps its origin as “plugin”\.$/)).toBe(true)
    for (const key of [...open].reverse()) await ui.press({ key })
    await ui.unmount()
  }
})

test('the Prompt tab lists the plugins seen at work, and not plain MCP servers', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('tool.describe', (_, e) => ({ description: e.description, isDeferred: e.isDeferred }))
  on('skill.prompt', (_, e) => ({ text: `Instructions of ${e.skill}.` }))

  // plugin.register cannot be raised from a test (a mod joins at load): the
  // mods' rows are covered by the type check, the rest here.
  await $.tool.describe({ tool: 'scan_secrets', description: 'Scans.', provider: { plugin: 'plugin-authoring', tier: 'user' } } as never)
  await $.tool.describe({ tool: 'mcp__gmail__search', description: 'Mail.', isDeferred: true, provider: { plugin: 'mcp:gmail', tier: 'user' } } as never)
  await $.skill.prompt({ skill: 'review', source: 'plugin', pluginName: 'code-tools', text: 'raw', frontmatter: {} } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'v:instructions' })
    const all = await texts(ui)
    expect(all).toContain('Plugins in the loop')
    expect(has(all, /^plugin-authoring · 1 tool$/)).toBe(true)
    expect(has(all, /^code-tools · 1 skill$/)).toBe(true)
    // A plain MCP server is listed with the tools, not as a plugin.
    expect(has(all, /^gmail · /)).toBe(false)

    await ui.press({ key: 'n:pl:plugin-authoring' })
    expect(await texts(ui)).toContain('Tools: scan_secrets.')
    await ui.press({ key: 'n:pl:plugin-authoring' })
    await ui.press({ key: 'v:timeline' })
    await ui.unmount()
  }
})

test('messages between agents are listed under the turn of the loop that sent or received them', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.send', (_, e) =>
    e.to === 'nobody' ? ({ isDelivered: false, reason: 'No agent named nobody' } as const) : ({ isDelivered: true } as const),
  )
  on('session.receive', (_, e) =>
    e.text.includes('spam') ? { consumed: 'filtered as spam' } : { text: `${e.text} (checked)` },
  )

  await $.turn.start({ turnId: 'S1', text: 'research the API', agentId: 'A1' } as never)
  await $.session.send({ to: 'team-lead', text: 'Found three endpoints.', origin: { kind: 'model' }, agentId: 'A1' } as never)
  await $.turn.start({ turnId: 'T1', text: 'coordinate' })
  await $.session.send({ to: 'researcher', text: 'Look at the auth flow.', origin: { kind: 'model' } } as never)
  await $.session.send({ to: 'nobody', text: 'Hello?', origin: { kind: 'model' } } as never)
  await $.session.receive({ origin: { kind: 'peer', teammate: 'researcher', isLocal: true }, text: 'Auth uses OAuth.' } as never)
  await $.session.receive({ origin: { kind: 'unclassified' }, text: 'buy spam now' } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all0 = await texts(ui)
    expect(has(all0, /^✉ Messages between agents · 2 sent · 2 received · 2 not through$/)).toBe(true)

    await ui.press({ key: 'm:T1' })
    const all = await texts(ui)
    expect(has(all, /^→ to researcher · sent by the model · .* · delivered$/)).toBe(true)
    expect(all).toContain('Not delivered: No agent named nobody')
    expect(has(all, /^← from researcher, of the team · peer · .* · changed by a plugin$/)).toBe(true)
    expect(all).toContain('Auth uses OAuth. (checked)')
    expect(all).toContain('Taken by a plugin before it was queued, so the model never read it: filtered as spam')
    await ui.press({ key: 'm:T1' })

    // The subagent's message sits under its own turn.
    await ui.press({ key: 't:S1' })
    await ui.press({ key: 'm:S1' })
    expect(has(await texts(ui), /^→ to team-lead · sent by the model · /)).toBe(true)
    await ui.press({ key: 'm:S1' })
    await ui.press({ key: 't:S1' })
    await ui.unmount()
  }
})

test('the Prompt tab lists the agent types offered to the model, and one a plugin kept from it', async ($, on) => {
  on('agent.offer', (_, e) => ({ isOffered: e.agent !== 'Plan' }))

  await $.agent.offer({ agent: 'Explore', description: 'Fast read-only search across a codebase.', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.agent.offer({ agent: 'Plan', description: 'Designs an implementation plan.', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)
  await $.agent.offer({ agent: 'reviewer', description: 'Reviews a diff.', source: 'plugin', provider: { plugin: 'code-tools', tier: 'user' } } as never)
  // Raised again on the next request, unchanged: nothing more is written.
  await $.agent.offer({ agent: 'Explore', description: 'Fast read-only search across a codebase.', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'v:instructions' })
    const all = await texts(ui)
    expect(all).toContain('Agents on offer')
    expect(all).toContain('Explore · built-in')
    expect(all).toContain('Plan · built-in · kept from the model by a plugin')
    expect(all).toContain('reviewer · plugin, code-tools')
    expect(all).toContain('code-tools · 1 agent type')

    await ui.press({ key: 'n:a:Explore' })
    expect(await texts(ui)).toContain('Fast read-only search across a codebase.')
    await ui.press({ key: 'n:a:Explore' })
    await ui.press({ key: 'v:timeline' })
    await ui.unmount()
  }
})

test('slash commands and setting changes are rows of their own among the turns', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('command.run', (_, e) =>
    e.command === 'compact' ? { text: 'Compacted.', context: ['The conversation was summarized above.'] } : { text: '' },
  )
  on('config.set', (_, e) => (e.key === 'theme' ? { deny: 'locked by policy' } : { value: e.value }))

  await $.turn.start({ turnId: 'T1', text: 'hello' })
  await $.command.run({ command: 'compact', args: 'keep the plan', origin: { kind: 'composer' }, presentation: 'local' } as never)
  await $.config.set({ key: 'model', value: 'sonnet', previous: 'opus', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } } as never)
  await $.config.set({ key: 'theme', value: 'light', previous: 'dark', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'plugin', name: 'styler' } } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(has(all, /^\/ \/compact keep the plan · \d\d:\d\d · by you · left notes for the model$/)).toBe(true)
    expect(has(all, /^⚙ Setting model · opus → sonnet · \d\d:\d\d · by you$/)).toBe(true)
    expect(has(all, /^⚙ Setting theme · dark → light · \d\d:\d\d · by plugin styler · refused$/)).toBe(true)
    expect(all).toContain('A plugin refused the change: locked by policy')
    // Newest first: the settings, the command, then the turn.
    const order = all.filter(t => /^(⚙ Setting|\/ \/|● Turn| Turn · )/.test(t)).map(t => (t.startsWith(' Turn') ? '●' : t.split(' ')[0]))
    expect(order).toEqual(['⚙', '⚙', '/', '●'])

    const key = (await ui.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key ?? '').find(k => k.startsWith('c:'))
    expect(key).toBeDefined()
    await ui.press({ key: key ?? '' })
    const open = await texts(ui)
    expect(open).toContain('Compacted.')
    expect(open).toContain('The conversation was summarized above.')
    await ui.press({ key: key ?? '' })
    await ui.unmount()
  }
})

test('Stats shows what was sent to the operator’s telemetry collector, and says Anthropic’s stream is out of reach', async ($, on) => {
  let clock = 1_700_000_000_000
  on('clock.now', () => ({ value: (clock += 500) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('telemetry.log', () => ({ value: undefined }))

  await $.turn.start({ turnId: 'T1', text: 'hello' })
  for (const event of ['api_request', 'api_request', 'tool_result']) {
    await $.telemetry.log({ to: 'collector', event, attributes: { model: 'claude-opus-5-5', duration_ms: 1200 }, loggedAt: '2026-11-06T10:00:00.000Z' } as never)
  }
  // The buffer is written at the turn's end at the latest.
  await $.turn.complete({ turnId: 'T1', reason: 'answer', answer: 'Hi', durationMs: 1000, isAborted: false } as never)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'v:stats' })
    const all = await texts(ui)
    expect(has(all, /Anthropic’s own analytics and feature marks are open to the plugins built into the CLI only/)).toBe(true)
    expect(has(all, /^to your collector *  3 records · 2 kinds$/)).toBe(true)
    await ui.press({ key: 'st:tel:events' })
    await ui.press({ key: 'st:tel:recent' })
    const open = await texts(ui)
    expect(has(open, /^2× *  claude_code\.api_request$/)).toBe(true)
    expect(open).toContain('{"model":"claude-opus-5-5","duration_ms":1200}')
    await ui.press({ key: 'st:tel:recent' })
    await ui.press({ key: 'st:tel:events' })
    await ui.press({ key: 'v:timeline' })
    await ui.unmount()
  }
})

