# Glass Box

[![CI](https://github.com/xmavgithub/claude-code-glass-box/actions/workflows/ci.yml/badge.svg)](https://github.com/xmavgithub/claude-code-glass-box/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**See how Claude Code works, while it works.**

Glass Box is a [Claude Code](https://claude.com/claude-code) mod that keeps a
live audit pane beside the chat. For every prompt it shows the model steps
Claude took, what it wrote at each step, the tool calls each step asked for,
who allowed them, what went in and what came out, how long each part took and
how many tokens it used.

It is the opposite of a black box: a way to review, debug and learn from an
agent's process instead of trusting only its final answer.

```text
3 turns · 9 steps · 14 tool calls · 1 failed/denied

▾ ● Turn 14:02:11 · 2 steps · 3 tools · … · running
  “add a license and push the repo”
  ▸ ✓ Step 1 opus-5-5 high · 3.1s · 42.2k in · 340 out · → tools
    I'll check the repository state first.
    ▸ ✓ Bash 412ms allowed by Bash(git:*)
      git status
    ▸ ✓ Read 9ms allowed
      /Users/me/project/LICENSE
    ▸ ⊘ Write 3ms denied by Write(/etc/**)
      /etc/hosts
  ▸ ● Step 2 opus-5-5 high · … · running
▸ ✓ Turn 13:58:40 · 2 steps · 3 tools · 9.7s · answered
  “run the tests”
```

Click any `▸` to expand a turn, a step or a tool call (or give the pane the
keyboard, then use Tab and Enter).

Status marks: `●` running, `✓` done, `✗` failed, `⊘` denied.

## What it shows

| Level | What you see | Expanded |
| --- | --- | --- |
| **Turn** | The prompt that started it (yours or a subagent's), start time, steps, tools, duration, outcome | Its steps |
| **Step** | One request to the model: model and effort, duration, context tokens in, output tokens, why it stopped, the first line of what it wrote | The full text, the exact token breakdown (input, cache read, cache write, output), message count, server-side tools such as the advisor |
| **Tool call** | Status, tool, duration, permission verdict, main argument (command, file, pattern, URL...) | Full input as JSON, the output as Claude read it, and the complete verdict: decision, reason, rule, hook, setting, plugin, approver |

The newest turn is open; older turns fold away. A header line counts turns,
steps, tool calls and failures for the session. Tool calls that no recorded
step asked for (raised by another plugin, or made before Glass Box loaded) are
listed at the bottom under **Other tool calls**.

## Install

Glass Box needs a Claude Code version that supports mods (function hooks). It
was built and tested with Claude Code 2.1.318.

At the prompt of a terminal session:

```text
/plugin install glass-box --marketplace xmavgithub/claude-code-glass-box
```

Answer `y` to add the marketplace, then choose a scope (user scope loads it in
every session).

From a shell:

```sh
claude plugin install glass-box --marketplace xmavgithub/claude-code-glass-box
```

In the desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with
`xmavgithub/claude-code-glass-box`, then **Add plugin**.

## Use

- The pane opens by itself when a session starts on a wide terminal (144
  columns or more). Otherwise, or after you closed it, type **`/glass-box`**.
- In the fullscreen terminal layout from 110 columns the pane is docked beside
  the conversation; elsewhere it sits above the prompt. Where it goes is
  decided by Claude Code, not by the mod.
- Close it with its close mark or `ctrl+x x`; `ctrl+x tab` moves between panes.
  Closing it loses nothing: recording goes on and the timeline is there when
  you reopen it.

## How it works

Glass Box only observes. Each hook passes the event on unchanged and records
what it saw; if Glass Box itself fails, the session carries on as if it were
not installed.

| Event | What Glass Box records |
| --- | --- |
| `turn.start` / `turn.complete` | The prompt, the loop (main or subagent), duration, outcome, usage |
| `turn.step` (streamed) | Model, effort, message count; then the text, tokens and stop reason. The stream's `tool` chunks carry the `tool_use_id`s that tie a step to its tool calls |
| `tool.check` | The permission verdict and what decided it |
| `tool.call` | Arguments, result text, error or deny, duration |

## Privacy

- Everything stays on your machine, in the session's own state. Glass Box sends
  nothing anywhere and keeps nothing across sessions.
- The pane shows tool inputs and outputs as they are, which can include file
  contents or command output you would not want on a shared screen.
- To stay light it keeps the last 30 turns and 300 tool calls, and clips long
  texts (prompts at 600 characters, step text at 1,200, inputs at 2,000,
  outputs at 1,500).

## Limitations

- Extended thinking is not shown yet (see the roadmap).
- Server-side tools such as the advisor run inside the model request: Glass Box
  lists them on their step but cannot show their input or output.
- The mod API it builds on is in early access and may change between Claude
  Code releases.

## Roadmap

Ideas, not promises. Discussion and pull requests are welcome.

- A fixed header with context window usage, session cost and rate limits.
- Filters: errors only, current turn, by tool.
- A statistics view: calls, total time and failures per tool.
- An excerpt of the model's thinking for each step, where the model streams it.
- The active instructions: which system prompt sections (CLAUDE.md, memory,
  skills) were in play, with their size.
- Skills loaded and compactions as their own timeline rows.

## Development

```sh
git clone https://github.com/xmavgithub/claude-code-glass-box
cd claude-code-glass-box

claude plugin validate .   # what the engine would load or refuse
claude plugin test .       # the tests in tests/
claude --plugin-dir .      # a session with Glass Box loaded from this folder
```

Edits reload the mod by themselves in a session that loads it from a folder.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the project's conventions.

## Contributing

Bug reports, ideas and pull requests are welcome: read
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Mauro Salvo
