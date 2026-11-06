/** The pane's tabs. */
export type View = 'timeline' | 'stats' | 'guide'

/** The state of a timeline item: a turn, a step or a tool call. */
export type CallStatus = 'running' | 'ok' | 'error' | 'denied'

/** The tokens of one model response, as the API reported them. */
export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** A turn: one prompt (yours, or a subagent's) and everything that follows it. */
export type Turn = {
  id: string
  /** The subagent running the turn; null on the main loop. */
  agentId: string | null
  /** The text that started the turn, clipped; "" for a continuation. */
  prompt: string
  startedAt: number
  durationMs: number | null
  /** How it ended: answer, aborted, error, refusal; null while it runs. */
  outcome: string | null
  usage: Usage | null
}

/** A step: one request to the model inside a turn. */
export type Step = {
  /** `${turnId}:${index}` */
  key: string
  turnId: string
  index: number
  agentId: string | null
  model: string
  effort: string | null
  /** How many messages the request carried (the conversation so far). */
  messageCount: number
  startedAt: number
  durationMs: number | null
  /** The visible text the model wrote in this step, clipped. */
  answer: string
  /** The tool_use_ids of the tool calls this step asked for, in order. */
  toolIds: string[]
  /** Tools the API ran itself inside the request (the advisor, for one). */
  serverTools: ServerTool[]
  stopReason: string | null
  usage: Usage | null
}

/**
 * A tool the model API ran itself, inside a step (the advisor, for one).
 * Claude Code runs nothing for it: no permission check, no tool call.
 */
export type ServerTool = {
  /** The server tool call's id, as its result block names it. */
  id: string
  name: string
  /** Its arguments as JSON, clipped. */
  input: string
  startedAt: number
  durationMs: number | null
  /** Its result as the transcript keeps it, clipped; null until read. */
  output: string | null
  /** A model named in its result block, when the API sends one. */
  model: string | null
}

/** A tool call the engine ran. */
export type ToolCall = {
  id: string
  tool: string
  /** The main argument on one line (command, file, pattern, url...). */
  summary: string
  /** The full arguments as JSON, clipped. */
  input: string
  /** The result as the model read it, or the deny reason, clipped. */
  output: string
  status: CallStatus
  agentId: string | null
  startedAt: number
  durationMs: number | null
}

/** The permission verdict on a tool call: who allowed or denied it, and why. */
export type Verdict = {
  /** The call's tool_use_id. */
  id: string
  decision: 'allow' | 'ask' | 'deny'
  reason: string | null
  /** The settings rule that decided, as written. */
  rule: string | null
  /** The classic hook event that decided (PreToolUse...). */
  hook: string | null
  /** The settings option whose own check asked. */
  setting: string | null
  /** The plugin whose hook asked. */
  plugin: string | null
  /** Who answers an ask: 'person', 'host', or nobody. */
  approver: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'glass-box': {
      turns: Shaped<Turn[]>
      steps: Shaped<Step[]>
      calls: Shaped<ToolCall[]>
      verdicts: Shaped<Verdict[]>
      /** Keys of the items the person opened or closed, against their default. */
      toggled: Shaped<string[]>
      /** The tab the pane shows. */
      view: Shaped<View>
    }
  }
}
