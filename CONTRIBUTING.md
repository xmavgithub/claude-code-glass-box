# Contributing to Glass Box

Thanks for helping make Claude Code more transparent. This guide covers how
to set up, the few rules the code follows, and what a pull request needs.

## Ways to help

- **Report a bug**: open an issue with the bug template. Say which Claude Code
  version you run (`claude --version`) and which surface (terminal, VS Code,
  desktop app).
- **Propose an idea**: open an issue with the feature template, or comment on
  an item of the roadmap in the README.
- **Send a pull request**: for anything larger than a small fix, open an issue
  first so we can agree on the approach.

## Setup

You need Claude Code with mod support (function hooks).

```sh
git clone https://github.com/<you>/claude-code-glass-box
cd claude-code-glass-box
claude --plugin-dir .
```

In that session Glass Box loads from your working copy and reloads by itself
when you save a file. A hook that fails, or a module that does not load, is
named in a dim line of the transcript.

The first load writes the API's type declarations to `.claude-plugin/types/`
(ignored by git). With them in place your editor type-checks the code, and so
does `tsc -p .` with TypeScript 5.4 or newer.

## Layout

```text
.claude-plugin/plugin.json       the mod's manifest
.claude-plugin/marketplace.json  makes the repository installable
hooks/hooks.json                 names the hooks module
hooks/register.tsx               every hook and the pane's drawing
types/index.d.ts                 the shape of the state the mod keeps
tests/panel.test.tsx             tests, run by `claude plugin test .`
```

## Rules the code follows

1. **Observe, never change.** Every hook returns what `next(e)` returned,
   untouched. Glass Box must never alter, delay noticeably, block or answer an
   event.
2. **Fail quietly.** State writes go through `quietly()`, and every hook that
   could refuse something (`tool.call`, `tool.check`, `turn.start`,
   `turn.complete`) ends with `.catch(($, e, next) => next(e))`, so a bug in
   Glass Box costs a missing timeline row, never a failed tool call.
3. **Bump the shape tag.** When you change the fields of a stored record
   (`Turn`, `Step`, `ToolCall`, `Verdict`), bump the matching `shape` tag in
   `register.tsx` (for example `calls-2` to `calls-3`). The engine then drops
   values an earlier version stored instead of handing old shapes to new code.
4. **Stay bounded.** State lives for the whole session: cap every list and clip
   every text that comes from outside.
5. **Draw for every surface.** The pane is drawn on the terminal, VS Code, the
   desktop app and mobile. Tests mount it on each.
6. **Keep the declarations in sync.** Every state key the code reads or writes
   is declared in `types/index.d.ts`; `claude plugin validate .` checks it.

## Before you open a pull request

```sh
claude plugin validate .
claude plugin test .
```

Both must pass, and CI runs them again. Then:

- Add or update tests for what you changed.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- Update the README if what users see or do changes.
- Keep the pull request to one topic.

Commit messages: a short imperative summary line (`Add per-tool statistics
view`), a blank line, then the why if it is not obvious.

## Releasing (maintainers)

1. Move the **Unreleased** entries under a new version in `CHANGELOG.md`.
2. Bump `version` in `.claude-plugin/plugin.json`.
3. Tag the commit `vX.Y.Z` and publish a GitHub release with the changelog
   section as its notes.

## Code of Conduct

Taking part in this project means following its
[Code of Conduct](CODE_OF_CONDUCT.md).
