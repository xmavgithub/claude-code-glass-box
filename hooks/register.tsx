import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type {
  Breakdown,
  CallStatus,
  Change,
  Compaction,
  ContextSnapshot,
  Injection,
  OfferedTool,
  PromptSnapshot,
  Resources,
  Rewrite,
  SkillLoad,
  ServerTool,
  Spawn,
  Step,
  ToolCall,
  Turn,
  Usage,
  Verdict,
  View,
} from '../types'

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
const MAX_INJECTIONS = 200
const MAX_INJECTION_TEXT = 4000
const MAX_CHANGE = 400
const MAX_PROMPTS = 5
const MAX_SECTION_TEXT = 3000
const MAX_SKILLS = 50
const MAX_SKILL_TEXT = 3000
const MAX_TOOLS = 400
const MAX_SPAWN_PROMPT = 3000

// Bump a shape tag whenever that record's fields change: the engine then
// declines what an earlier version stored, which outlives a reload.
const turns = atom({ plugin: 'glass-box', key: 'turns' } as const, [], { shape: 'turns-2' })
const steps = atom({ plugin: 'glass-box', key: 'steps' } as const, [], { shape: 'steps-2' })
const calls = atom({ plugin: 'glass-box', key: 'calls' } as const, [], { shape: 'calls-2' })
const verdicts = atom({ plugin: 'glass-box', key: 'verdicts' } as const, [], {
  shape: 'verdicts-1',
})
const toggled = atom({ plugin: 'glass-box', key: 'toggled' } as const, [], {
  shape: 'toggled-1',
})
const view = atom({ plugin: 'glass-box', key: 'view' } as const, 'timeline', { shape: 'view-1' })
const rewrites = atom({ plugin: 'glass-box', key: 'rewrites' } as const, [], {
  shape: 'rewrites-1',
})
const injections = atom({ plugin: 'glass-box', key: 'injections' } as const, [], {
  shape: 'injections-1',
})

