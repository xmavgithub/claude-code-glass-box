# Changelog

All notable changes to Glass Box are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Glass Box is in development towards 1.0: there are no releases yet, and
everything below is on `main`. 1.0 will be released when the criteria in
[ROADMAP.md](ROADMAP.md#10) are met.

## [Unreleased]

### Added

#### The pane and its tabs

- A live pane beside the chat, opened at session start on a wide terminal and
  with `/glass-box` anywhere. Four tabs (hotkeys `1` to `4` while the pane has
  the keyboard), the selected one drawn as the main button and the others
  plain; **Guide** (`g`) and **Clear** (`c`) are small buttons beside the
  session's counts, so the tab bar stays short.
- **Timeline**: every turn (your message, or a subagent's prompt), every step
  (one request to the model), every server tool and every tool call, as they
  happen. The newest turn is open; turns and steps open and close on a click.
- **Stats**: calls, failures and time per tool; what the permission checks
  came to and which settings rules allowed the most calls; what was added to
  the context, by source; time in the model against time in tools, output
  tokens, peak context and cache share, stop reasons, models; the records
  sent to the telemetry collector your operator configured, by event and
  latest first (`telemetry.log` on `collector`), and the note that
  Anthropic's own analytics are open to the CLI's built-in plugins only.
- **Prompt**: what the model is told before it reads the conversation. The
  system prompt section by section, shared or yours, with size and text
  (`prompt.compose`), one per kind of request, each saying what it was for:
  sent to the model, or measured only as /context does; the blocks in front of
  the first message and the CLAUDE.md files behind them, with their kind and
  imports (`prompt.context`); the tools offered, loaded in full or behind
  ToolSearch, by provider (`tool.describe`); the agent types the model can
  start, with when to use each and any a plugin kept from it (`agent.offer`);
  the plugins in the loop: mods with their tier, provenance and what they hook
  and call on `$` (`plugin.register`), other plugins by the tools, agent
  types, skills and permission checks they provide, with the limit said (a mod
  loaded before Glass Box shows only by what it does); the skills loaded
  (`skill.prompt`).
- **Context**: how full the context window is and what fills it, as
  /context counts it (system prompt, tools, memory files, MCP servers,
  messages, free space, the auto-compaction threshold), with a Refresh
  button; the session's cost and what each recent turn added; the rate-limit
  windows with when they reset; the compactions (`session.measure`,
  `$.session.usage`, `session.compact`).
  The meters are two colored boxes, blue, yellow from 70% and red from 90%,
  drawn the same on every surface.
- **Guide**: the agent loop in five steps with the numbers of your last
  turn, what each tab holds, a legend of every mark the Timeline draws, a
  glossary, and what Glass Box cannot see.

#### What the Timeline shows

- **Newest first**: the steps in a turn, and a subagent's turns under its
  call, are listed newest first, as the turns are; the model and effort
  still show where they changed.
- **Waiting for your approval, impossible to miss**: a call waiting for
  your permission is shown at the top of every tab in reverse colors
  (`⚠ WAITING FOR YOUR APPROVAL`, the tool and its argument) and marked the
  same way on its row, until you answer.
- **Animations** for what is running, in VS Code, the desktop app and
  mobile: a pulsing dot (turns, steps, tool calls, server tools), two dots
  taking turns for a subagent at work, three dots for a model thinking, a
  fast orange pulse for a call awaiting approval. SVG animations the surface
  runs itself, at no cost to the session; the terminal keeps a still `●`.

- **Steps**: model and effort (where they change), duration, tokens written,
  why the model stopped in words ("asked for 3 tools", "answered"), the first
  line of what it wrote; open, the full text and the token breakdown
  (context, cached, written, new, output).
- **Tool calls**, one line each: status, tool, duration, permission outcome,
  main argument; open with their step: the full input, the output as the
  model read it, and the verdict told as a sentence with its technical
  fields.
- **Permission verdicts** read as outcomes: the settings rule or hook that
  allowed a call, "approved", "rejected" or "awaiting approval" for an ask,
  "denied" with its rule (`tool.check`).
- **Rewritten calls**: when a PreToolUse hook changes a call's arguments, the
  call is marked `rewritten` and shows both versions
  (`git status → rtk git status`), from the hooks' own answer
  (`classic.PreToolUse`).
- **Cost per turn** in each turn's header, and **compactions** as rows under
  their turn: what triggered them, tokens before and after, or why they
  were skipped.
- **Added to the context**: under each turn, everything Claude Code put in
  front of the model besides your message: its reminders and listings,
  mentioned files, settings hooks' output by event, plugins' context, with
  size and full text (`prompt.attachment`).
- **Server tools** such as the advisor get their own row: duration, model
  (from the result, or the `advisorModel` in your settings), input and
  result read from the transcript.
- **Subagents** under the Agent call that started them, as a tree: type,
  the model it runs on and the one the call asked for, steps, tool calls,
  duration, cost, and tags for a fork, a background agent, a teammate, a
  workflow's agent or a resumed run. Open, it tells what kind of agent it is,
  the permission mode it inherits, the prompt it was given and its own
  turns, steps and tool calls, nested again for agents it starts. It stays
  open while it works (`agent.spawn`). A subagent's turn whose call Glass Box
  did not record stays at the top level and says why.
- **Thinking**: under each step, `∴` and the first line of the model's
  thinking; open, all of it (up to 3,000 characters, with the total), live
  while the step runs, with the note that it may be a summary (`turn.step`
  thinking chunks). When no text of it came, the transcript read back once
  the step is over tells which: the model thought with no text sent, its
  thinking came back redacted, or it did not think; text the stream did not
  carry is taken from the transcript (`$.session.messages`).
- **What other plugins do** through Claude Code, under each one in Plugins
  in the loop: its model calls (model, prompt size), MCP calls, web requests
  (method and URL, host and path only) and processes, with how each went
  and how long it took; never headers, bodies, credentials or environments
  (`model.complete`, `mcp.call`, `http.fetch`, `process.run`).
- **What it does not show, and why**: a README section listing every event
  left out (drawing, the prompt box, listings, the engine's lifecycle,
  Anthropic's telemetry, mods loaded before Glass Box…) with the reason.
- **Slash commands and settings** as rows of their own among the turns: the
  command as typed, who ran it, what it printed and the notes it left for
  the model to read (`command.run`); each `/config` change with its value
  before and after, who made it, or why a plugin refused it (`config.set`).
- **Messages between agents**: under the turn of the loop that sent or
  received them, every message an agent sent (SendMessage, a plugin's) and
  every one that arrived (a teammate's, another session's, a relay's, an
  external event): the other end, delivered or why not, taken or changed by
  a plugin, the text (`session.send`, `session.receive`).
- **Where each message came from**, from the origin Claude Code stamps on
  it (`prompt.submit`): a turn you did not type is titled by its sender
  ("Report from subagent Explore", "Background task ended", "Message from
  another session", "Prompt from plugin …", "Scheduled prompt"…); open, it
  says who sent it and shows its whole text as the model read it. A
  subagent's row says when it reported back. Messages that arrive while a
  turn runs (yours typed meanwhile, a task's notification) are listed under
  it. When a hook changes your message the turn is marked `✎` and shows what
  you typed; a message a hook stops gets a `⊘ blocked` row with the reason.

#### Clarity

- Plain words everywhere, no abbreviations; color kept for what needs
  attention, routine details dim.
- Paths relative to the project, home as `~`; MCP tools by their own name and
  server.
- Every line cut to the pane's width with "…" on every surface, a long
  command on one line, its full text in the details.

#### Robustness

- Glass Box only observes: every hook passes its event on untouched, and a
  failure of its own never touches the session.
- A step interrupted with Esc closes as "no response" instead of staying
  "running".
- State is bounded (turns, calls, context items, skills) and long texts are
  clipped.

#### Project

- README, MIT license, contributing guide, code of conduct, security policy,
  issue and PR templates, CI, roadmap.

[Unreleased]: https://github.com/xmavgithub/claude-code-glass-box/commits/main
