import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CallStatus, Step, ToolCall, Turn, Usage, Verdict, View } from '../types'

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
const view = atom({ plugin: 'glass-box', key: 'view' } as const, 'timeline', { shape: 'view-1' })

const TABS: readonly { id: View; label: string; hotkey: string }[] = [
  { id: 'timeline', label: 'Timeline', hotkey: '1' },
  { id: 'stats', label: 'Stats', hotkey: '2' },
]

// The session's working directory, to show paths relative to it. Set at
// session.start, which runs again on every reload.
let cwd = ''

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

const firstLine = (text: string) => text.trim().split('\n', 1)[0] ?? ''

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Paths relative to the working directory, and the home folder as `~`. */
function tidy(text: string): string {
  if (cwd === '') return text
  let out = text.split(`${cwd}/`).join('')
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(cwd)?.[1]
  if (home !== undefined) out = out.split(`${home}/`).join('~/')
  return out
}

/** `mcp__server__tool` reads as `tool` from `server`. */
function toolName(tool: string): { name: string; server: string | null } {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)
  return match === null ? { name: tool, server: null } : { name: match[2] ?? tool, server: match[1] ?? null }
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
  const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()
  for (const key of SUMMARY_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
  }
  // Any other tool (an MCP tool, say): its first string argument.
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
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
  denied: { icon: '⊘', color: 'error' },
}