const prompts = atom({ plugin: 'glass-box', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const contextSnapshot = atom({ plugin: 'glass-box', key: 'context' } as const, null, {
  shape: 'context-1',
})
const skills = atom({ plugin: 'glass-box', key: 'skills' } as const, [], { shape: 'skills-1' })
const tools = atom({ plugin: 'glass-box', key: 'tools' } as const, [], { shape: 'tools-1' })
const resources = atom({ plugin: 'glass-box', key: 'resources' } as const, null, {
  shape: 'resources-1',
})
const breakdown = atom({ plugin: 'glass-box', key: 'breakdown' } as const, null, {
  shape: 'breakdown-1',
})
const compactions = atom({ plugin: 'glass-box', key: 'compactions' } as const, [], {
  shape: 'compactions-1',
})

const MAX_COMPACTIONS = 50
// The subagents started, each tied to the call that started it.
const agents = atom({ plugin: 'glass-box', key: 'agents' } as const, [], { shape: 'agents-1' })
const MAX_AGENTS = 100
// The /context-style breakdown is estimated locally: at most this often.
const BREAKDOWN_EVERY_MS = 30_000
let lastBreakdownAt = 0
// The session's cost when each turn started, to tell what the turn cost.
const costAtStart = new Map<string, number>()

// Gives each injection and skill load an id of its own, with its time.
let injectionSeq = 0

// What was last written, so events raised on every request (the system
// prompt, the tool list) only touch the state when something changed.
const composeSeen = new Map<string, string>()
let contextSeen = ''
const toolSeen = new Map<string, string>()

const TABS: readonly { id: View; label: string; hotkey: string }[] = [
  { id: 'timeline', label: 'Timeline', hotkey: '1' },
  { id: 'stats', label: 'Stats', hotkey: '2' },
  { id: 'instructions', label: 'Prompt', hotkey: '3' },
  { id: 'context', label: 'Context', hotkey: '4' },
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

const formatUsd = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`)

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

/** The arguments a hook changed: compared key by key, as JSON. */
function diffArgs(before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
  const json = (value: unknown) => clip(JSON.stringify(value) ?? 'undefined', MAX_CHANGE)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter(key => !RESERVED.has(key)))
  const changes: Change[] = []
  for (const key of keys) {
    const had = key in before
    const has = key in after
    if (had && has && JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    changes.push({ key, before: had ? json(before[key]) : null, after: has ? json(after[key]) : null })
  }
  return changes
}

/** A JSON value as it reads: a string without its quotes. */
function unquote(json: string | null): string {
  if (json === null) return '(none)'
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : json
  } catch {
    return json
  }
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

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function resourcesOf(m: Measured, at: number): Resources {
  return {
    at,
    contextTokens: m.context.tokens ?? null,
    window: m.context.window,
    percent: m.context.percent ?? null,
    costUsd: m.cost?.usd ?? null,
    rateLimits: m.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  }
}

/** The context window by category, as /context counts it (estimated locally). */
async function refreshBreakdown($: EngineInterface): Promise<void> {
  lastBreakdownAt = Date.now()
  const usage = await $.session.usage({ breakdown: 'summary' })
  const at = await now($)
  await update($, resources, () => resourcesOf(usage, at))
  const b = usage.context.breakdown
  if (b === undefined) return

  const servers = new Map<string, { server: string; tools: number; loaded: number; tokens: number }>()
  for (const tool of b.mcpTools) {
    const row = servers.get(tool.serverName) ?? { server: tool.serverName, tools: 0, loaded: 0, tokens: 0 }
    row.tools += 1
    row.loaded += tool.isLoaded ? 1 : 0
    row.tokens += tool.tokens
    servers.set(tool.serverName, row)
  }
  const record: Breakdown = {
    at,
    model: b.model,
    totalTokens: b.totalTokens,
    maxTokens: b.maxTokens,
    percentage: b.percentage,
    isAutoCompactEnabled: b.isAutoCompactEnabled,
    autoCompactThreshold: b.autoCompactThreshold ?? null,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memoryFiles: b.memoryFiles.map(f => ({ path: f.path, type: f.type, tokens: f.tokens })),
    mcpServers: [...servers.values()].sort((x, y) => y.tokens - x.tokens),
    agents: { count: b.agents.length, tokens: b.agents.reduce((n, a) => n + a.tokens, 0) },
    skills: b.skills === undefined ? null : { total: b.skills.totalSkills, included: b.skills.includedSkills, tokens: b.skills.tokens },
    slashCommands:
      b.slashCommands === undefined
        ? null
        : { total: b.slashCommands.totalCommands, included: b.slashCommands.includedCommands, tokens: b.slashCommands.tokens },
  }
  await update($, breakdown, () => record)
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
        costUsd: null,
      }
      const kept = [...before.filter(t => t.id !== turn.id), turn].slice(-MAX_TURNS)
      const keptIds = new Set(kept.map(t => t.id))
      const dropped = new Set(before.map(t => t.id).filter(id => !keptIds.has(id)))
      await update($, turns, () => kept)
      if (dropped.size > 0) {
        await update($, steps, list => list.filter(step => !dropped.has(step.turnId)))
        await update($, injections, list =>
          list.filter(item => item.turnId === null || !dropped.has(item.turnId)),
        )
        for (const id of dropped) costAtStart.delete(id)
      }
    })
    // The session's cost now, to tell at the turn's end what it cost.
    await quietly(async () => {
      const usd = (await $.session.usage()).cost?.usd
      if (usd !== undefined) costAtStart.set(e.turnId, usd)
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await quietly(() => fillServerResults($, e.agentId ?? null))
    // A subagent's row is open by default while it works and closed once done:
    // forget a flip made while it worked, so a row closed stays closed.
    const finished = e.agentId
    if (finished !== undefined) {
      await quietly(() => update($, toggled, list => list.filter(k => !(k.startsWith('a:') && k.endsWith(`|${finished}`)))))
    }
    let costUsd: number | null = null
    await quietly(async () => {
      const start = costAtStart.get(e.turnId)
      const usd = (await $.session.usage()).cost?.usd
      if (start !== undefined && usd !== undefined) costUsd = Math.max(0, usd - start)
      costAtStart.delete(e.turnId)
    })
    await quietly(() =>
      update($, turns, list =>
        list.map(turn =>
          turn.id === e.turnId
            ? { ...turn, durationMs: e.durationMs, outcome: e.reason, usage: usageOf(e.usage), costUsd }
            : turn,
        ),
      ),
    )

    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent starting: tied to the Agent call that started it by the call's
  // tool_use_id, and to its own turns by the agentId the engine answers.
  on('agent.spawn', async ($, e, next) => {
    // Taken before the agent starts, so it comes before the agent's turns.
    const at = await now($)
    const answer = await next(e)
    await quietly(async () => {
      const refused = answer.deny !== undefined
      const record: Spawn = {
        toolUseId: e.tool_use_id,
        agentId: refused ? null : (answer.agentId ?? e.resume?.agentId ?? null),
        parentAgentId: e.parentAgentId ?? null,
        at,
        type: e.subagentType,
        description: e.description,
        prompt: clip(e.prompt, MAX_SPAWN_PROMPT),
        promptChars: e.prompt.length,
        requested: e.model ?? null,
        model: refused ? null : answer.model,
        parentModel: e.parentModel,
        permissionMode: e.permissionMode ?? null,
        background: e.background,
        fork: e.fork,
        teammate: e.isTeammate === true,
        name: e.name ?? null,
        workflow: e.workflow === undefined ? null : { runId: e.workflow.runId, agentIndex: e.workflow.agentIndex },
        resumed: e.resume !== undefined,
        denied: refused ? answer.deny : null,
      }
      await update($, agents, list => [...list, record].slice(-MAX_AGENTS))
    })

    return answer
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

  // What the settings hooks answered before a tool ran. Hooks modules sit above
  // the settings hooks in this chain, so `next(e)` is their answer: a rewrite
  // of the arguments (`updatedInput`) is recorded against the model's own.
  on('classic.PreToolUse', async ($, e, next) => {
    const answer = await next(e)
    const updated = answer.updatedInput
    if (updated !== undefined) {
      const changes = diffArgs(argsOf(e), updated)
      if (changes.length > 0) {
        const record: Rewrite = { id: e.tool_use_id, changes }
        await quietly(() =>
          update($, rewrites, list => [...list.filter(r => r.id !== record.id), record].slice(-MAX_CALLS)),
        )
      }
    }

    return answer
  }).catch(($, e, next) => next(e))

  // Everything Claude Code adds to what the model reads besides your message:
  // reminders, listings, mentioned files, settings hooks' output, plugins'
  // context. `next(e)` is the text as it goes out (null: left out).
  on('prompt.attachment', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      const agentId = e.agentId ?? null
      const turn = [...(await read($, turns))].reverse().find(t => t.agentId === agentId)
      const text = answer.text ?? e.text
      const at = await now($)
      const record: Injection = {
        id: `${at}-${injectionSeq++}`,
        turnId: turn?.id ?? null,
        agentId,
        at,
        type: e.type,
        origin: e.origin.kind,
        event: e.origin.kind === 'engine' ? null : e.origin.event,
        text: clip(text, MAX_INJECTION_TEXT),
        chars: text.length,
        dropped: answer.text === null,
      }
      await update($, injections, list =>
        // The same text carried again for the same turn is listed once.
        list.some(i => i.turnId === record.turnId && i.type === record.type && i.chars === record.chars && i.text === record.text)
          ? list
          : [...list, record].slice(-MAX_INJECTIONS),
      )
    })

    return answer
  }).catch(($, e, next) => next(e))

  // --- Resources: the context window, cost and rate limits, compactions.

  // Raised when the status line's figures change: context, rate limits, cost.
  on('session.measure', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      await update($, resources, () => resourcesOf(e, Date.now()))
      if (e.changed.includes('context') && Date.now() - lastBreakdownAt > BREAKDOWN_EVERY_MS) {
        await refreshBreakdown($)
      }
    })

    return answer
  }).catch(($, e, next) => next(e))

  // A compaction: the conversation summarized to free the context window.
  on('session.compact', async ($, e, next) => {
    const startedAt = await now($)
    const answer = await next(e)
    // `precompute` prepares a summary in the background; only real ones count.
    if (e.trigger !== 'precompute') {
      await quietly(async () => {
        const agentId = e.agentId ?? null
        const turn = [...(await read($, turns))].reverse().find(t => t.agentId === agentId)
        const record: Compaction = {
          id: `${startedAt}-${injectionSeq++}`,
          at: startedAt,
          turnId: turn?.id ?? null,
          agentId,
          trigger: e.trigger,
          instructions: e.instructions ?? null,
          tokensBefore: answer.skip === undefined ? answer.tokensBefore ?? null : null,
          tokensAfter: answer.skip === undefined ? answer.tokensAfter ?? null : null,
          durationMs: Math.round((await now($)) - startedAt),
          skipped: answer.skip ?? null,
        }
        await update($, compactions, list => [...list, record].slice(-MAX_COMPACTIONS))
        if (record.skipped === null) lastBreakdownAt = 0 // the breakdown changed: refresh it
      })
    }

    return answer
  }).catch(($, e, next) => next(e))

  // --- What the model is told: system prompt, context blocks, skills, tools.

  // The system prompt as it goes out: every section, in order.
  on('prompt.compose', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      const key = `${e.promptModel}|${[...e.traits].sort().join(',')}`
      const sections = answer.sections.map(s => ({
        id: s.id,
        scope: s.scope,
        chars: s.text.length,
        text: clip(s.text, MAX_SECTION_TEXT),
      }))
      const signature = `${e.tools.length}|${e.outputStyle?.name ?? "default"}|${sections.map(s => `${s.id}:${s.chars}`).join('|')}`
      if (composeSeen.get(key) === signature) return
      composeSeen.set(key, signature)
      const snapshot: PromptSnapshot = {
        key,
        at: await now($),
        model: e.model,
        promptModel: e.promptModel,
        outputStyle: e.outputStyle?.name ?? "default",
        traits: [...e.traits],
        toolCount: e.tools.length,
        sections,
      }
      await update($, prompts, list => [...list.filter(p => p.key !== key), snapshot].slice(-MAX_PROMPTS))
    })

    return answer
  }).catch(($, e, next) => next(e))

  // The blocks in front of the conversation's first message, and the
  // instruction files (CLAUDE.md and their imports) behind `claudeMd`.
  on('prompt.context', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      const files = answer.instructionFiles ?? e.instructionFiles ?? []
      const snapshot: ContextSnapshot = {
        at: await now($),
        blocks: answer.blocks.map(b => ({ name: b.name, chars: b.text.length, text: clip(b.text, MAX_SECTION_TEXT) })),
        files: files.map(f => ({ path: f.path, kind: f.kind, chars: f.content.length, parent: f.parent ?? null })),
      }
      const signature = JSON.stringify([
        snapshot.blocks.map(b => [b.name, b.chars]),
        snapshot.files.map(f => [f.path, f.chars]),
      ])
      if (signature === contextSeen) return
      contextSeen = signature
      await update($, contextSnapshot, () => snapshot)
    })

    return answer
  }).catch(($, e, next) => next(e))

  // A skill's instructions, as they join the conversation.
  on('skill.prompt', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      const at = await now($)
      const turn = [...(await read($, turns))].reverse().find(t => t.agentId === null)
      const record: SkillLoad = {
        id: `${at}-${injectionSeq++}`,
        skill: e.skill,
        source: e.source,
        plugin: e.pluginName ?? null,
        path: e.path ?? null,
        at,
        turnId: turn?.id ?? null,
        chars: answer.text.length,
        text: clip(answer.text, MAX_SKILL_TEXT),
      }
      await update($, skills, list => [...list, record].slice(-MAX_SKILLS))
    })

    return answer
  }).catch(($, e, next) => next(e))

  // Each tool offered to the model, and whether it waits behind ToolSearch.
  on('tool.describe', async ($, e, next) => {
    const answer = await next(e)
    await quietly(async () => {
      const record: OfferedTool = {
        tool: e.tool,
        provider: e.provider.plugin,
        deferred: answer.isDeferred ?? e.isDeferred === true,
        chars: answer.description.length,
      }
      const signature = `${record.provider}|${record.deferred}|${record.chars}`
      if (toolSeen.get(record.tool) === signature) return
      toolSeen.set(record.tool, signature)
      await update($, tools, list => [...list.filter(t => t.tool !== record.tool), record].slice(-MAX_TOOLS))
    })

    return answer
  }).catch(($, e, next) => next(e))

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
    const [turnList, stepList, callList, verdictList, toggledList, current, rewriteList, injectionList] =
      await Promise.all([
        read($, turns),
        read($, steps),
        read($, calls),
        read($, verdicts),
        read($, toggled),
        read($, view),
        read($, rewrites),
        read($, injections),
      ])
    const [promptList, contextNow, skillList, toolList, resourcesNow, breakdownNow, compactionList, spawnList] =
      await Promise.all([
        read($, prompts),
        read($, contextSnapshot),
        read($, skills),
        read($, tools),
        read($, resources),
        read($, breakdown),
        read($, compactions),
        read($, agents),
      ])

    const columns = e.props.bodyColumns
    /** The width a line indented by `indent` cells may take, on the terminal. */
    // How far in the part being drawn starts: a subagent's turns are drawn
    // under the call that started it, so every width there is narrower.
    let base = 0
    const fit = (indent: number) =>
      e.surface === 'terminal' ? { width: Math.max(8, columns - base - indent) } : {}
    // Outside the terminal the width comes in cells of the surface's code font,
    // while the pane writes in its narrower proportional UI font: about 1.8
    // times as many characters fit. 1.6 fills the line without risking a wrap.
    const PROPORTIONAL = 1.6
    const usable = e.surface === 'terminal' ? columns : Math.floor(columns * PROPORTIONAL)
    /** The characters left on a line indented by `indent` cells. */
    const room = (indent: number) => Math.max(12, usable - base - indent)
    /** One line of plain text, cut with "…" to `width` cells. */
    const cut = (text: string, width: number) => {
      const flat = text.replace(/\s+/g, ' ').trim()
      return flat.length > width ? `${flat.slice(0, Math.max(0, width - 1))}…` : flat
    }

    type Part = { text: string; color?: string; dim?: boolean; bold?: boolean } | null | false | undefined
    /**
     * One line of styled parts, cut with "…" to `width` cells by Glass Box
     * itself: a surface may wrap styled runs instead of truncating them, and a
     * long command must never take ten lines. The full text is in the details.
     */
    const seg = (width: number, parts: Part[]) => {
      let left = Math.max(8, width)
      const shown: { text: string; color?: string; dim?: boolean; bold?: boolean }[] = []
      for (const part of parts) {
        if (!part || part.text === '' || left <= 0) continue
        const text = part.text.replace(/[\r\n\t]+/g, ' ')
        if (text.length > left) {
          shown.push({ ...part, text: `${text.slice(0, Math.max(0, left - 1))}…` })
          left = 0
        } else {
          shown.push({ ...part, text })
          left -= text.length
        }
      }

      return (
        <Text wrap="truncate-end">
          {shown.map(p =>
            p.color !== undefined ? (
              <Text color={p.color} bold={p.bold}>
                {p.text}
              </Text>
            ) : (
              <Text dimColor={p.dim} bold={p.bold}>
                {p.text}
              </Text>
            ),
          )}
        </Text>
      )
    }

    const callById = new Map(callList.map(c => [c.id, c]))
    const verdictById = new Map(verdictList.map(v => [v.id, v]))
    const stepsByTurn = new Map<string, Step[]>()
    for (const step of stepList) {
      const list = stepsByTurn.get(step.turnId) ?? []
      list.push(step)
      stepsByTurn.set(step.turnId, list)
    }
    const linked = new Set(stepList.flatMap(s => s.toolIds))
    const rewriteById = new Map(rewriteList.map(r => [r.id, r]))
    const compactionsByTurn = new Map<string | null, Compaction[]>()
    for (const c of compactionList) {
      const list = compactionsByTurn.get(c.turnId) ?? []
      list.push(c)
      compactionsByTurn.set(c.turnId, list)
    }
    const injectionsByTurn = new Map<string | null, Injection[]>()
    for (const item of injectionList) {
      const list = injectionsByTurn.get(item.turnId) ?? []
      list.push(item)
      injectionsByTurn.set(item.turnId, list)
    }

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
        costUsd: null,
      })
    }
    allTurns.sort((a, b) => b.startedAt - a.startedAt)

    // Each subagent under the call that started it. A subagent's turns belong
    // to the latest of its spawns that came before them: a resumed agent keeps
    // its id, and its new turns go to the resume. Turns whose call Glass Box
    // did not record stay at the top level.
    const spawnKey = (spawn: Spawn) => `${spawn.toolUseId}|${spawn.agentId ?? `refused-${spawn.at}`}`
    const spawnsByCall = new Map<string, Spawn[]>()
    for (const spawn of spawnList) {
      const list = spawnsByCall.get(spawn.toolUseId) ?? []
      list.push(spawn)
      spawnsByCall.set(spawn.toolUseId, list)
    }
    const turnsBySpawn = new Map<string, Turn[]>()
    const nestedTurns = new Set<string>()
    for (const turn of allTurns) {
      if (turn.agentId === null) continue
      const own = spawnList.filter(sp => sp.agentId === turn.agentId && callById.has(sp.toolUseId))
      const owner = [...own].reverse().find(sp => sp.at <= turn.startedAt) ?? own[0]
      if (owner === undefined) continue
      const list = turnsBySpawn.get(spawnKey(owner)) ?? []
      list.push(turn)
      turnsBySpawn.set(spawnKey(owner), list)
      nestedTurns.add(turn.id)
    }
    const topTurns = allTurns.filter(t => !nestedTurns.has(t.id))
    // Guards against drawing an agent inside itself.
    const drawing = new Set<string>()

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
      const rewrite = rewriteById.get(call.id)
      // When the hook changed the main argument, the line shows both.
      const summaryKey = SUMMARY_KEYS.find(key => rewrite?.changes.some(c => c.key === key))
      const summaryChange = rewrite?.changes.find(c => c.key === summaryKey)
      const summary =
        summaryChange !== undefined
          ? `${tidy(unquote(summaryChange.before))} → ${tidy(unquote(summaryChange.after))}`
          : tidy(call.summary)

      return (
        <Box key={`call-${call.id}`} paddingLeft={indent} {...fit(indent)}>
          {seg(room(indent + 2), [
            { text: status.icon, color: status.color },
            { text: ` ${name}`, bold: true },
            server !== null && { text: ` ·${server}`, dim: true },
            showAgent && call.agentId !== null && { text: ' [subagent]', color: 'subtle' },
            { text: `  ${formatDuration(call.durationMs)}`, dim: true },
            outcome !== null &&
              (outcome.color === undefined
                ? { text: `  ${outcome.label}`, dim: true }
                : { text: `  ${outcome.label}`, color: outcome.color }),
            rewrite !== undefined && { text: '  rewritten', color: 'suggestion' },
            summary !== '' && { text: `  ${summary}` },
          ])}
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

      const rewrite = rewriteById.get(call.id)

      return (
        <Box key={`detail-${call.id}`} flexDirection="column" paddingLeft={indent + 2} marginBottom={1} {...fit(indent + 2)}>
          <Text color="suggestion">{`input, as the model asked · ${formatTime(call.startedAt)}`}</Text>
          <Text wrap="wrap">{tidy(call.input)}</Text>
          {rewrite !== undefined && (
            <Box flexDirection="column">
              <Text color="suggestion">rewritten before running</Text>
              <Text wrap="wrap">
                A PreToolUse hook (from your settings or from a plugin) changed the arguments. The model asked for the first value; the tool ran with the second.
              </Text>
              <Text wrap="wrap" dimColor>
                {rewrite.changes
                  .map(c => `${c.key}: ${tidy(unquote(c.before))} → ${tidy(unquote(c.after))}`)
                  .join('\n')}
              </Text>
            </Box>
          )}
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
          {seg(room(indent + 2), [
            { text: done ? '✓' : '●', color: done ? 'success' : 'warning' },
            { text: ` ${tool.name}`, bold: true },
            { text: `  ${formatDuration(tool.durationMs)}  ran by the model API`, dim: true },
            model !== null && { text: `  model ${model}` },
          ])}
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

    // A subagent, under the call that started it: one line that opens on what
    // it was given and on its own turns. `outer` is how far in, from the
    // current base, the box that holds it starts.
    const agentRows = (call: ToolCall, outer: number) =>
      (spawnsByCall.get(call.id) ?? []).map(spawn => {
        const id = spawnKey(spawn)
        if (drawing.has(id)) return null
        drawing.add(id)
        base += outer + 2
        try {
          return agentRow(spawn, id, call)
        } finally {
          base -= outer + 2
          drawing.delete(id)
        }
      })

    const agentRow = (spawn: Spawn, id: string, call: ToolCall) => {
      const key = `a:${id}`
      const agentTurns = (turnsBySpawn.get(id) ?? []).slice().sort((a, b) => a.startedAt - b.startedAt)
      const last = agentTurns[agentTurns.length - 1]
      const refused = spawn.denied !== null
      // With no turn recorded (not yet, no longer, or none ran here), the
      // call that started it tells whether it is still at work.
      const running = !refused && (last !== undefined ? last.outcome === null : call.status === 'running')
      const outcome = last?.outcome != null ? TURN_OUTCOME[last.outcome] : undefined
      const icon = refused ? '⊘' : running ? '●' : (outcome?.icon ?? '✓')
      const color = refused ? 'error' : running ? 'warning' : (outcome?.color ?? 'success')
      // Open while it works, so what a subagent does is seen as it happens.
      const open = isOpen(key, running)
      const agentSteps = agentTurns.flatMap(t => stepsByTurn.get(t.id) ?? [])
      const toolCount = agentSteps.reduce((n, s) => n + s.toolIds.length, 0)
      const costs = agentTurns.flatMap(t => (t.costUsd === null ? [] : [t.costUsd]))
      const meta = refused
        ? ['refused']
        : [
            spawn.model !== null ? shortModel(spawn.model) : null,
            plural(agentSteps.length, 'step', 'steps'),
            plural(toolCount, 'tool call', 'tool calls'),
            running ? 'running' : formatDuration(agentTurns.reduce((n, t) => n + (t.durationMs ?? 0), 0)),
            costs.length > 0 ? formatUsd(costs.reduce((n, c) => n + c, 0)) : null,
            outcome?.label ?? null,
          ]
      const tags = [
        spawn.fork ? 'fork' : null,
        spawn.background ? 'background' : null,
        spawn.teammate ? 'teammate' : null,
        spawn.workflow !== null ? `workflow agent ${spawn.workflow.agentIndex}` : null,
        spawn.resumed ? 'resumed' : null,
        spawn.name !== null ? `“${spawn.name}”` : null,
      ]
      const head = [...meta, ...tags].filter(part => part !== null).join(' · ')
      const how = [
        spawn.fork
          ? 'It is a fork: it starts from a copy of this conversation, on the same model.'
          : 'It is a separate loop with a conversation of its own, which starts from the prompt below. Only its final answer comes back, as the call’s output.',
        spawn.background ? 'It runs in the background: the call returned at once and the parent went on working.' : null,
        spawn.teammate ? 'It is a teammate: a named agent that waits between turns and wakes on a message.' : null,
        spawn.workflow !== null ? `It is agent ${spawn.workflow.agentIndex} of a workflow run (${spawn.workflow.runId}).` : null,
        spawn.resumed ? 'This run continues an agent started earlier, with the same id.' : null,
      ]
        .filter(part => part !== null)
        .join(' ')
      const model =
        spawn.model === null
          ? null
          : `model: ${spawn.model}${
              spawn.fork
                ? ' (a fork always runs on the parent’s model)'
                : spawn.requested !== null
                  ? ` (the call asked for ${spawn.requested})`
                  : ` (the call named none: the agent type’s own model, else the parent’s, ${shortModel(spawn.parentModel)})`
            }`
      const clipped = spawn.promptChars > spawn.prompt.length ? ` · clipped, ${formatTokens(spawn.promptChars)} chars in all` : ''

      return (
        <Box key={`agent-${id}`} flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain dimColor label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Box {...fit(2)}>
              {seg(room(2), [
                { text: icon, color },
                { text: ' Subagent', bold: true },
                { text: ` ${spawn.type}` },
                head !== '' && { text: ` · ${head}`, dim: true },
              ])}
            </Box>
          </Box>
          {open && (
            <Box flexDirection="column" paddingLeft={2} {...fit(0)}>
              <Text dimColor wrap="wrap">
                {`At ${formatTime(spawn.at)} this call started a subagent of type ${spawn.type}. ${how}`}
              </Text>
              {refused && (
                <Text color="error" wrap="wrap">
                  {`A plugin refused to start it: ${spawn.denied}`}
                </Text>
              )}
              {model !== null && (
                <Text dimColor wrap="wrap">
                  {model}
                </Text>
              )}
              {spawn.permissionMode !== null && (
                <Text dimColor wrap="wrap">
                  {`permission mode: ${spawn.permissionMode} (inherited from the parent)`}
                </Text>
              )}
              <Text color="suggestion">{`prompt it was given${clipped}`}</Text>
              <Text wrap="wrap">{tidy(spawn.prompt)}</Text>
              {!refused && agentTurns.length === 0 && (
                <Text dimColor wrap="wrap">
                  {running
                    ? '(no turn recorded yet)'
                    : 'No turn of it is recorded: its turns have left the history, or it ran where Glass Box cannot see (a remote agent).'}
                </Text>
              )}
            </Box>
          )}
          {open &&
            agentTurns.map((turn, i) => {
              base += 2
              try {
                return <Box key={`aturn-${turn.id}`} paddingLeft={2}>{renderTurn(turn, i === agentTurns.length - 1)}</Box>
              } finally {
                base -= 2
              }
            })}
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
              {seg(room(6), [
                { text: icon, color },
                { text: ` Step ${step.index + 1}`, bold: true },
                { text: ` · ${model}${isRunning ? '' : `${formatDuration(step.durationMs)}${out} · `}${state}`, dim: true },
              ])}
            </Box>
          </Box>
          {step.answer !== '' && (
            <Box paddingLeft={2} {...fit(4)}>
              <Text dimColor italic wrap={open ? 'wrap' : 'truncate-end'}>
                {`› ${open ? step.answer : cut(firstLine(step.answer), room(8))}`}
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
              {agentRows(call, 2)}
            </Box>
          ))}
        </Box>
      )
    }

    const renderTurn = (turn: Turn, isNewest: boolean) => {
      const key = `t:${turn.id}`
      const nested = nestedTurns.has(turn.id)
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
        turn.costUsd !== null ? formatUsd(turn.costUsd) : null,
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
              {seg(room(2), [
                { text: icon, color },
                { text: turn.agentId !== null && !nested ? ' Subagent' : ' Turn', bold: true },
                { text: ` · ${meta}`, dim: true },
              ])}
            </Box>
          </Box>
          <Box paddingLeft={2} {...fit(2)}>
            <Text color="claude" wrap={open ? 'wrap' : 'truncate-end'}>
              {open ? prompt : cut(prompt, room(2))}
            </Text>
          </Box>
          {open && turn.agentId !== null && !nested && (
            <Box paddingLeft={2} {...fit(2)}>
              <Text dimColor wrap="wrap">
                A subagent’s turn. Glass Box did not record the call that started it: it started before Glass Box loaded, or the call has left the history.
              </Text>
            </Box>
          )}
          {open && renderInjections(`i:${turn.id}`, injectionsByTurn.get(turn.id) ?? [], 2)}
          {open && (compactionsByTurn.get(turn.id) ?? []).map(c => compactionLine(c, 2))}
          {open && turnSteps.map((step, i) => renderStep(step, turnSteps[i - 1]))}
        </Box>
      )
    }

    // What Claude Code added to the model's reading for a turn: one line that
    // opens on each item, with who wrote it and its text.
    const originLabel = (item: Injection) =>
      item.origin === 'engine'
        ? 'Claude Code'
        : item.origin === 'hook'
          ? `${item.event ?? 'settings'} hook`
          : `plugin (${item.event ?? 'context'})`

    const formatChars = (n: number) => `${formatTokens(n)} chars (~${formatTokens(Math.round(n / 4))} tokens)`

    const renderInjections = (key: string, items: Injection[], indent: number) => {
      if (items.length === 0) return null
      const open = isOpen(key, false)
      const total = items.reduce((n, i) => n + i.chars, 0)
      const byOrigin = new Map<string, number>()
      for (const item of items) {
        const label = item.origin === 'engine' ? 'Claude Code' : item.origin === 'hook' ? 'hooks' : 'plugins'
        byOrigin.set(label, (byOrigin.get(label) ?? 0) + item.chars)
      }
      const split = [...byOrigin.entries()].map(([label, n]) => `${label} ${formatTokens(n)}`).join(', ')

      return (
        <Box key={`inj-${key}`} flexDirection="column" paddingLeft={indent} marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain dimColor label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Box {...fit(indent + 2)}>
              {seg(room(indent + 2), [
                { text: '+', color: 'suggestion' },
                { text: ' Added to the context', bold: true },
                { text: ` · ${plural(items.length, 'item', 'items')} · ${formatChars(total)} · ${split}`, dim: true },
              ])}
            </Box>
          </Box>
          {open && (
            <Box flexDirection="column" paddingLeft={2} {...fit(indent + 2)}>
              <Text dimColor wrap="wrap">
                Besides your message, Claude Code put this text in front of the model: its own reminders and listings, and the output of hooks and plugins.
              </Text>
              {items.map(item => (
                <Box key={`item-${item.id}`} flexDirection="column" marginTop={1}>
                  {seg(room(indent + 4), [
                    { text: originLabel(item), bold: true },
                    {
                      text: ` · ${item.type} · ${formatChars(item.chars)} · ${formatTime(item.at)}${item.dropped ? ' · left out by a plugin' : ''}`,
                      dim: true,
                    },
                  ])}
                  <Text wrap="wrap" dimColor>
                    {tidy(item.text)}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const othersOpen = isOpen('o:others', false)
    const shownTurns = new Set(allTurns.map(t => t.id))
    const looseInjections = injectionList.filter(i => i.turnId === null || !shownTurns.has(i.turnId))

    // --- Stats: the session at a glance, from what Glass Box keeps.

    const line = (key: string, label: string, value: string, labelWidth: number) => (
      <Box key={key} paddingLeft={2} {...fit(2)}>
        {seg(room(2), [
          { text: e.surface === 'terminal' ? label.padEnd(labelWidth) : label },
          { text: `  ${value}`, dim: true },
        ])}
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

      if (callList.length === 0 && stepList.length === 0 && injectionList.length === 0) {
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

          {rewriteList.length > 0 &&
            line('rewrites', `${rewriteList.length}`, 'rewritten by a PreToolUse hook before running', 4)}

          {section('Added to the context')}
          {injectionList.length === 0 && line('inj-none', 'nothing', 'recorded yet', 8)}
          {(() => {
            const groups = new Map<string, { count: number; chars: number }>()
            for (const item of injectionList) {
              const label = `${originLabel(item)} · ${item.type}`
              const group = groups.get(label) ?? { count: 0, chars: 0 }
              group.count += 1
              group.chars += item.chars
              groups.set(label, group)
            }
            return [...groups.entries()]
              .sort((a, b) => b[1].chars - a[1].chars)
              .map(([label, g]) => line(`inj-${label}`, formatTokens(g.chars), `${label} (${g.count}×)`, 6))
          })()}
          {injectionList.length > 0 &&
            line(
              'inj-total',
              formatTokens(injectionList.reduce((n, i) => n + i.chars, 0)),
              'characters in all, about a quarter as many tokens',
              6,
            )}

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
          {term('g-2', '2. Step.', 'Claude Code sends the whole conversation to the model. The model writes text and may ask for tools. One request and its answer is one step. Along with your message, Claude Code adds text of its own and of your hooks: reminders, listings, hook output. Glass Box lists it under each turn as Added to the context.')}
          {term('g-3', '3. Permission check.', 'Before each tool runs, Claude Code checks your settings, hooks and permission mode: allowed, asked, or denied. A hook may also rewrite the call’s arguments; Glass Box marks such calls rewritten and shows what changed.')}
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
          {term('g-w8', 'Subagent.', 'A helper Claude starts for a sub-task, with a conversation of its own. It is drawn under the Agent call that started it: its type, its model, the prompt it was given, and its own turns, steps and tool calls.')}
          {term('g-w9', 'MCP tool.', 'A tool from an external server, shown as tool ·server.')}
          {term('g-w13', 'System prompt.', 'The standing instructions sent before the conversation on every request: how Claude Code works, your environment, your tools. The Prompt tab shows it section by section.')}
          {term('g-w14', 'Instruction files.', 'Your CLAUDE.md files (and the files they import with @). They reach the model in front of the conversation’s first message.')}
          {term('g-w15', 'Skill.', 'A packaged set of instructions Claude loads only when a task needs it, so it costs context only then.')}
          {term('g-w16', 'ToolSearch.', 'How Claude Code keeps many tools available without sending all their descriptions: the model sees their names, and loads a tool’s full description when it needs it.')}
          {term('g-w17', 'Compaction.', 'When the context is nearly full, Claude Code replaces the conversation so far with a summary and goes on from it. Details from before the summary are no longer in front of the model.')}
          {term('g-w18', 'Rate limits.', 'Your plan’s usage windows (5 hours, 7 days). The Context tab shows how much of each is used and when it starts again.')}
          {term('g-w11', 'Added context.', 'Text the model reads besides your message: Claude Code’s reminders (a to-do list, a mode change), listings (skills, tools), files you mentioned, and what hooks and plugins add. It counts against the context like anything else.')}
          {term('g-w12', 'Rewritten call.', 'A call whose arguments a PreToolUse hook changed after the model asked for it: the tool ran with the hook’s version, not the model’s.')}
          {term('g-w10', 'Server tool.', 'A tool the model API runs itself inside a step, such as the advisor: a second model the main one consults for a review or a plan. Claude Code runs nothing for it, so there is no permission check. Glass Box shows when it ran, how long it took, the model your settings name for the advisor, and its result as the transcript keeps it.')}

          {section('What Glass Box cannot see')}
          {para('g-limits', 'The model’s private reasoning, how a server tool worked inside (only its input and result reach the transcript), and anything that happened before Glass Box loaded. It only observes: it never changes, delays or blocks what Claude Code does.', true)}
        </Box>
      )
    }

    // --- Context: the window, what fills it, cost, rate limits, compactions.

    const TRIGGER: Record<string, string> = {
      manual: 'you asked (/compact)',
      auto: 'automatic, the context was nearly full',
      plugin: 'asked by a plugin',
    }

    const compactionLine = (c: Compaction, indent: number) => {
      const sizes =
        c.tokensBefore !== null && c.tokensAfter !== null
          ? ` · ${formatTokens(c.tokensBefore)} → ${formatTokens(c.tokensAfter)} tokens`
          : ''

      return (
        <Box key={`compact-${c.id}`} paddingLeft={indent} marginTop={1} {...fit(indent)}>
          {seg(room(indent + 2), [
            { text: '⇣', color: c.skipped === null ? 'suggestion' : 'warning' },
            { text: c.skipped === null ? ' Context compacted' : ' Compaction skipped', bold: true },
            {
              text: ` · ${TRIGGER[c.trigger] ?? c.trigger}${sizes} · ${formatDuration(c.durationMs)} · ${formatTime(c.at)}${c.skipped !== null ? ` · ${c.skipped}` : ''}`,
              dim: true,
            },
          ])}
        </Box>
      )
    }

    /**
     * A meter drawn as two colored boxes of a set width in cells, not as block
     * characters: a proportional font draws those as uneven squares. Blue
     * while there is room, yellow from 70%, red from 90%.
     */
    const barRow = (key: string, label: string, percent: number, cells: number, value: string, labelWidth: number) => {
      const p = Math.min(100, Math.max(0, percent))
      const filled = Math.round((p / 100) * cells)
      const color = p >= 90 ? 'error' : p >= 70 ? 'warning' : 'suggestion'

      return (
        <Box key={key} flexDirection="row" paddingLeft={2} gap={1}>
          <Text>{e.surface === 'terminal' ? label.padEnd(labelWidth) : label}</Text>
          <Box flexDirection="row">
            {filled > 0 && (
              <Box key={`${key}-fill`} width={filled} backgroundColor={color}>
                <Text>{' '.repeat(filled)}</Text>
              </Box>
            )}
            {filled < cells && (
              <Box key={`${key}-rest`} width={cells - filled} backgroundColor="inactive">
                <Text>{' '.repeat(cells - filled)}</Text>
              </Box>
            )}
          </Box>
          <Box {...fit(labelWidth + cells + 4)}>
            {seg(room(labelWidth + cells + 4), [{ text: value, dim: true }])}
          </Box>
        </Box>
      )
    }

    const until = (iso: string) => {
      const ms = Date.parse(iso) - Date.now()
      if (!(ms > 0)) return 'now'
      const hours = Math.floor(ms / 3_600_000)
      const minutes = Math.round((ms % 3_600_000) / 60_000)
      return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
    }

    const WINDOW_LABEL: Record<string, string> = { five_hour: '5 hours', seven_day: '7 days' }

    const renderContext = () => {
      const r = resourcesNow
      const b = breakdownNow
      const pct = r?.percent ?? (r?.contextTokens != null && r.window > 0 ? Math.round((r.contextTokens / r.window) * 100) : null)
      const costed = allTurns.filter(t => t.costUsd !== null && t.agentId === null).slice(0, 8)

      return (
        <Box flexDirection="column">
          {section('Context window')}
          {para('c-intro', 'Everything the model reads at each step must fit in its context window: instructions, tools, the conversation, tool results. When it is nearly full, Claude Code compacts the conversation.', true)}
          {r === null && para('c-none', 'Not measured yet: the figures arrive with the next response from the model.', true)}
          {r !== null &&
            barRow(
              'c-fill',
              'used',
              pct ?? 0,
              20,
              `${pct !== null ? `${pct}% · ` : ''}${r.contextTokens !== null ? formatTokens(r.contextTokens) : '?'} of ${formatTokens(r.window)} tokens`,
              4,
            )}

          {section('What fills it')}
          <Box key="c-refresh" flexDirection="row" gap={1} paddingLeft={2}>
            <Button key="ctx:refresh" dimColor label="Refresh" onPress={() => void quietly(() => refreshBreakdown($))} />
            <Box {...fit(14)}>
              {seg(room(14), [
                {
                  text: b === null
                    ? 'Not counted yet: refreshed after responses, at most every 30 seconds.'
                    : `Estimated at ${formatTime(b.at)} for ${shortModel(b.model)}, as /context counts it.`,
                  dim: true,
                },
              ])}
            </Box>
          </Box>
          {b !== null &&
            b.categories
              .filter(c => c.tokens > 0)
              .map(c =>
                line(
                  `c-cat-${c.name}`,
                  c.name,
                  `${formatTokens(c.tokens)} tokens · ${b.maxTokens > 0 ? Math.round((c.tokens / b.maxTokens) * 100) : 0}%${c.kind === 'deferred' ? ' · loaded on demand, not counted' : ''}`,
                  22,
                ),
              )}
          {b !== null &&
            para(
              'c-auto',
              b.isAutoCompactEnabled
                ? `Auto-compaction is on${b.autoCompactThreshold !== null ? `: it runs at about ${formatTokens(b.autoCompactThreshold)} tokens` : ''}.`
                : 'Auto-compaction is off: the conversation is only compacted when you ask (/compact).',
              true,
            )}
          {b !== null && b.memoryFiles.length > 0 && (
            <Box key="c-mem" flexDirection="column">
              {para('c-mem-head', 'Memory and instruction files:')}
              {b.memoryFiles.map(f => line(`c-mem-${f.path}`, f.type, `${formatTokens(f.tokens)} tokens · ${tidy(f.path)}`, 10))}
            </Box>
          )}
          {b !== null && b.mcpServers.length > 0 && (
            <Box key="c-mcp" flexDirection="column">
              {para('c-mcp-head', 'MCP servers (their tools’ schemas):')}
              {b.mcpServers.map(s =>
                line(`c-mcp-${s.server}`, s.server, `${formatTokens(s.tokens)} tokens · ${plural(s.tools, 'tool', 'tools')}, ${s.loaded} loaded`, 22),
              )}
            </Box>
          )}
          {b !== null && (
            <Box key="c-lists" flexDirection="column">
              {b.skills !== null &&
                line('c-skills', 'skills listing', `${formatTokens(b.skills.tokens)} tokens · ${b.skills.included} of ${b.skills.total} skills listed`, 22)}
              {b.slashCommands !== null &&
                line('c-cmds', 'commands listing', `${formatTokens(b.slashCommands.tokens)} tokens · ${b.slashCommands.included} of ${b.slashCommands.total} commands listed`, 22)}
              {b.agents.count > 0 && line('c-agents', 'agent types', `${formatTokens(b.agents.tokens)} tokens · ${plural(b.agents.count, 'type', 'types')}`, 22)}
            </Box>
          )}

          {section('Cost')}
          {para('c-cost-intro', 'What this session has cost so far, as /cost totals it, and what each recent turn added to it (subagents included).', true)}
          {(r === null || r.costUsd === null) && para('c-cost-none', 'No cost recorded yet, or this host keeps no cost ledger.', true)}
          {r !== null && r.costUsd !== null && line('c-cost', 'this session', formatUsd(r.costUsd), 14)}
          {costed.map(t =>
            line(`c-cost-${t.id}`, formatTime(t.startedAt).slice(0, 5), `${formatUsd(t.costUsd ?? 0)} · ${t.prompt === '' ? '(continuation)' : `“${t.prompt}”`}`, 14),
          )}

          {section('Rate limits')}
          {para('c-rl-intro', 'Your plan’s usage windows, as the last response reported them: how much is used and when each starts again.', true)}
          {(r === null || r.rateLimits.length === 0) && para('c-rl-none', 'None reported yet.', true)}
          {r !== null &&
            r.rateLimits.map(l =>
              barRow(
                `c-rl-${l.kind}`,
                WINDOW_LABEL[l.kind] ?? l.kind,
                l.percentUsed,
                10,
                `${l.percentUsed}%${l.resetsAt !== null ? ` · resets in ${until(l.resetsAt)} (${formatTime(Date.parse(l.resetsAt)).slice(0, 5)})` : ''}`,
                7,
              ),
            )}

          {section('Compactions')}
          {para('c-compact-intro', 'When the context is nearly full, Claude Code replaces the conversation so far with a summary and goes on from it. You can ask for one with /compact. Each also shows in the Timeline, under its turn.', true)}
          {compactionList.length === 0 && para('c-compact-none', 'None in this session yet.', true)}
          {[...compactionList].reverse().map(c => compactionLine(c, 0))}
        </Box>
      )
    }

    // --- Instructions: what the model is told before it reads the conversation.

    const basename = (path: string) => path.split('/').pop() ?? path

    /** A row with its own toggle; `body` shows under it while open. */
    const toggleRow = (key: string, indent: number, head: Part[], body: () => JSX.Element | null, byDefault = false) => {
      const open = isOpen(key, byDefault)

      return (
        <Box key={`row-${key}`} flexDirection="column" paddingLeft={indent}>
          <Box flexDirection="row" gap={1}>
            <Button key={key} plain dimColor label={open ? '▾' : '▸'} onPress={toggle(key)} />
            <Box {...fit(indent + 2)}>{seg(room(indent + 4), head)}</Box>
          </Box>
          {open && body()}
        </Box>
      )
    }

    const textBlock = (key: string, text: string, indent: number) => (
      <Box key={key} paddingLeft={2} marginBottom={1} {...fit(indent + 2)}>
        <Text wrap="wrap" dimColor>
          {tidy(text)}
        </Text>
      </Box>
    )

    const renderInstructions = () => {
      const latestFirst = [...promptList].sort((a, b) => b.at - a.at)
      const loaded = toolList.filter(t => !t.deferred)
      const deferred = toolList.filter(t => t.deferred)
      const byProvider = new Map<string, OfferedTool[]>()
      for (const tool of toolList) {
        const provider = toolName(tool.tool).server ?? tool.provider
        const list = byProvider.get(provider) ?? []
        list.push(tool)
        byProvider.set(provider, list)
      }

      return (
        <Box flexDirection="column">
          {section('System prompt')}
          {para('n-sp', 'The standing instructions Claude Code sends with every request, before the conversation. Shared sections read the same for everyone and are cached across users; session sections are built for you: your environment, your settings, your tools.', true)}
          {latestFirst.length === 0 && para('n-sp-none', 'Not recorded yet: it is composed when Claude Code next calls the model.', true)}
          {latestFirst.map((snap, i) => {
            const total = snap.sections.reduce((n, s) => n + s.chars, 0)
            const shared = snap.sections.filter(s => s.scope === 'shared').reduce((n, s) => n + s.chars, 0)
            const extras = [
              `${snap.toolCount} tools offered`,
              snap.outputStyle !== 'default' ? `output style ${snap.outputStyle}` : null,
              snap.traits.length > 0 ? snap.traits.join(', ') : null,
              `updated ${formatTime(snap.at)}`,
            ].filter(part => part !== null)

            return toggleRow(
              `n:p:${snap.key}`,
              0,
              [
                { text: shortModel(snap.promptModel), bold: true },
                {
                  text: ` · ${plural(snap.sections.length, 'section', 'sections')} · ${formatChars(total)} · ${formatTokens(shared)} shared, ${formatTokens(total - shared)} yours · ${extras.join(' · ')}`,
                  dim: true,
                },
              ],
              () => (
                <Box flexDirection="column">
                  {snap.sections.map(sec =>
                    toggleRow(
                      `n:s:${snap.key}:${sec.id}`,
                      2,
                      [
                        { text: sec.id },
                        { text: ` · ${sec.scope === 'shared' ? 'shared' : 'yours'} · ${formatTokens(sec.chars)} chars`, dim: true },
                      ],
                      () => textBlock(`n:st:${snap.key}:${sec.id}`, sec.text, 4),
                    ),
                  )}
                </Box>
              ),
              i === 0,
            )
          })}

          {section('In front of the first message')}
          {para('n-cb', 'Context blocks Claude Code puts in front of the conversation’s first message: your instruction files (CLAUDE.md and what they import), today’s date, and similar facts.', true)}
          {contextNow === null && para('n-cb-none', 'Not recorded yet: these are sent with the first message of a conversation.', true)}
          {contextNow !== null &&
            contextNow.blocks.map(block =>
              toggleRow(
                `n:b:${block.name}`,
                0,
                [{ text: block.name }, { text: ` · ${formatChars(block.chars)}`, dim: true }],
                () => textBlock(`n:bt:${block.name}`, block.text, 2),
              ),
            )}
          {contextNow !== null && contextNow.files.length > 0 && (
            <Box key="n-files" flexDirection="column" marginTop={1}>
              {para('n-files-head', `Instruction files behind claudeMd (${contextNow.files.length}):`)}
              {contextNow.files.map(file =>
                line(
                  `n-file-${file.path}`,
                  file.kind,
                  `${formatTokens(file.chars)} chars · ${tidy(file.path)}${file.parent !== null ? ` · imported by ${basename(file.parent)}` : ''}`,
                  8,
                ),
              )}
            </Box>
          )}

          {section('Tools offered')}
          {para('n-tools', 'Every tool the model can call. A loaded tool sends its full description with every request; a tool behind ToolSearch costs only its name until the model asks for it.', true)}
          {toolList.length === 0 && para('n-tools-none', 'Not recorded yet: tools are listed when Claude Code next calls the model.', true)}
          {toolList.length > 0 &&
            toggleRow(
              'n:tools',
              0,
              [
                { text: plural(toolList.length, 'tool', 'tools') },
                {
                  text: ` · ${loaded.length} loaded (${formatChars(loaded.reduce((n, t) => n + t.chars, 0))}) · ${deferred.length} behind ToolSearch`,
                  dim: true,
                },
              ],
              () => (
                <Box flexDirection="column" paddingLeft={2}>
                  {[...byProvider.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([provider, list]) => {
                      const shown = list.filter(t => !t.deferred).map(t => `${toolName(t.tool).name} ${formatTokens(t.chars)}`)
                      const hidden = list.filter(t => t.deferred).map(t => toolName(t.tool).name)
                      return (
                        <Box key={`n-prov-${provider}`} flexDirection="column" marginTop={1} {...fit(4)}>
                          {seg(room(6), [
                            { text: provider === 'engine' ? 'Claude Code' : provider, bold: true },
                            { text: ` · ${plural(list.length, 'tool', 'tools')}`, dim: true },
                          ])}
                          {shown.length > 0 && <Text wrap="wrap">{`loaded: ${shown.join(', ')}`}</Text>}
                          {hidden.length > 0 && (
                            <Text wrap="wrap" dimColor>
                              {`behind ToolSearch: ${hidden.join(', ')}`}
                            </Text>
                          )}
                        </Box>
                      )
                    })}
                </Box>
              ),
            )}

          {section('Skills loaded')}
          {para('n-skills', 'A skill is a packaged set of instructions Claude loads when a task needs it; its text then joins the conversation.', true)}
          {skillList.length === 0 && para('n-skills-none', 'None loaded in this session yet.', true)}
          {[...skillList].reverse().map(load =>
            toggleRow(
              `n:k:${load.id}`,
              0,
              [
                { text: load.skill, bold: true },
                {
                  text: ` · ${load.source}${load.plugin !== null ? ` (${load.plugin})` : ''} · ${formatChars(load.chars)} · ${formatTime(load.at)}`,
                  dim: true,
                },
              ],
              () => (
                <Box flexDirection="column">
                  {load.path !== null && para(`n-kp-${load.id}`, tidy(load.path), true)}
                  {textBlock(`n-kt-${load.id}`, load.text, 2)}
                </Box>
              ),
            ),
          )}
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

    // The session's counts, with Guide and Clear beside them rather than
    // among the tabs.
    const counters = (
      <Box flexDirection="row" gap={2}>
        <Box {...fit(19)}>
          <Text dimColor wrap="truncate-end">
            {[
              plural(allTurns.length, 'turn', 'turns'),
              plural(stepList.length, 'step', 'steps'),
              plural(callList.length, 'tool call', 'tool calls'),
              `${failed} failed`,
            ].join(' · ')}
          </Text>
        </Box>
        <Button
          key="v:guide"
          plain
          dimColor={current !== 'guide'}
          hotkey="g"
          label="Guide"
          onPress={() => void quietly(() => update($, view, () => (current === 'guide' ? 'timeline' : 'guide')))}
        />
        <Button
          key="clear"
          plain
          dimColor
          hotkey="c"
          label="Clear"
          onPress={() =>
            void quietly(async () => {
              await update($, turns, () => [])
              await update($, steps, () => [])
              await update($, calls, () => [])
              await update($, verdicts, () => [])
              await update($, rewrites, () => [])
              await update($, injections, () => [])
              await update($, skills, () => [])
              await update($, compactions, () => [])
              await update($, agents, () => [])
              await update($, toggled, () => [])
            })
          }
        />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabBar}
        {counters}
        {current === 'stats'
          ? renderStats()
          : current === 'instructions'
            ? renderInstructions()
            : current === 'context'
              ? renderContext()
            : current === 'guide'
              ? renderGuide()
              : renderTimeline()}
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
            <Text dimColor wrap="wrap">New to this? Open the Guide (press g while the pane has the keyboard).</Text>
          </Box>
        )}
        {topTurns.map((turn, i) => renderTurn(turn, i === 0))}
        {orphans.length > 0 && (
          <Box key="orphans" flexDirection="column" marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Button key="o:others" plain dimColor label={othersOpen ? '▾' : '▸'} onPress={toggle('o:others')} />
              <Box {...fit(2)}>
                {seg(room(2), [
                  { text: 'Other tool calls', bold: true },
                  { text: ' · not tied to a recorded step', dim: true },
                ])}
              </Box>
            </Box>
            {orphans.map(call => (
              <Box key={`row-${call.id}`} flexDirection="column">
                {callLine(call, 2, true)}
                {othersOpen && callDetail(call, 2)}
                {agentRows(call, 0)}
              </Box>
            ))}
          </Box>
        )}
        {looseInjections.length > 0 && (
          <Box key="loose-injections" flexDirection="column" marginTop={1}>
            <Text bold>Outside a recorded turn</Text>
            {renderInjections('i:none', looseInjections, 0)}
          </Box>
        )}
        </Box>
      )
    }
  })
}
