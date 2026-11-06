# Changelog

All notable changes to Glass Box are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Instructions** tab (hotkey `3`; How it works moves to `4`): what the model
  is told before it reads the conversation.
  - The **system prompt**, section by section, with each section's size, text,
    and whether it is shared (the same for everyone, cached across users) or
    yours; one entry per kind of prompt (main loop, subagents), with model,
    output style and tool count (`prompt.compose`).
  - What goes **in front of the first message**: the context blocks
    (`claudeMd`, the date…) and the instruction files behind `claudeMd`,
    with their kind and which file imported them (`prompt.context`).
  - The **tools offered**: how many are loaded in full, the size of their
    descriptions, and which wait behind ToolSearch, by provider
    (`tool.describe`).
  - The **skills loaded** in the session, with source, size and text
    (`skill.prompt`).
- Glossary entries for system prompt, instruction files, skill and
  ToolSearch.

## [0.4.0] - 2026-11-06

### Added

- **Rewritten calls.** When a PreToolUse hook (from your settings or a plugin)
  changes a tool call's arguments, the call is marked `rewritten` and its line
  shows both versions (`git status → rtk git status`); its details list every
  changed argument. Read from the hooks' own answer (`classic.PreToolUse`).
- **Added to the context.** Under each turn, everything Claude Code put in
  front of the model besides your message: its own reminders and listings,
  files you mentioned, settings hooks' output (by event, such as
  SessionStart) and plugins' context, with size and full text
  (`prompt.attachment`). Stats sums it up by source.
- **Clear** button (hotkey `c`) to empty the timeline.
- [ROADMAP.md](ROADMAP.md): vision, principles and milestones.

## [0.3.0] - 2026-11-06

### Added

- Tabs inside the pane: **Timeline** and **Stats** (hotkeys `1` and `2` while
  the pane has the keyboard). Stats sums up the session: calls, failures and
  time per tool; what the permission checks came to and which settings rules
  allowed the most calls; model steps, time in the model against time in
  tools, output tokens, peak context and cache share, stop reasons, models.
- **How it works** tab: the agent loop in five steps with the numbers of your
  last turn, a legend of marks and colors, a glossary, and what Glass Box
  cannot see.
- **Server tools**, such as the advisor, get their own row under their step:
  duration, model (from the result, or the `advisorModel` in your settings),
  and, in the open step, their input and their result read from the
  transcript. Stats counts them too.
- Plain-language explanations: each permission verdict is told as a sentence
  ("Allowed without asking: your settings contain the rule …"), each open
  step says what was sent to which model, and an empty pane explains what
  will appear.

### Changed

- A denser, calmer layout. Each tool call is one line, and its details open
  with its step: only turns and steps have a toggle, so the desktop and
  VS Code panes no longer show a button on every row.
- Lines are truncated with "…" to the pane's width on the terminal instead of
  running past its edge.
- Verdicts read as outcomes: an ask shows "approved", "rejected" or "awaiting
  approval"; routine verdicts are dim and color is kept for what needs
  attention.
- Paths are relative to the project (home as `~`), MCP tools show their own
  name and their server, and an MCP call's summary is its first argument
  instead of raw JSON.
- Steps show the tokens the model wrote and why it stopped in words ("asked
  for 3 tools", "answered"); the context size moves to the turn's header, and
  the model only where it changes. No abbreviations left in the pane.

## [0.2.1] - 2026-11-06

### Fixed

- A step whose response is interrupted (Esc during a turn) no longer stays
  marked as running: it closes as "no response".

## [0.2.0] - 2026-11-06

### Added

- **Turns**: tool calls are grouped under the prompt that caused them, for the
  main loop and for each subagent, with duration and outcome.
- **Model steps**: every request to the model inside a turn, with the text it
  wrote, model and effort, tokens (context in, output, cache), duration, stop
  reason and server-side tools such as the advisor.
- **Permission verdicts**: each tool call shows who allowed, asked about or
  denied it: the settings rule, the hook, the setting or the plugin.
- `/glass-box` command to open the pane.
- Open source project files: README, license, contributing guide, code of
  conduct, security policy, issue and PR templates, CI.

### Changed

- Renamed from `tool-calls-panel` to **Glass Box**; the interface is in English.
- Tool calls are linked to the step that asked for them by `tool_use_id`.

## 0.1.0 - 2026-11-06

### Added

- First version, never published on its own: a pane listing every tool call with status, duration,
  main argument, and expandable input and output.

[Unreleased]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xmavgithub/claude-code-glass-box/releases/tag/v0.2.0
