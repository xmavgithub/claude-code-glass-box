import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CallStatus, ServerTool, Step, ToolCall, Turn, Usage, Verdict, View } from '../types'

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
const steps = atom({ plugin: 'glass-box', key: 'steps' } as const, [], { shape: 'steps-2' })
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
  { id: 'guide', label: 'How it works', hotkey: '3' },
]

// The session's working directory, to show paths relative to it, and the
// advisor model the settings name. Set at session.start, which runs again on
// every reload.
let cwd = ''
let advisorModel: string | null = null

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

/** Why the model stopped writing, in plain words. `tool_use` is told with its count. */
const STOP_REASON: Record<string, string> = {
  tool_use: 'asked for tools',
  end_turn: 'answered',
  max_tokens: 'stopped: output limit reached',
  stop_sequence: 'stopped at a stop sequence',
  pause_turn: 'paused',
  compaction: 'compacted the context',
  refusal: 'refused',
  model_context_window_exceeded: 'stopped: context full',
}

function stopLabel(step: Step): string {
  if (step.durationMs === null) return 'running'
  if (step.stopReason === null) return 'no response (interrupted or failed)'
  if (step.stopReason === 'tool_use' && step.toolIds.length > 0) {
    return `asked for ${plural(step.toolIds.length, 'tool', 'tools')}`
  }
  return STOP_REASON[step.stopReason] ?? step.stopReason
}

const modelLabel = (step: Step) =>
  `${shortModel(step.model)}${step.effort !== null ? ` · ${step.effort} effort` : ''}`

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
      return { label: `allowed: rule ${v?.rule ?? ''}` }
    case 'hook':
      return { label: 'allowed: hook' }
    default:
      return { label: kind }
  }
}

/** The verdict as a sentence anyone can read. */
function explainVerdict(v: Verdict | undefined, call: ToolCall): string {
  const kind = verdictKind(v, call)
  const why = v?.reason != null ? ` (${v.reason})` : ''
  switch (kind) {
    case 'none':
      return 'No permission check was recorded for this call: it may have started before Glass Box loaded, or another plugin raised it.'
    case 'rule':
      return `Allowed without asking: your settings contain the rule ${v?.rule ?? ''}.`
    case 'hook':
      return `Allowed by a ${v?.hook ?? ''} hook: a script from your settings or from a plugin approved it before it ran.`
    case 'allowed':
      return v?.reason != null
        ? `Allowed without asking: ${v.reason}`
        : 'Allowed without asking, by the permission mode or because the tool only reads.'
    case 'approved':
      return `Claude Code asked for approval${why}, and the call was approved: by you, or automatically in auto mode.`
    case 'rejected':
      return `Claude Code asked for approval${why}, and the call was rejected. The model was told it could not run.`
    case 'awaiting':
      return `Waiting for approval${why}.`
    case 'denied': {
      const by = v?.rule != null ? ` by the rule ${v.rule} in your settings` : v?.hook != null ? ` by a ${v.hook} hook` : ''
      return `Denied${by}${why}. The tool did not run; the model was told why.`
    }
  }
}

async function patchStep($: EngineInterface, key: string, patch: (step: Step) => Step) {
  await update($, steps, list => list.map(step => (step.key === key ? patch(step) : step)))
}

/** Every string under a key named `key`, depth first, in a block of unknown shape. */
function collect(value: unknown, key: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) collect(item, key, out, depth + 1)
    return out
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === key && typeof v === 'string') out.push(v)
    else collect(v, key, out, depth + 1)
  }
  return out
}

/**
 * Server tools run inside the model request: their result is in the
 * transcript, not in the step's result. Read it back from the conversation,
 * in its API form, for every server tool of this loop still without one.
 */
