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
3 turns · 9 steps · 14 tool calls · 1 failed

▾ ● Turn · 14:02 · 2 steps · 4 tools · ctx 42.2k · running
  “add a license and push the repo”

  ▸ ✓ Step 1 · opus-5-5 high · 3.1s · out 340 · → tools
    › I'll check the repository state first.
    ✓ Bash  412ms  Bash(git:*)  git status
    ✓ Read  9ms  allowed  LICENSE
    ✓ scan_secrets ·plugin-authoring  96ms  ~/project
    ⊘ Write  3ms  denied · Write(/etc/**)  /etc/hosts

  ▸ ● Step 2 · running

▸ ✓ Turn · 13:58 · 2 steps · 3 tools · ctx 40.1k · 9.7s
  “run the tests”
```

Click a `▸` to open a turn or a step (or give the pane the keyboard, then use
Tab and Enter). An open step shows its full text, its token breakdown and,
under each of its tool calls, the call's input, output and permission verdict.

Status marks: `●` running, `✓` done, `✗` failed, `⊘` denied. Color is kept
for what needs attention (failures, denials, a call waiting for approval);
routine verdicts are drawn dim. Paths are shown relative to the project, the
home folder as `~`, and MCP tools by their own name followed by their server.

## How Claude Code works, in one minute

Claude Code is a loop around a model. The model only reads and writes text;
Claude Code does everything else.

1. **Turn.** You send a message. Everything Claude Code does until it answers
   you is one turn.
2. **Step.** Claude Code sends the whole conversation to the model. The model
   writes text and may ask for tools. One request and its answer is one step.
   The model may also consult **server tools** the API runs by itself, such as
   the advisor (a second model it asks for a review or a plan).
3. **Permission check.** Before each tool runs, Claude Code checks your
   settings, your hooks and the permission mode: the call is allowed, asked
   about, or denied.
4. **Tool call.** Claude Code runs the tool (reads a file, runs a command,
   searches the web…) and adds its result to the conversation.
5. **Again.** With the results, Claude Code starts a new step. The turn ends
   when a step answers without asking for tools.

Glass Box draws exactly this loop, live, and its **Guide** tells it
with your own numbers, plus a legend and a short glossary.

## What it shows

The pane has four tabs (hotkeys `1` to `4` while it has the keyboard) and,
beside the session's counts, a **Guide** button (`g`):

- **Timeline**: every turn, step, server tool and tool call, as below.
- **Stats**: the session at a glance: calls, failures and time per tool; what
  the permission checks came to and which rules allowed the most; what was
  added to the context, by source; time in the model against time in tools,
  tokens, context and cache, stop reasons.
- **Prompt**: what the model is told before it reads the conversation.
  The system prompt section by section (shared or yours, size, text); the
  blocks in front of the first message and the CLAUDE.md files behind them;
  the tools offered, loaded in full or behind ToolSearch; the agent types the
  model can start, and any a plugin kept from it; the plugins in the loop
  (mods with what they hook and call, other plugins by the tools, agent
  types, skills and permission checks they provide); the skills loaded.
- **Context**: how full the context window is and what fills it (system
  prompt, tools, memory files, MCP servers, messages, free space), as
  /context counts it; the session's cost and each recent turn's; the
  rate-limit windows and when they reset; the compactions.
- **Guide**: the loop above, a legend of the marks and colors, and a
  glossary (token, context, cache, effort, permission rule, hook, auto mode,
  subagent, MCP tool, server tool).

In the Timeline:

| Level | What you see | Expanded |
| --- | --- | --- |
| **Turn** | The prompt that started it (yours or a subagent's), start time, steps, tools, context size, duration, outcome. A turn you did not type is named by where its message came from, as Claude Code stamps it: a background subagent's report, another session or agent, a background task, a scheduled task, a plugin, a channel. `✎` when a hook changed your message | Its steps; for a turn you did not type, who sent it and its whole text as the model read it; what you typed when a hook changed it; the messages that arrived while it ran. A message a hook stopped gets a `⊘ blocked` row with the reason |
| **Step** | One request to the model: model and effort (when they change), duration, output tokens, why it stopped, the first line of its thinking (`∴`) and of what it wrote (`›`) | Its thinking as it streamed, with its size, the full text, the token breakdown (context, cached, written, new, output), message count, server-side tools such as the advisor, and the details of its tool calls |
| **Added to the context** | One line under the turn's prompt: how many items Claude Code put in front of the model besides your message, their size, and who wrote them (Claude Code, hooks, plugins) | Each item: its source (a SessionStart hook, say), its kind, size, time and full text |
| **Slash command** | A row of its own among the turns, at its time: the command as typed, who ran it (you, a plugin, the phone), and whether it left notes for the model | What it printed, and the notes it left for the model to read, never shown to you |
| **Setting** | A row of its own: the `/config` row, its value before and after, who changed it, or that a plugin refused the change and why | |
| **Messages between agents** | One line under the turn: how many messages its loop sent and received, and how many did not get through | Each message: to or from whom (an agent, a teammate, another session, a relay, an external event), who sent it (the model or a plugin), whether it was delivered or why not, whether a plugin took or changed it, and its text |
| **Server tool** | One line: the tool the API ran inside the step (the advisor, say), its duration, and its model: the one the result names, else the `advisorModel` your settings name | Under its open step: its input and its result as the transcript keeps it |
| **Subagent** | Under the Agent call that started it: its type, the model it runs on, steps, tool calls, duration, cost, and whether it is a fork, runs in the background, is a teammate or a workflow's agent. Open while it works | What kind of agent it is, the model the call asked for, the permission mode it inherits, the prompt it was given, and its own turns, steps and tool calls (and the subagents it starts, nested again) |
| **Tool call** | One line: status, tool, duration, what the permission check came to (rule, hook, allowed, approved, rejected, denied), `rewritten` when a hook changed its arguments, main argument (both versions when a hook changed it) | Under its open step: full input as JSON, the output as Claude read it, and the complete verdict: decision, reason, rule, hook, setting, plugin, approver |

The newest turn is open; older turns fold away. A header line counts turns,
steps, tool calls and failures for the session, with **Guide** (`g`) and
**Clear** (`c`) beside it. A subagent's turn whose Agent call Glass Box did
not record (it started before Glass Box loaded) is listed at the top level.
Tool calls that no recorded step asked for (raised by another plugin, or made
before Glass Box loaded) are listed at the bottom under **Other tool calls**.

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
| `command.run` / `config.set` | Slash commands that ran, with their output and notes for the model; `/config` changes, before and after, or why refused |
| `agent.offer` | Each agent type offered to the model: its source and provider, when to use it, and whether a plugin kept it from the model |
| `session.send` / `session.receive` | Messages between agents and sessions: recipient or sender, delivered or not, taken or changed by a plugin, text |
| `plugin.register` | A mod joining the chain after Glass Box: its tier, provenance, version, the events it hooks and what it calls on `$` |
| `prompt.submit` | Every message entering the session: where it came from (`origin`), the text a hook beneath changed it to, or why it was stopped |
| `turn.start` / `turn.complete` | The prompt, the loop (main or subagent), duration, outcome, usage |
| `turn.step` (streamed) | Model, effort, message count; then the text, tokens and stop reason. The stream's `tool` chunks carry the `tool_use_id`s that tie a step to its tool calls; its `thinking` chunks, the model's thinking |
| `tool.check` | The permission verdict and what decided it |
| `tool.call` | Arguments, result text, error or deny, duration |
| `agent.spawn` | A subagent starting: the call that started it (its `tool_use_id`), type, prompt, the model asked for and the one resolved, fork, background, teammate, workflow. Its `agentId` ties it to its turns |

## Privacy

- Everything stays on your machine, in the session's own state. Glass Box sends
  nothing anywhere and keeps nothing across sessions.
- The pane shows tool inputs and outputs as they are, which can include file
  contents or command output you would not want on a shared screen.
- To stay light it keeps the last 30 turns, 300 tool calls and 200 items of
  added context, and clips long texts (prompts at 600 characters, step text at
  1,200, thinking at 3,000, inputs at 2,000, outputs at 1,500, added context at
  4,000). **Clear** empties it at any time.

## Limitations

- Thinking is shown as Claude Code receives it: it may be a summary of the
  model's reasoning. Some models think without sending any text of it; once
  the step is over Glass Box reads the transcript and says whether the model
  thought with no text sent, its thinking came back redacted, or it did not
  think. A step it cannot match in the transcript says it cannot tell.
- Server-side tools such as the advisor run inside the model request: Glass Box
  shows their input and result as the transcript keeps them, read back once
  the step is over, but not how they worked inside. The advisor's model is the
  one its result names or, failing that, the one your settings name; the API
  does not otherwise say which model answered.
- The mod API it builds on is in early access and may change between Claude
  Code releases.

## Roadmap

Glass Box is in development towards 1.0, with no releases before then. See
[ROADMAP.md](ROADMAP.md): the vision, the principles every feature is held to,
what is done, and what comes next.
Discussion and pull requests are welcome.

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
