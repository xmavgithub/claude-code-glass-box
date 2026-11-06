# Roadmap

## Vision

**Make every part of Claude Code's agent loop visible, and understandable to
anyone.**

A newcomer should be able to open Glass Box and learn how an AI coding agent
works by watching one. An expert should be able to answer any question about a
session: what the model was told, what it asked for, what actually ran, who
allowed it, and what it cost.

## Principles

Every item below is held to these.

1. **Observe, never change.** Glass Box passes every event on untouched. A bug
   in Glass Box costs a missing row, never a failed tool call.
2. **Plain words first, details one click away.** Each line reads as a
   sentence a newcomer understands; the raw data is under it, for experts.
3. **Real data only.** Everything shown comes from the engine. When something
   is inferred (the advisor's model taken from your settings, say), the pane
   says so.
4. **Say what cannot be seen.** Where Claude Code does not expose something,
   Glass Box states the limit instead of leaving a gap.
5. **Light and bounded.** It keeps a capped history, clips long texts and
   never slows the session down noticeably.
6. **Every surface.** Terminal, VS Code, the desktop app and mobile, each
   tested.

## Where we are

In development towards 1.0, on `main` (no releases before 1.0). Done so far:
the loop itself and what changes it (turns, steps, server tools such as the
advisor, tool calls and their permission verdicts, calls a hook rewrote,
everything added to the model's context), and what the model is told (the
system prompt, the first message's context blocks and CLAUDE.md files, the
tools offered, the skills loaded), and the resources (the context window and
what fills it, cost per session and per turn, rate limits, compactions), and
who did the work (each subagent under the call that started it), and the
model's thinking at each step. Four
tabs (Timeline, Stats, Prompt, Context) and a Guide.

## Next

Each milestone answers one question about the session. Items name the Claude
Code events they build on.

### What actually ran, and what was added

> "Is what ran what the model asked for? What else did the model read?"

- [x] **Rewritten calls.** Show when a PreToolUse hook changed a call's
  arguments, with both versions, from the hooks' own answer
  (`classic.PreToolUse`).
- [x] **Injected context.** Show what reaches the model besides your message:
  Claude Code's reminders and listings, mentioned files, settings hooks'
  output and plugins' context, with source, size and text
  (`prompt.attachment`).
- [ ] **Rewrites by other mods.** A mod hooked above Glass Box on `tool.call`
  can change arguments before Glass Box sees them: compare with the step's
  `toolUses` to catch those too.

### What the model is told

> "Which instructions and tools did the model have?"

- [x] **Active instructions.** The sections of the system prompt (CLAUDE.md
  files, memory, the skills listing, output style…) with their size, from
  `prompt.compose`.
- [x] **Skills.** Each skill loaded in the session, when and why, from
  `skill.prompt`.
- [x] **Tools on offer.** Which tools the model sees in full and which wait
  behind ToolSearch, from `tool.describe`.

### Resources

> "How full is the context, and what does the session cost?"

- [x] **Context tab.** Context window usage, session cost and rate-limit
  windows, live, from `session.measure`.
- [x] **Compactions.** Each compaction as a timeline row: what triggered it,
  how much context it freed (`session.compact`).

### Agents

> "Who did the work?"

- [x] **Subagents tied to their call.** Link each `Agent` call to the subagent
  turn it started, with its type, model and prompt (`agent.spawn`).
- [x] **Agent tree.** Nested agents shown as a tree, each with its own steps
  and tool calls.

### Reasoning (experimental)

> "Why did the model do that?"

- [x] **Thinking excerpts.** Where the model streams its thinking, an excerpt
  per step. What arrives depends on the model and may be summarized or empty;
  the pane will say which.

### Everything the loop exposes

> "Is any part of the loop still out of sight?"

An inventory of the events Claude Code exposes (47 engine events, 67
operations on `$`) against what Glass Box records. In order of value:

- [x] **Where each message came from.** Your Enter, a background task's
  notification, another session, a scheduled task, a plugin, a channel such
  as Slack, the phone: the engine's own `origin`, in place of reading the
  frame around the text. And when a hook changed your message before the
  model read it (`prompt.submit`).
- [x] **Plugins in the loop.** Which plugins and mods are loaded, from where,
  and what each one hooks and calls: who can change what happens
  (`plugin.register`).
- [ ] **Messages between agents.** What an agent sends to another
  (SendMessage) and what arrives from outside (`session.send`,
  `session.receive`).
- [ ] **Agents on offer.** The agent types the model is offered, beside the
  tools in the Prompt tab (`agent.offer`).
- [ ] **Commands and settings.** The slash commands you run and the
  `/config` rows that change, as Timeline rows (`command.run`, `config.set`).
- [ ] **Telemetry.** What Claude Code logs and where it sends it, kept in the
  pane only (`telemetry.log`, `telemetry.mark`).
- [ ] **What other plugins do.** Their model calls, MCP calls, network
  requests and processes, through `$` (`model.complete`, `mcp.call`,
  `http.fetch`, `process.run`).
- [ ] **Out of reach, said.** The README lists what Glass Box leaves out and
  why: drawing (`ui.*`), the prompt box (`prompt.fill`, `prompt.suggest`,
  `prompt.edit`, `prompt.change`, `prompt.autocomplete`), command and setting
  descriptions, the engine's lifecycle (`engine.create`, `session.end`,
  surfaces attaching), the clock, stores, state and environment;
  `prompt.section` and `prompt.mention`, covered by `prompt.compose` and
  `prompt.attachment`; `attribution.text`.

## Later

- [x] A Clear button.
- [ ] Filters and search: errors only, one tool, one turn, free text.
- [ ] Export a session's trace as Markdown or JSON, to share or attach to a
  bug report.
- [ ] Translations, Italian first, once the wording is stable.
- [ ] Screenshots and a short video in the README.
- [ ] Submission to the Claude Code plugin directory.

## 1.0

Glass Box reaches 1.0 when:

- every event of the agent loop that Claude Code exposes is shown or
  explicitly listed as out of reach;
- it has been used live on the terminal, VS Code and the desktop app, with no
  known layout problem;
- the Guide and the README explain everything the pane shows.

## Contributing to the roadmap

Ideas are welcome: open a feature request describing the question about Claude
Code you could not answer. Pick an unchecked item and say so in its issue
before starting, so work is not duplicated.