async function fillServerResults($: EngineInterface, agentId: string | null) {
  const list = await read($, steps)
  const pending = new Set(
    list
      .filter(s => s.agentId === agentId)
      .flatMap(s => s.serverTools.filter(t => t.output === null).map(t => t.id)),
  )
  if (pending.size === 0) return

  const answer = await $.session.messages(agentId === null ? { as: 'api' } : { as: 'api', agentId })
  if (!Array.isArray(answer)) return // a hook refused the read
  const messages = answer
  const found = new Map<string, { output: string; model: string | null }>()
  for (const message of messages) {
    for (const block of message.content) {
      const id = block['tool_use_id']
      if (typeof id !== 'string' || !pending.has(id)) continue
      const { type: _type, tool_use_id: _id, ...rest } = block
      const text = collect(rest, 'text').join('\n')
      found.set(id, {
        output: clip(text !== '' ? text : JSON.stringify(rest, null, 2), MAX_OUTPUT),
        model: collect(rest, 'model')[0] ?? null,
      })
    }
  }
  if (found.size === 0) return

  await update($, steps, all =>
    all.map(step =>
      step.serverTools.some(t => found.has(t.id))
        ? {
            ...step,
            serverTools: step.serverTools.map(t => {
              const hit = found.get(t.id)
              return hit === undefined ? t : { ...t, output: hit.output, model: hit.model }
            }),
          }
        : step,
    ),
  )
}

