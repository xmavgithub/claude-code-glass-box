# Changelog

All notable changes to Glass Box are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Steps show output tokens; the context size moves to the turn's header, and
  the model only where it changes.

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

[Unreleased]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/xmavgithub/claude-code-glass-box/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xmavgithub/claude-code-glass-box/releases/tag/v0.2.0
