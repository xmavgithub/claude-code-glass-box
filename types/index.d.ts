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

/**
 * A subagent started: the Agent call it belongs to, what it was asked to do
 * and the model it runs on, as `agent.spawn` reported it.
 */
export type Spawn = {
  /** The tool call that started it: the model's Agent call (or a Workflow call). */
  toolUseId: string
  /** The started agent's id, which its turns carry; null when it was refused. */
  agentId: string | null
  /** The loop it was started from; null for the main loop. */
  parentAgentId: string | null
  at: number
  /** The agent type: general-purpose, Explore, a plugin's agent, fork. */
  type: string
  /** The call's short description of the task. */
  description: string
  /** The task it was given, clipped. */
  prompt: string
  promptChars: number
  /** The model asked for by the call (an alias or an id); null when none. */
  requested: string | null
  /** The model it runs on, as resolved; null when it was refused. */
  model: string | null
  /** The model of the loop that started it, what "inherit" means. */
  parentModel: string
  /** The permission mode it inherits. */
  permissionMode: string | null
  background: boolean
  fork: boolean
  teammate: boolean
  /** The name SendMessage addresses it by, when it has one. */
  name: string | null
  /** For a workflow's agent: its run and its place in the run. */
  workflow: { runId: string; agentIndex: number } | null
  /** True when this run continues an agent started earlier. */
  resumed: boolean
  /** Why a plugin refused it; null when it started. */
  denied: string | null
}

/**
 * A message that entered the session (or was stopped before it did): where it
 * came from, as Claude Code stamps it, and the turn it started.
 */
export type Submission = {
  id: string
  at: number
  /** The engine's origin: composer (your Enter), task-notification, peer, plugin… */
  kind: string
  /** The channel server or the plugin, for those origins. */
  name: string | null
  /** The text as it reached Glass Box, clipped. */
  typed: string
  /** The text that entered, when a hook beneath changed it; clipped. */
  sent: string | null
  /** The turn that was running when it arrived, if any. */
  during: string | null
  /** The turn it started; null while queued, or when it went into a running turn. */
  startedTurn: string | null
  /** Why it did not enter; null when it did. */
  dropped: string | null
}

/**
 * A message between agents or sessions: one an agent sent (SendMessage, or a
 * plugin's `$.session.send`), or one that reached this session.
 */
export type Letter = {
  id: string
  at: number
  direction: 'out' | 'in'
  /** The loop that sent it (out) or that it is for (in); null for the main one. */
  agentId: string | null
  turnId: string | null
  /** Out: whom it went to. In: who sent it, in words. */
  peer: string
  /** Who acted: `model` or `plugin` (out); the delivery's origin kind (in). */
  kind: string
  text: string
  chars: number
  /** Out: whether it reached the recipient's queue; null for one coming in. */
  delivered: boolean | null
  /** Out: why it was not delivered. In: why a plugin took it before it was queued. */
  problem: string | null
  /** In: a plugin changed the text before it was queued. */
  rewritten: boolean
}

/** A slash command that ran, or a `/config` row that changed. */
export type Action = {
  id: string
  at: number
  type: 'command' | 'config'
  /** The command without its slash, or the setting's key. */
  name: string
  /** The command's arguments, or the setting's new value, as text. */
  value: string
  /** The setting's value before; null for a command. */
  previous: string | null
  /** Who did it: the origin's kind (composer: you; plugin…). */
  by: string
  /** The plugin, when one did it. */
  plugin: string | null
  /** What the command printed, clipped. */
  output: string
  /** What the command left for the model to read, never shown to you; clipped. */
  notes: string
  /** Why a setting change was refused; null when it went through. */
  denied: string | null
}

/** An agent type offered to the model, as `agent.offer` raised it. */
export type OfferedAgent = {
  agent: string
  /** When to use it, as its definition states; clipped. */
  description: string
  /** Where its definition came from: built-in, plugin, a settings source. */
  source: string
  /** Who provides it: `engine` for a built-in, else the plugin. */
  provider: string
  /** False when a plugin kept it from the model. */
  offered: boolean
}

/** A hooks module (a mod) joining the chain, as the engine scanned it. */
export type ModInfo = {
  name: string
  /** Where its hooks stand among the chain's tiers: managed, user, project… */
  tier: string
  /** Where it came from: `<name>@<marketplace>`, `<name>@inline`… */
  provenance: string
  version: string | null
  /** Its directory, as given. */
  root: string
  /** The events its `on(...)` names, in order. */
  events: string[]
  /** What it calls on `$`, as `noun.method`. */
  calls: string[]
  envReads: string[]
  envWrites: string[]
  at: number
  /** Why a plugin refused it; null when it joined. */
  refused: string | null
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

/**
 * Who started a main-loop turn you did not type, told by the frame Claude Code
 * puts around its text: a subagent's final report, another agent's message,
 * or the end of a background task.
 */
export type TurnFrom = {
  kind: 'report' | 'message' | 'task'
  /** The agent (or task) the frame names. */
  agentId: string | null
  /** A task notification's one-line summary. */
  summary: string | null
}

/** A turn: one prompt (yours, or a subagent's) and everything that follows it. */
export type Turn = {
  id: string
  /** The subagent running the turn; null on the main loop. */
  agentId: string | null
  /** The text that started the turn, clipped; "" for a continuation. For a
   * turn you did not type, the text inside its frame. */
  prompt: string
  /** Set when the turn was started by something other than you. */
  from: TurnFrom | null
  /** That turn's whole text, frame included, as the model read it; clipped. */
  frame: string | null
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
  /** True when the step streamed any thinking, even with no text. */
  thought: boolean
  /** The thinking as it streamed, clipped; "" when none came. */
  thinking: string
  /** How many characters of thinking streamed in all. */
  thinkingChars: number
  /**
   * What the transcript keeps of the step's thinking, read once the step is
   * over: `text`; `omitted`, signed blocks with no text; `redacted`; `none`;
   * null while unread, or when the step could not be told in the transcript.
   */
  thinkingSeen: 'text' | 'omitted' | 'redacted' | 'none' | null
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
      agents: Shaped<Spawn[]>
      messages: Shaped<Submission[]>
      mods: Shaped<ModInfo[]>
      mail: Shaped<Letter[]>
      agentTypes: Shaped<OfferedAgent[]>
      actions: Shaped<Action[]>
      /** Keys of the items the person opened or closed, against their default. */
      toggled: Shaped<string[]>
      /** The tab the pane shows. */
      view: Shaped<View>
    }
  }
}
