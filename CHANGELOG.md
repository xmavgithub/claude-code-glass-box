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
  with `/glass-box` anywhere. Five tabs (hotkeys `1` to `5` while the pane has
  the keyboard) and a **Clear** button (`c`).
- **Timeline**: every turn (your message, or a subagent's prompt), every step
  (one request to the model), every server tool and every tool call, as they
  happen. The newest turn is open; turns and steps open and close on a click.
- **Stats**: calls, failures and time per tool; what the permission checks
  came to and which settings rules allowed the most calls; what was added to
  the context, by source; time in the model against time in tools, output
  tokens, peak context and cache share, stop reasons, models.
- **Instructions**: what the model is told before it reads the conversation.
  The system prompt section by section, shared or yours, with size and text
  (`prompt.compose`); the blocks in front of the first message and the
  CLAUDE.md files behind them, with their kind and imports
  (`prompt.context`); the tools offered, loaded in full or behind ToolSearch,
  by provider (`tool.describe`); the skills loaded (`skill.prompt`).
- **Context**: how full the context window is and what fills it, as
  /context counts it (system prompt, tools, memory files, MCP servers,
  messages, free space, the auto-compaction threshold), with a Refresh
  button; the session's cost and what each recent turn added; the rate-limit
  windows with when they reset; the compactions (`session.measure`,
  `$.session.usage`, `session.compact`).
- **How it works**: the agent loop in five steps with the numbers of your last
  turn, a legend of marks and colors, a glossary, and what Glass Box cannot
  see.

#### What the Timeline shows

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