// ---------------------------------------------------------------------------
// Hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await quietly(async () => {
      const model = await $.settings.read({ key: 'advisorModel' })
      advisorModel = typeof model === 'string' && model !== '' ? model : null
    })
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
    await quietly(() => fillServerResults($, e.agentId ?? null))
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
    // The previous step's server tools are in the transcript by now.
    await quietly(() => fillServerResults($, e.agentId ?? null))
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
                serverTools: (done.serverToolUses ?? []).map(
                  (use): ServerTool => ({
                    id: use.id,
                    name: use.name,
                    input:
                      use.input !== null && typeof use.input === 'object'
                        ? stringify(use.input as Record<string, unknown>)
                        : JSON.stringify(use.input ?? null),
                    startedAt: use.startedAt,
                    durationMs: use.endedAt === undefined ? null : Math.round(use.endedAt - use.startedAt),
                    output: null,
                    model: null,
                  }),
                ),
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
      const technical =
        verdict === undefined
          ? null
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
          <Text wrap="wrap">{explainVerdict(verdict, call)}</Text>
          {technical !== null && (
            <Text wrap="wrap" dimColor>
              {technical}
            </Text>
          )}
        </Box>
      )
    }

    // A tool the model API ran inside the step: no permission check, no call.
    const serverModel = (tool: ServerTool) =>
      tool.model ?? (tool.name === 'advisor' && advisorModel !== null ? `${advisorModel} (from your settings)` : null)

    const serverLine = (tool: ServerTool, indent: number) => {
      const done = tool.durationMs !== null
      const model = serverModel(tool)

      return (
        <Box key={`server-${tool.id}`} paddingLeft={indent} {...fit(indent)}>
          <Text wrap="truncate-end">
            <Text color={done ? 'success' : 'warning'}>{done ? '✓' : '●'}</Text>
            <Text bold>{` ${tool.name}`}</Text>
            <Text dimColor>{`  ${formatDuration(tool.durationMs)}  ran by the model API`}</Text>
            {model !== null && <Text>{`  model ${model}`}</Text>}
          </Text>
        </Box>
      )
    }

    const serverDetail = (tool: ServerTool, indent: number) => {
      const model = serverModel(tool)

      return (
        <Box key={`sdetail-${tool.id}`} flexDirection="column" paddingLeft={indent + 2} marginBottom={1} {...fit(indent + 2)}>
          <Text dimColor wrap="wrap">
            {`The model API ran ${tool.name} itself, inside this step, at ${formatTime(tool.startedAt)}. Claude Code ran nothing for it: no permission check, no tool call.${model !== null ? ` Model: ${model}.` : ''}`}
          </Text>
          <Text color="suggestion">input</Text>
          <Text wrap="wrap">{tool.input}</Text>
          <Text color="suggestion">output</Text>
          <Text wrap="wrap" dimColor={tool.output === null}>
            {tool.output === null ? '(not read from the transcript yet: it is read when the next step or the turn ends)' : tool.output}
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
          ? `${modelLabel(step)} · `
          : ''
      const out = step.usage !== null ? ` · wrote ${formatTokens(step.usage.output)} tokens` : ''
      const state = stopLabel(step)
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
                {`At ${formatTime(step.startedAt)} Claude Code sent the conversation (${plural(step.messageCount, 'message', 'messages')}) to ${modelLabel(step)}.`}
              </Text>
              {step.usage !== null && (
                <Text dimColor wrap="wrap">
                  {`tokens: ${formatTokens(contextTokens(step.usage))} context (${formatTokens(step.usage.cacheRead)} cached, ${formatTokens(step.usage.cacheWrite)} written, ${formatTokens(step.usage.input)} new) · ${formatTokens(step.usage.output)} output`}
                </Text>
              )}
            </Box>
          )}
          {step.serverTools.map(tool => (
            <Box key={`srow-${tool.id}`} flexDirection="column">
              {serverLine(tool, 2)}
              {open && serverDetail(tool, 2)}
            </Box>
          ))}
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
        plural(toolCount, 'tool call', 'tool calls'),
        lastUsage !== null ? `context ${formatTokens(contextTokens(lastUsage))}` : null,
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
      const byServerTool = new Map<string, ServerTool[]>()
      for (const tool of stepList.flatMap(s => s.serverTools)) {
        const list = byServerTool.get(tool.name) ?? []
        list.push(tool)
        byServerTool.set(tool.name, list)
      }
      for (const [name, list] of byServerTool) {
        const total = list.reduce((ms, t) => ms + (t.durationMs ?? 0), 0)
        toolRows.push({
          label: `${name} ·server tool`,
          count: list.length,
          value: `${plural(list.length, 'call', 'calls')} · ${formatDuration(total)} · avg ${formatDuration(Math.round(total / list.length))}`,
        })
      }
      toolRows.sort((a, b) => b.count - a.count)
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
          {line('m-out', 'output', `${formatTokens(output)} tokens written`, 13)}
          {line('m-ctx', 'context', `largest ${formatTokens(peak)} tokens${context > 0 ? ` · ${Math.round((cached / context) * 100)}% read from cache` : ''}`, 13)}
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

    // --- How it works: the agent loop, told with the session's own numbers.

    const para = (key: string, text: string, dim = false) => (
      <Box key={key} paddingLeft={2} {...fit(2)}>
        <Text wrap="wrap" dimColor={dim}>
          {text}
        </Text>
      </Box>
    )
    const term = (key: string, name: string, text: string) => (
      <Box key={key} paddingLeft={2} {...fit(2)}>
        <Text wrap="wrap">
          <Text bold>{name}</Text>
          <Text dimColor>{` ${text}`}</Text>
        </Text>
      </Box>
    )

    const renderGuide = () => {
      const last = allTurns.find(t => t.agentId === null) ?? allTurns[0]
      const lastSteps = last === undefined ? [] : stepsByTurn.get(last.id) ?? []
      const lastCalls = lastSteps.flatMap(s => s.toolIds.flatMap(id => callById.get(id) ?? []))
      const lastFailed = lastCalls.filter(c => c.status === 'error' || c.status === 'denied').length
      const lastOut = lastSteps.reduce((n, s) => n + (s.usage?.output ?? 0), 0)
      const example =
        last === undefined
          ? 'Once you send a message, your own numbers appear here.'
          : `Your last turn: ${plural(lastSteps.length, 'step', 'steps')}, ${plural(lastCalls.length, 'tool call', 'tool calls')}${lastFailed > 0 ? ` (${lastFailed} failed)` : ''}, ${formatTokens(lastOut)} tokens written${last.durationMs !== null ? `, ${formatDuration(last.durationMs)}` : ''}.`

      return (
        <Box flexDirection="column">
          {section('The loop')}
          {para('g-intro', 'Claude Code is a loop around a model. The model only reads and writes text; Claude Code runs everything else.')}
          {term('g-1', '1. Turn.', 'You send a message. Everything Claude Code does until it answers you is one turn.')}
          {term('g-2', '2. Step.', 'Claude Code sends the whole conversation to the model. The model writes text and may ask for tools. One request and its answer is one step.')}
          {term('g-3', '3. Permission check.', 'Before each tool runs, Claude Code checks your settings, hooks and permission mode: allowed, asked, or denied.')}
          {term('g-4', '4. Tool call.', 'Claude Code runs the tool (read a file, run a command, search the web…) and adds its result to the conversation.')}
          {term('g-5', '5. Again.', 'With the results, Claude Code starts a new step. The turn ends when a step answers without asking for tools.')}
          {para('g-example', example, true)}

          {section('Reading the timeline')}
          {term('g-s1', '● ✓ ✗ ⊘', 'running, done, failed, denied.')}
          {term('g-s2', '▸ ▾', 'open or close a turn or a step. An open step shows its full text, its tokens, and each tool call in full: input, output, and why it was allowed.')}
          {term('g-s3', '› text', 'what the model wrote in that step, before asking for tools or as its answer.')}
          {term('g-s4', 'Colors', 'are kept for what needs attention: yellow waits, red failed or was refused. Routine details are dim.')}

          {section('Words')}
          {term('g-w1', 'Token.', 'The unit a model reads and writes, roughly three quarters of a word. Cost and limits are counted in tokens.')}
          {term('g-w2', 'Context.', 'Everything the model reads at a step: instructions, the conversation, tool results. It grows step after step; when it is nearly full, Claude Code compacts it into a summary.')}
          {term('g-w3', 'Cache.', 'The part of the context the model already read on an earlier step. Reading it again is cheaper and faster.')}
          {term('g-w4', 'Effort.', 'How much the model is asked to think before it writes.')}
          {term('g-w5', 'Permission rule.', 'A line in your settings, such as Bash(git:*), that allows or denies matching tool calls without asking.')}
          {term('g-w6', 'Hook.', 'A script from your settings or from a plugin that runs around a tool call and can allow, deny or change it.')}
          {term('g-w7', 'Auto mode.', 'A permission mode in which Claude Code settles approvals itself instead of asking you.')}
          {term('g-w8', 'Subagent.', 'A helper Claude starts for a sub-task. It has its own turns, steps and tool calls, shown as Subagent turns.')}
          {term('g-w9', 'MCP tool.', 'A tool from an external server, shown as tool ·server.')}
          {term('g-w10', 'Server tool.', 'A tool the model API runs itself inside a step, such as the advisor: a second model the main one consults for a review or a plan. Claude Code runs nothing for it, so there is no permission check. Glass Box shows when it ran, how long it took, the model your settings name for the advisor, and its result as the transcript keeps it.')}

          {section('What Glass Box cannot see')}
          {para('g-limits', 'The model’s private reasoning, how a server tool worked inside (only its input and result reach the transcript), and anything that happened before Glass Box loaded. It only observes: it never changes, delays or blocks what Claude Code does.', true)}
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
        {current === 'stats' ? renderStats() : current === 'guide' ? renderGuide() : renderTimeline()}
      </Box>
    )

    function renderTimeline() {
      return (
        <Box flexDirection="column">
        {allTurns.length === 0 && orphans.length === 0 && (
          <Box flexDirection="column" {...fit(0)}>
            <Text dimColor wrap="wrap">
              Nothing yet. Send Claude a message: each turn, every step the model takes and every tool it calls will appear here as it happens.
            </Text>
            <Text dimColor wrap="wrap">New to this? Open How it works (press 3 while the pane has the keyboard).</Text>
          </Box>
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
