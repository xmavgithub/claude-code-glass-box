/** The pane's tabs. */
export type View = 'timeline' | 'stats' | 'instructions' | 'context' | 'guide'

/** A rate-limit window, as the last response reported it. */
export type RateLimit = {
  /** five_hour, seven_day, or a gateway's own name. */
  kind: string
  percentUsed: number
  /** ISO 8601, when it resets. */
  resetsAt: string | null
}

/** The session's resources, as last measured. */
export type Resources = {
  at: number
  /** Input tokens the last response was answered over. */
  contextTokens: number | null
  /** The model's context window, in tokens. */
  window: number
  percent: number | null
  /** The session's cost so far, in US dollars, where the host keeps a ledger. */
  costUsd: number | null
  rateLimits: RateLimit[]
}

/** The context window by category, as /context breaks it down. */
export type Breakdown = {
  at: number
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  isAutoCompactEnabled: boolean
  autoCompactThreshold: number | null
  /** used, free, buffer or deferred, with /context's own labels. */
  categories: { name: string; tokens: number; kind: string }[]
  memoryFiles: { path: string; type: string; tokens: number }[]
  /** MCP tool schemas, summed by server. */
  mcpServers: { server: string; tools: number; loaded: number; tokens: number }[]
  agents: { count: number; tokens: number }
  skills: { total: number; included: number; tokens: number } | null
  slashCommands: { total: number; included: number; tokens: number } | null
}

/** A compaction of the conversation, or one that was skipped. */
export type Compaction = {
  id: string
  at: number
  turnId: string | null
  agentId: string | null
  /** manual, auto, plugin or precompute. */
  trigger: string
  instructions: string | null
  tokensBefore: number | null
  tokensAfter: number | null
  durationMs: number
  /** Why it was skipped; null when it ran. */
  skipped: string | null
}

/** One section of the system prompt, as it was sent. */
export type PromptPart = {
  id: string
  /** `shared`: the same for everyone, cached across users; `session`: yours. */
  scope: string
  chars: number
  /** Its text, clipped. */
  text: string
}

/** The system prompt as last composed for one model and kind of loop. */
export type PromptSnapshot = {
  /** promptModel and traits: one snapshot per kind of prompt. */
  key: string
  at: number
  model: string
  promptModel: string
  outputStyle: string
  traits: string[]
  toolCount: number
  sections: PromptPart[]
}

/** A block put in front of the conversation's first message (claudeMd, the date…). */
export type ContextBlock = { name: string; chars: number; text: string }

/** An instruction file behind the claudeMd block. */
export type InstructionFileInfo = {
  path: string
  /** managed, user, project, local or memory. */
  kind: string
  chars: number
  /** The file whose `@` import brought this one in. */
  parent: string | null
}

/** The context blocks and instruction files, as last sent. */
export type ContextSnapshot = {
  at: number
  blocks: ContextBlock[]
  files: InstructionFileInfo[]
}

/** A skill whose instructions were loaded into the conversation. */
export type SkillLoad = {
  id: string
  skill: string
  /** Whose words: userSettings, projectSettings, plugin, built-in, mcp… */
  source: string
  plugin: string | null
  path: string | null
  at: number
  turnId: string | null
  chars: number
  /** Its text, clipped. */
  text: string
}

/** A tool offered to the model. */
export type OfferedTool = {
  tool: string
  /** The plugin that provides it, `engine` for Claude Code's own. */
  provider: string
  /** True when the model sees only its name, behind ToolSearch. */
  deferred: boolean
  /** The length of its description, the part that costs context. */
  chars: number
}

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
  /** What the session's cost grew by during the turn, in US dollars. */
  costUsd: number | null
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

/** One argument a hook changed before the tool ran. */
export type Change = {
  key: string
  /** As the model asked for it, as JSON, clipped; null when the hook added the key. */
  before: string | null
  /** As the tool ran with it, as JSON, clipped; null when the hook removed the key. */
  after: string | null
}

/** A tool call whose arguments a PreToolUse hook rewrote before it ran. */
export type Rewrite = {
  /** The call's tool_use_id. */
  id: string
  changes: Change[]
}

/** Text Claude Code added to what the model reads, besides your message. */
export type Injection = {
  /** Unique within the session. */
  id: string
  /** The turn whose request carried it; null when no turn was recorded yet. */
  turnId: string | null
  agentId: string | null
  at: number
  /** The engine's name for it: todo_reminder, skill_listing, hook_additional_context… */
  type: string
  /** Who wrote it: Claude Code itself, a settings hook, or a plugin. */
  origin: 'engine' | 'hook' | 'plugin'
  /** For a hook or a plugin: the event that produced it (SessionStart…). */
  event: string | null
  /** What the model reads, clipped. */
  text: string
  /** Its full length in characters, before clipping. */
  chars: number
  /** True when a plugin's hook left it out of the request. */
  dropped: boolean
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
      rewrites: Shaped<Rewrite[]>
      injections: Shaped<Injection[]>
      prompts: Shaped<PromptSnapshot[]>
      context: Shaped<ContextSnapshot | null>
      skills: Shaped<SkillLoad[]>
      tools: Shaped<OfferedTool[]>
      resources: Shaped<Resources | null>
      breakdown: Shaped<Breakdown | null>
      compactions: Shaped<Compaction[]>
      /** Keys of the items the person opened or closed, against their default. */
      toggled: Shaped<string[]>
      /** The tab the pane shows. */
      view: Shaped<View>
    }
  }
}