const TURN_OUTCOME: Record<string, { icon: string; color: string; label: string | null }> = {
  answer: { icon: '✓', color: 'success', label: null },
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

/** What the permission check on a call came to. */
type VerdictKind = 'rule' | 'hook' | 'allowed' | 'approved' | 'rejected' | 'awaiting' | 'denied' | 'none'

function verdictKind(v: Verdict | undefined, call: ToolCall): VerdictKind {
  if (v === undefined) return 'none'
  if (v.decision === 'deny') return 'denied'
  if (v.decision === 'ask') {
    if (call.status === 'running') return 'awaiting'
    // A refused ask reaches the model as an error result, not as a deny.
    const refused = /^Permission to use .+ (has been|was) denied/.test(call.output)
    return call.status === 'denied' || refused ? 'rejected' : 'approved'
  }
  return v.rule !== null ? 'rule' : v.hook !== null ? 'hook' : 'allowed'
}

/**
 * The verdict in a word or two. Routine outcomes have no color (drawn dim);
 * only what deserves attention is colored.
 */
function verdictOutcome(v: Verdict | undefined, call: ToolCall): { label: string; color?: string } | null {
  const kind = verdictKind(v, call)
  switch (kind) {
    case 'none':
      return null
    case 'denied':
      return { label: v?.rule != null ? `denied · ${v.rule}` : 'denied', color: 'error' }
    case 'awaiting':
      return { label: 'awaiting approval', color: 'warning' }
    case 'rejected':
      return { label: 'rejected', color: 'error' }
    case 'rule':
      return { label: v?.rule ?? 'rule' }
    default:
      return { label: kind }
  }
}

async function patchStep($: EngineInterface, key: string, patch: (step: Step) => Step) {
  await update($, steps, list => list.map(step => (step.key === key ? patch(step) : step)))
}

// ---------------------------------------------------------------------------
// Hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
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
    let result: Awaited<typeof stream.result> | undefined
    try {
      for await (const chunk of stream) {
        if (chunk.kind === 'tool') {
          const id = chunk.id
          await quietly(() =>
            patchStep($, key, s => (s.toolIds.includes(id) ? s : { ...s, toolIds: [...s.toolIds, id] })),
          )
        }
        yield chunk
      }
      result = await stream.result

      return result
    } finally {
      // Runs also when the stream is closed early (an interrupted turn), so a
      // step never stays "running" forever.
      const endedAt = await now($)
      const done = result
      await quietly(() =>
        patchStep($, key, s => ({
          ...s,
          durationMs: Math.round(endedAt - startedAt),
          ...(done === undefined
            ? { stopReason: null }
            : {
                answer: clip(done.answer, MAX_ANSWER),
                serverTools: (done.serverToolUses ?? []).map(use => use.name),
                stopReason: done.stopReason,
                usage: usageOf(done.usage),
              }),
        })),
      )
    }
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
  //
  // One line per item, each a single Text the surface truncates with "…". The
  // terminal gets an explicit width from the pane's body, so a line never runs
  // past the edge. Only turns and steps have a toggle: a step opens on its
  // text, its tokens and the details of its tool calls.

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [turnList, stepList, callList, verdictList, toggledList, current] = await Promise.all([
      read($, turns),
      read($, steps),
      read($, calls),
      read($, verdicts),
      read($, toggled),
      read($, view),
    ])

    const columns = e.props.bodyColumns
    /** The width a line indented by `indent` cells may take, on the terminal. */
    const fit = (indent: number) =>
      e.surface === 'terminal' ? { width: Math.max(8, columns - indent) } : {}

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
      allTurns.push({
        id: turnId,
        agentId: list[0]?.agentId ?? null,
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

    // One tool call on one line: status, tool, duration, verdict, main argument.
    const callLine = (call: ToolCall, indent: number, showAgent: boolean) => {
      const status = CALL_STATUS[call.status]
      const { name, server } = toolName(call.tool)
      const outcome = verdictOutcome(verdictById.get(call.id), call)

      return (
        <Box key={`call-${call.id}`} paddingLeft={indent} {...fit(indent)}>
          <Text wrap="truncate-end">
            <Text color={status.color}>{status.icon}</Text>
            <Text bold>{` ${name}`}</Text>
            {server !== null && <Text dimColor>{` ·${server}`}</Text>}
            {showAgent && call.agentId !== null && <Text color="subtle">{' [subagent]'}</Text>}
            <Text dimColor>{`  ${formatDuration(call.durationMs)}`}</Text>
            {outcome !== null &&
              (outcome.color === undefined ? (
                <Text dimColor>{`  ${outcome.label}`}</Text>
              ) : (
                <Text color={outcome.color}>{`  ${outcome.label}`}</Text>
              ))}
            {call.summary !== '' && <Text>{`  ${tidy(call.summary)}`}</Text>}
          </Text>
        </Box>
      )
    }

    // A call's full record, shown under its line while its step is open.
    const callDetail = (call: ToolCall, indent: number) => {
      const verdict = verdictById.get(call.id)
      const status = CALL_STATUS[call.status]
      const permission =
        verdict === undefined
          ? '(no verdict recorded)'
          : [
              `decision: ${verdict.decision}`,
              verdict.reason !== null ? `reason: ${verdict.reason}` : null,
              verdict.rule !== null ? `rule: ${verdict.rule}` : null,
              verdict.hook !== null ? `hook: ${verdict.hook}` : null,
              verdict.setting !== null ? `setting: ${verdict.setting}` : null,
              verdict.plugin !== null ? `plugin: ${verdict.plugin}` : null,
              verdict.approver !== null ? `approver: ${verdict.approver}` : null,
            ]
              .filter(line => line !== null)
              .join('\n')

      return (
        <Box key={`detail-${call.id}`} flexDirection="column" paddingLeft={indent + 2} marginBottom={1} {...fit(indent + 2)}>
          <Text color="suggestion">{`input · ${formatTime(call.startedAt)}`}</Text>
          <Text wrap="wrap">{tidy(call.input)}</Text>
          <Text color="suggestion">output</Text>
          <Text wrap="wrap" color={call.status === 'ok' ? undefined : status.color}>
            {call.output === '' ? (call.status === 'running' ? '(running)' : '(empty)') : tidy(call.output)}
          </Text>
          <Text color="suggestion">permission</Text>
          <Text wrap="wrap" dimColor={verdict === undefined}>
            {permission}
          </Text>
        </Box>
      )
    }

    const renderStep = (step: Step, previous: Step | undefined) => {
      const key = `s:${step.key}`
      const open = isOpen(key, false)
      const isRunning = step.durationMs === null
      const failedStep = !isRunning && (step.stopReason === null || step.stopReason === 'refusal')
      const icon = isRunning ? '●' : failedStep ? '✗' : '✓'
      const color = isRunning ? 'warning' : failedStep ? 'error' : 'success'
      // The model only where it changes: the first step, or a switch.
      const model =
        previous === undefined || previous.model !== step.model || previous.effort !== step.effort
          ? `${shortModel(step.model)}${step.effort !== null ? ` ${step.effort}` : ''} · `
          : ''
      const out = step.usage !== null ? ` · out ${formatTokens(step.usage.output)}` : ''
      const state = isRunning
        ? 'running'
        : step.stopReason === null
          ? 'no response'
          : STOP_REASON[step.stopReason] ?? step.stopReason
      const stepCalls = step.toolIds.flatMap(id => {
        const call = callById.get(id)
        return call === undefined ? [] : [call]
      })

      return (
        <Box key={`step-${step.key}`} flexDirection="column" paddingLeft={2} marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain dimColor label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Box {...fit(4)}>
              <Text wrap="truncate-end">
                <Text color={color}>{icon}</Text>
                <Text bold>{` Step ${step.index + 1}`}</Text>
                <Text dimColor>
                  {` · ${model}${isRunning ? '' : `${formatDuration(step.durationMs)}${out} · `}${state}`}
                </Text>
              </Text>
            </Box>
          </Box>
          {step.answer !== '' && (
            <Box paddingLeft={2} {...fit(4)}>
              <Text dimColor italic wrap={open ? 'wrap' : 'truncate-end'}>
                {`› ${open ? step.answer : firstLine(step.answer)}`}
              </Text>
            </Box>
          )}
          {open && (
            <Box flexDirection="column" paddingLeft={2} marginBottom={1} {...fit(4)}>
              <Text dimColor wrap="wrap">
                {`${shortModel(step.model)}${step.effort !== null ? ` · effort ${step.effort}` : ''} · ${step.messageCount} messages · started ${formatTime(step.startedAt)}`}
              </Text>
              {step.usage !== null && (
                <Text dimColor wrap="wrap">
                  {`tokens: ${formatTokens(contextTokens(step.usage))} context (${formatTokens(step.usage.cacheRead)} cached, ${formatTokens(step.usage.cacheWrite)} written, ${formatTokens(step.usage.input)} new) · ${formatTokens(step.usage.output)} output`}
                </Text>
              )}
              {step.serverTools.length > 0 && (
                <Text dimColor wrap="wrap">{`server tools: ${step.serverTools.join(', ')}`}</Text>
              )}
            </Box>
          )}
          {stepCalls.map(call => (
            <Box key={`row-${call.id}`} flexDirection="column">
              {callLine(call, 2, false)}
              {open && callDetail(call, 2)}
            </Box>
          ))}
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
      const lastUsage = [...turnSteps].reverse().find(s => s.usage !== null)?.usage ?? null
      const meta = [
        formatTime(turn.startedAt).slice(0, 5),
        plural(turnSteps.length, 'step', 'steps'),
        plural(toolCount, 'tool', 'tools'),
        lastUsage !== null ? `ctx ${formatTokens(contextTokens(lastUsage))}` : null,
        outcome === undefined ? 'running' : formatDuration(turn.durationMs),
        outcome?.label ?? null,
      ]
        .filter(part => part !== null)
        .join(' · ')
      const prompt =
        turn.prompt === ''
          ? '(no prompt: a continuation, or started before Glass Box loaded)'
          : `“${turn.prompt}”`

      return (
        <Box key={`turn-${turn.id}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Box {...fit(2)}>
              <Text wrap="truncate-end">
                <Text color={color}>{icon}</Text>
                <Text bold>{turn.agentId !== null ? ' Subagent' : ' Turn'}</Text>
                <Text dimColor>{` · ${meta}`}</Text>
              </Text>
            </Box>
          </Box>
          <Box paddingLeft={2} {...fit(2)}>
            <Text color="claude" wrap={open ? 'wrap' : 'truncate-end'}>
              {prompt}
            </Text>
          </Box>
          {open && turnSteps.map((step, i) => renderStep(step, turnSteps[i - 1]))}
        </Box>
      )
    }

    const othersOpen = isOpen('o:others', false)

    // --- Stats: the session at a glance, from what Glass Box keeps.

    const line = (key: string, label: string, value: string, labelWidth: number) => (
      <Box key={key} paddingLeft={2} {...fit(2)}>
        <Text wrap="truncate-end">
          <Text>{e.surface === 'terminal' ? label.padEnd(labelWidth) : label}</Text>
          <Text dimColor>{`  ${value}`}</Text>
        </Text>
      </Box>
    )
    const section = (title: string) => (
      <Box key={`section-${title}`} marginTop={1}>
        <Text bold>{title}</Text>
      </Box>
    )

    const renderStats = () => {
      const byTool = new Map<string, ToolCall[]>()
      for (const call of callList) {
        const list = byTool.get(call.tool) ?? []
        list.push(call)
        byTool.set(call.tool, list)
      }
      const toolRows = [...byTool.entries()]
        .map(([tool, list]) => {
          const { name, server } = toolName(tool)
          const done = list.filter(c => c.durationMs !== null)
          const total = done.reduce((ms, c) => ms + (c.durationMs ?? 0), 0)
          const failures = list.filter(c => c.status === 'error' || c.status === 'denied').length
          return {
            label: server === null ? name : `${name} ·${server}`,
            count: list.length,
            value: [
              plural(list.length, 'call', 'calls'),
              failures > 0 ? `${failures} failed` : null,
              formatDuration(total),
              done.length > 0 ? `avg ${formatDuration(Math.round(total / done.length))}` : null,
            ]
              .filter(part => part !== null)
              .join(' · '),
          }
        })
        .sort((a, b) => b.count - a.count)
      const labelWidth = Math.min(24, Math.max(4, ...toolRows.map(r => r.label.length)))

      const kinds = new Map<VerdictKind, number>()
      for (const call of callList) {
        const kind = verdictKind(verdictById.get(call.id), call)
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      }
      const KIND_LABEL: Record<VerdictKind, string> = {
        rule: 'by a settings rule',
        hook: 'by a hook',
        allowed: 'allowed by the mode or the tool',
        approved: 'asked, then approved',
        rejected: 'asked, then rejected',
        awaiting: 'awaiting approval',
        denied: 'denied',
        none: 'no verdict recorded',
      }
      const ruleCounts = new Map<string, number>()
      for (const v of verdictList) {
        if (v.rule !== null) ruleCounts.set(v.rule, (ruleCounts.get(v.rule) ?? 0) + 1)
      }

      const finished = stepList.filter(s => s.durationMs !== null)
      const modelMs = finished.reduce((ms, s) => ms + (s.durationMs ?? 0), 0)
      const toolMs = callList.reduce((ms, c) => ms + (c.durationMs ?? 0), 0)
      const output = stepList.reduce((n, s) => n + (s.usage?.output ?? 0), 0)
      const peak = Math.max(0, ...stepList.map(s => (s.usage === null ? 0 : contextTokens(s.usage))))
      const cached = stepList.reduce((n, s) => n + (s.usage?.cacheRead ?? 0), 0)
      const context = stepList.reduce((n, s) => n + (s.usage === null ? 0 : contextTokens(s.usage)), 0)
      const stops = new Map<string, number>()
      for (const s of finished) {
        const label = s.stopReason === null ? 'no response' : STOP_REASON[s.stopReason] ?? s.stopReason
        stops.set(label, (stops.get(label) ?? 0) + 1)
      }
      const models = new Map<string, number>()
      for (const s of stepList) models.set(shortModel(s.model), (models.get(shortModel(s.model)) ?? 0) + 1)

      if (callList.length === 0 && stepList.length === 0) {
        return <Text dimColor>No activity recorded yet.</Text>
      }

      return (
        <Box flexDirection="column">
          {section('Tools')}
          {toolRows.length === 0 && line('tools-none', 'none yet', '', 8)}
          {toolRows.map(row => line(`tool-${row.label}`, row.label, row.value, labelWidth))}

          {section('Permissions')}
          {[...kinds.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => line(`kind-${kind}`, `${n}`, KIND_LABEL[kind], 4))}
          {[...ruleCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([rule, n]) => line(`rule-${rule}`, `${n}`, `rule ${rule}`, 4))}

          {section('Model')}
          {line('m-steps', 'steps', `${stepList.length}${finished.length > 0 ? ` · avg ${formatDuration(Math.round(modelMs / finished.length))}` : ''}`, 13)}
          {line('m-time', 'time', `${formatDuration(modelMs)} in the model · ${formatDuration(toolMs)} in tools`, 13)}
          {line('m-out', 'output', `${formatTokens(output)} tokens`, 13)}
          {line('m-ctx', 'context', `peak ${formatTokens(peak)}${context > 0 ? ` · ${Math.round((cached / context) * 100)}% from cache` : ''}`, 13)}
          {line('m-stop', 'stops', [...stops.entries()].map(([label, n]) => `${label} ${n}`).join(' · ') || '—', 13)}
          {line('m-models', 'models', [...models.entries()].map(([m, n]) => `${m} ${n}`).join(' · ') || '—', 13)}
          <Box paddingLeft={2} marginTop={1} {...fit(2)}>
            <Text dimColor wrap="wrap">
              {`Over what Glass Box keeps: the last ${MAX_TURNS} turns and ${MAX_CALLS} tool calls. Time in tools adds up calls that ran in parallel.`}
            </Text>
          </Box>
        </Box>
      )
    }

    const tabBar = (
      <Box flexDirection="row" gap={1} marginBottom={1}>
        {TABS.map(tab =>
          tab.id === current ? (
            <Button key={`v:${tab.id}`} variant="primary" hotkey={tab.hotkey} label={tab.label} onPress={() => undefined} />
          ) : (
            <Button
              key={`v:${tab.id}`}
              hotkey={tab.hotkey}
              label={tab.label}
              onPress={() => void quietly(() => update($, view, () => tab.id))}
            />
          ),
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabBar}
        <Box {...fit(0)}>
          <Text dimColor wrap="truncate-end">
            {[
              plural(allTurns.length, 'turn', 'turns'),
              plural(stepList.length, 'step', 'steps'),
              plural(callList.length, 'tool call', 'tool calls'),
              `${failed} failed`,
            ].join(' · ')}
          </Text>
        </Box>
        {current === 'stats' ? renderStats() : renderTimeline()}
      </Box>
    )

    function renderTimeline() {
      return (
        <Box flexDirection="column">
        {allTurns.length === 0 && orphans.length === 0 && (
          <Text dimColor>Nothing yet: send a prompt and watch it unfold here.</Text>
        )}
        {allTurns.map((turn, i) => renderTurn(turn, i === 0))}
        {orphans.length > 0 && (
          <Box key="orphans" flexDirection="column" marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Button key="o:others" plain dimColor label={othersOpen ? '▾' : '▸'} onPress={toggle('o:others')} />
              <Box {...fit(2)}>
                <Text wrap="truncate-end">
                  <Text bold>Other tool calls</Text>
                  <Text dimColor>{' · not tied to a recorded step'}</Text>
                </Text>
              </Box>
            </Box>
            {orphans.map(call => (
              <Box key={`row-${call.id}`} flexDirection="column">
                {callLine(call, 2, true)}
                {othersOpen && callDetail(call, 2)}
              </Box>
            ))}
          </Box>
        )}
        </Box>
      )
    }
  })
}
