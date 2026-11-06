import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CallStatus, Step, ToolCall, Turn, Usage, Verdict } from '../types'

const PANE = 'glass-box'
const TITLE = 'Glass Box'
const COLUMNS = 64

const MAX_TURNS = 30
const MAX_STEPS = 400
const MAX_CALLS = 300
const MAX_TOGGLED = 200
const MAX_PROMPT = 600
const MAX_ANSWER = 1200
const MAX_INPUT = 2000
const MAX_OUTPUT = 1500

// Bump a shape tag whenever that record's fields change: the engine then
// declines what an earlier version stored, which outlives a reload.
const turns = atom({ plugin: 'glass-box', key: 'turns' } as const, [], { shape: 'turns-1' })
const steps = atom({ plugin: 'glass-box', key: 'steps' } as const, [], { shape: 'steps-1' })
const calls = atom({ plugin: 'glass-box', key: 'calls' } as const, [], { shape: 'calls-2' })
const verdicts = atom({ plugin: 'glass-box', key: 'verdicts' } as const, [], {
  shape: 'verdicts-1',
})
const toggled = atom({ plugin: 'glass-box', key: 'toggled' } as const, [], {
  shape: 'toggled-1',
})

// ---------------------------------------------------------------------------
// Helpers

/** Glass Box only observes: a failure of its own must never touch the session. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Nothing to do: the timeline misses one update, the session goes on.
  }
}

async function now($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text

const firstLine = (text: string) => {
  const line = text.trim().split('\n', 1)[0] ?? ''
  return line
}

function usageOf(usage: TurnUsage | null | undefined): Usage | null {
  if (usage === null || usage === undefined) return null
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
  }
}

const formatTokens = (n: number) =>
  n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`

const contextTokens = (u: Usage) => u.input + u.cacheRead + u.cacheWrite

const formatDuration = (ms: number | null) =>
  ms === null
    ? '…'
    : ms < 1000
      ? `${ms}ms`
      : ms < 60_000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`

const formatTime = (at: number) => new Date(at).toTimeString().slice(0, 8)

const shortModel = (model: string) => model.replace(/^claude-/, '')

// Keys of a tool.call that are not the tool's own arguments.
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])
// In order of preference: the first string field present is the call's summary.
const SUMMARY_KEYS = [
  'command', 'file_path', 'notebook_path', 'pattern', 'url', 'query',
  'skill', 'description', 'prompt', 'path', 'action',
]

function argsOf(e: object): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(e)) {
    if (!RESERVED.has(key)) args[key] = value
  }
  return args
}

function summarize(args: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.replace(/\s+/g, ' ').trim()
    }
  }
  const json = JSON.stringify(args)
  return json === '{}' ? '' : json
}

function stringify(args: Record<string, unknown>): string {
  try {
    return clip(JSON.stringify(args, null, 2), MAX_INPUT)
  } catch {
    return '(arguments not serializable)'
  }
}

const CALL_STATUS: Record<CallStatus, { icon: string; color: string }> = {
  running: { icon: '●', color: 'warning' },
  ok: { icon: '✓', color: 'success' },
  error: { icon: '✗', color: 'error' },
  denied: { icon: '⊘', color: 'permission' },
}

const TURN_OUTCOME: Record<string, { icon: string; color: string; label: string }> = {
  answer: { icon: '✓', color: 'success', label: 'answered' },
  aborted: { icon: '⊘', color: 'warning', label: 'interrupted' },
  error: { icon: '✗', color: 'error', label: 'failed' },
  refusal: { icon: '✗', color: 'error', label: 'refused' },
}

const STOP_REASON: Record<string, string> = {
  tool_use: '→ tools',
  end_turn: 'done',
  max_tokens: 'hit max tokens',
  stop_sequence: 'stop sequence',
  pause_turn: 'paused',
  compaction: 'compaction',
  refusal: 'refused',
  model_context_window_exceeded: 'context full',
}

function verdictLabel(v: Verdict): string {
  if (v.decision === 'allow') {
    return v.rule !== null ? `allowed by ${v.rule}` : v.hook !== null ? `allowed by ${v.hook} hook` : 'allowed'
  }
  if (v.decision === 'deny') {
    return v.rule !== null ? `denied by ${v.rule}` : v.hook !== null ? `denied by ${v.hook} hook` : 'denied'
  }
  const by = v.plugin ?? v.setting ?? v.hook
  return by !== null ? `approval asked (${by})` : 'approval asked'
}

const VERDICT_COLOR: Record<Verdict['decision'], string> = {
  allow: 'success',
  ask: 'warning',
  deny: 'error',
}

async function patchStep($: EngineInterface, key: string, patch: (step: Step) => Step) {
  await update($, steps, list => list.map(step => (step.key === key ? patch(step) : step)))
}

// ---------------------------------------------------------------------------
// Hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'glass-box',
      description: 'Open the Glass Box pane: every turn, model step and tool call of this session',
    })
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

    return next(e)
  })

  on('command.run', { command: 'glass-box' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

    return { text: 'Glass Box opened.' }
  })

  // A turn: the prompt that starts it, on the main loop or in a subagent.
  on('turn.start', async ($, e, next) => {
    const startedAt = await now($)
    await quietly(async () => {
      const before = await read($, turns)
      const turn: Turn = {
        id: e.turnId,
        agentId: e.agentId ?? null,
        prompt: clip(e.text, MAX_PROMPT),
        startedAt,
        durationMs: null,
        outcome: null,
        usage: null,
      }
      const kept = [...before.filter(t => t.id !== turn.id), turn].slice(-MAX_TURNS)
      const keptIds = new Set(kept.map(t => t.id))
      const dropped = new Set(before.map(t => t.id).filter(id => !keptIds.has(id)))
      await update($, turns, () => kept)
      if (dropped.size > 0) {
        await update($, steps, list => list.filter(step => !dropped.has(step.turnId)))
      }
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await quietly(() =>
      update($, turns, list =>
        list.map(turn =>
          turn.id === e.turnId
            ? { ...turn, durationMs: e.durationMs, outcome: e.reason, usage: usageOf(e.usage) }
            : turn,
        ),
      ),
    )

    return next(e)
  }).catch(($, e, next) => next(e))

  // A step: one model request. The stream is passed on untouched; its `tool`
  // chunks carry the tool_use_ids that tie the step to its tool calls.
  on('turn.step', async function* ($, e, next) {
    const key = `${e.turnId}:${e.index}`
    const startedAt = await now($)
    const step: Step = {
      key,
      turnId: e.turnId,
      index: e.index,
      agentId: e.agentId ?? null,
      model: e.model,
      effort: e.effort === undefined ? null : String(e.effort),
      messageCount: e.messageCount,
      startedAt,
      durationMs: null,
      answer: '',
      toolIds: [],
      serverTools: [],
      stopReason: null,
      usage: null,
    }
    await quietly(() =>
      update($, steps, list => [...list.filter(s => s.key !== key), step].slice(-MAX_STEPS)),
    )

    const stream = next(e)
    for await (const chunk of stream) {
      if (chunk.kind === 'tool') {
        const id = chunk.id
        await quietly(() =>
          patchStep($, key, s => (s.toolIds.includes(id) ? s : { ...s, toolIds: [...s.toolIds, id] })),
        )
      }
      yield chunk
    }
    const result = await stream.result

    const endedAt = await now($)
    await quietly(() =>
      patchStep($, key, s => ({
        ...s,
        durationMs: Math.round(endedAt - startedAt),
        answer: clip(result.answer, MAX_ANSWER),
        serverTools: (result.serverToolUses ?? []).map(use => use.name),
        stopReason: result.stopReason,
        usage: usageOf(result.usage),
      })),
    )

    return result
  })

  // The permission verdict: which rule, hook, setting or plugin decided.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (id !== undefined) {
      const record: Verdict = {
        id,
        decision: verdict.decision,
        reason: verdict.reason ?? null,
        rule: verdict.rule ?? null,
        hook: verdict.hook ?? null,
        setting: verdict.setting ?? null,
        plugin: verdict.plugin ?? null,
        approver: e.approver ?? null,
      }
      await quietly(() =>
        update($, verdicts, list => [...list.filter(v => v.id !== id), record].slice(-MAX_CALLS)),
      )
    }

    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const args = argsOf(e)
    const startedAt = await now($)
    const call: ToolCall = {
      id: e.tool_use_id,
      tool: e.tool,
      summary: summarize(args),
      input: stringify(args),
      output: '',
      status: 'running',
      agentId: e.agentId ?? null,
      startedAt,
      durationMs: null,
    }
    await quietly(() =>
      update($, calls, list => [...list.filter(c => c.id !== call.id), call].slice(-MAX_CALLS)),
    )

    const finish = async (status: CallStatus, output: string) => {
      const durationMs = Math.round((await now($)) - startedAt)
      await quietly(() =>
        update($, calls, list =>
          list.map(one =>
            one.id === call.id ? { ...one, status, output: clip(output, MAX_OUTPUT), durationMs } : one,
          ),
        ),
      )
    }

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      await finish('error', String(error))
      throw error
    }
    if (ran.deny !== undefined) await finish('denied', ran.deny)
    else await finish(ran.isError === true ? 'error' : 'ok', ran.text ?? '')

    return ran
  }).catch(($, e, next) => next(e)) // observer only: if Glass Box fails, the call still runs

  // -------------------------------------------------------------------------
  // The pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [turnList, stepList, callList, verdictList, toggledList] = await Promise.all([
      read($, turns),
      read($, steps),
      read($, calls),
      read($, verdicts),
      read($, toggled),
    ])

    const callById = new Map(callList.map(c => [c.id, c]))
    const verdictById = new Map(verdictList.map(v => [v.id, v]))
    const stepsByTurn = new Map<string, Step[]>()
    for (const step of stepList) {
      const list = stepsByTurn.get(step.turnId) ?? []
      list.push(step)
      stepsByTurn.set(step.turnId, list)
    }
    const linked = new Set(stepList.flatMap(s => s.toolIds))

    // Steps whose turn started before Glass Box loaded still get a header.
    const knownTurns = new Set(turnList.map(t => t.id))
    const allTurns: Turn[] = [...turnList]
    for (const [turnId, list] of stepsByTurn) {
      if (knownTurns.has(turnId)) continue
      const first = list[0]
      allTurns.push({
        id: turnId,
        agentId: first?.agentId ?? null,
        prompt: '',
        startedAt: Math.min(...list.map(s => s.startedAt)),
        durationMs: null,
        outcome: null,
        usage: null,
      })
    }
    allTurns.sort((a, b) => b.startedAt - a.startedAt)

    const flipped = new Set(toggledList)
    const isOpen = (key: string, byDefault: boolean) => byDefault !== flipped.has(key)
    const toggle = (key: string) => () =>
      void quietly(() =>
        update($, toggled, list =>
          list.includes(key) ? list.filter(k => k !== key) : [...list, key].slice(-MAX_TOGGLED),
        ),
      )

    const failed = callList.filter(c => c.status === 'error' || c.status === 'denied').length
    const orphans = callList.filter(c => !linked.has(c.id)).reverse()

    const renderCall = (call: ToolCall, showAgent: boolean) => {
      const status = CALL_STATUS[call.status]
      const verdict = verdictById.get(call.id)
      const key = `c:${call.id}`
      const open = isOpen(key, false)

      return (
        <Box key={`call-${call.id}`} flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Text color={status.color}>{status.icon}</Text>
            <Text bold>{call.tool}</Text>
            {showAgent && call.agentId !== null && <Text color="subtle">[subagent]</Text>}
            <Text dimColor>{formatDuration(call.durationMs)}</Text>
            {verdict !== undefined && (
              <Text color={VERDICT_COLOR[verdict.decision]} wrap="truncate-end">
                {verdictLabel(verdict)}
              </Text>
            )}
          </Box>
          {call.summary !== '' && (
            <Box paddingLeft={2}>
              <Text dimColor wrap={open ? 'wrap' : 'truncate-end'}>
                {call.summary}
              </Text>
            </Box>
          )}
          {open && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              <Text color="suggestion">{`input · ${formatTime(call.startedAt)}`}</Text>
              <Text wrap="wrap">{call.input}</Text>
              <Text color="suggestion">output</Text>
              <Text wrap="wrap" color={call.status === 'ok' ? undefined : status.color}>
                {call.output === ''
                  ? call.status === 'running'
                    ? '(running)'
                    : '(empty)'
                  : call.output}
              </Text>
              <Text color="suggestion">permission</Text>
              {verdict === undefined ? (
                <Text dimColor>(no verdict recorded)</Text>
              ) : (
                <Text wrap="wrap">
                  {[
                    `decision: ${verdict.decision}`,
                    verdict.reason !== null ? `reason: ${verdict.reason}` : null,
                    verdict.rule !== null ? `rule: ${verdict.rule}` : null,
                    verdict.hook !== null ? `hook: ${verdict.hook}` : null,
                    verdict.setting !== null ? `setting: ${verdict.setting}` : null,
                    verdict.plugin !== null ? `plugin: ${verdict.plugin}` : null,
                    verdict.approver !== null ? `approver: ${verdict.approver}` : null,
                  ]
                    .filter(line => line !== null)
                    .join('\n')}
                </Text>
              )}
            </Box>
          )}
        </Box>
      )
    }

    const renderStep = (step: Step) => {
      const key = `s:${step.key}`
      const open = isOpen(key, false)
      const isRunning = step.durationMs === null
      const failedStep = !isRunning && (step.stopReason === null || step.stopReason === 'refusal')
      const icon = isRunning ? '●' : failedStep ? '✗' : '✓'
      const color = isRunning ? 'warning' : failedStep ? 'error' : 'success'
      const effort = step.effort !== null ? ` ${step.effort}` : ''
      const tokens =
        step.usage !== null
          ? ` · ${formatTokens(contextTokens(step.usage))} in · ${formatTokens(step.usage.output)} out`
          : ''
      const stop = isRunning
        ? ' · running'
        : ` · ${step.stopReason === null ? 'no response' : STOP_REASON[step.stopReason] ?? step.stopReason}`
      const stepCalls = step.toolIds.flatMap(id => {
        const call = callById.get(id)
        return call === undefined ? [] : [call]
      })

      return (
        <Box key={`step-${step.key}`} flexDirection="column" paddingLeft={2} marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Text color={color}>{icon}</Text>
            <Text bold>{`Step ${step.index + 1}`}</Text>
            <Text dimColor wrap="truncate-end">
              {`${shortModel(step.model)}${effort} · ${formatDuration(step.durationMs)}${tokens}${stop}`}
            </Text>
          </Box>
          {step.answer !== '' && (
            <Box paddingLeft={2}>
              <Text wrap={open ? 'wrap' : 'truncate-end'}>
                {open ? step.answer : firstLine(step.answer)}
              </Text>
            </Box>
          )}
          {open && (
            <Box flexDirection="column" paddingLeft={2} marginTop={1}>
              <Text dimColor>{`started ${formatTime(step.startedAt)} · ${step.messageCount} messages in the request`}</Text>
              {step.usage !== null && (
                <Text dimColor wrap="wrap">
                  {`tokens: ${step.usage.input} input · ${step.usage.cacheRead} cache read · ${step.usage.cacheWrite} cache write · ${step.usage.output} output`}
                </Text>
              )}
              {step.serverTools.length > 0 && (
                <Text dimColor wrap="wrap">{`server tools: ${step.serverTools.join(', ')}`}</Text>
              )}
            </Box>
          )}
          {stepCalls.map(call => renderCall(call, false))}
        </Box>
      )
    }

    const renderTurn = (turn: Turn, isNewest: boolean) => {
      const key = `t:${turn.id}`
      const open = isOpen(key, isNewest)
      const turnSteps = (stepsByTurn.get(turn.id) ?? []).slice().sort((a, b) => a.index - b.index)
      const toolCount = turnSteps.reduce((n, s) => n + s.toolIds.length, 0)
      const outcome = turn.outcome === null ? undefined : TURN_OUTCOME[turn.outcome]
      const icon = outcome?.icon ?? '●'
      const color = outcome?.color ?? 'warning'
      const state = outcome?.label ?? 'running'
      const prompt = turn.prompt === '' ? '(no prompt: a continuation, or started before Glass Box loaded)' : `“${turn.prompt}”`

      return (
        <Box key={`turn-${turn.id}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Text color={color}>{icon}</Text>
            <Text bold>{turn.agentId !== null ? 'Subagent turn' : 'Turn'}</Text>
            <Text dimColor wrap="truncate-end">
              {`${formatTime(turn.startedAt)} · ${turnSteps.length} steps · ${toolCount} tools · ${formatDuration(turn.durationMs)} · ${state}`}
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color="claude" wrap={open ? 'wrap' : 'truncate-end'}>
              {prompt}
            </Text>
          </Box>
          {open && turnSteps.map(renderStep)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {`${allTurns.length} turns · ${stepList.length} steps · ${callList.length} tool calls · ${failed} failed/denied`}
        </Text>
        {allTurns.length === 0 && orphans.length === 0 && (
          <Text dimColor>Nothing yet: send a prompt and watch it unfold here.</Text>
        )}
        {allTurns.map((turn, i) => renderTurn(turn, i === 0))}
        {orphans.length > 0 && (
          <Box key="orphans" flexDirection="column" marginTop={1}>
            <Text bold>Other tool calls</Text>
            <Text dimColor>Not tied to a recorded step (raised by a plugin, or before Glass Box loaded).</Text>
            {orphans.map(call => renderCall(call, true))}
          </Box>
        )}
      </Box>
    )
  })
}
