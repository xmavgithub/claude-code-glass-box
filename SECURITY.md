# Security Policy

## Supported versions

Only the latest release of Glass Box receives fixes.

## What Glass Box handles

Glass Box runs inside Claude Code and only observes: it records turns, model
steps, permission verdicts and tool calls in the session's own state, and
draws them in a pane. It makes no network requests, writes no files and keeps
nothing across sessions. It does display tool inputs and outputs, which can
contain sensitive data.

Examples of issues we want to hear about:

- Glass Box changing, blocking or answering an event it should only observe.
- Data recorded by Glass Box reaching anywhere other than the pane.
- A way for content shown in the pane (a crafted tool output, say) to trigger
  actions.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, the Claude Code version
(`claude --version`) and the surface you use. You will get an answer within
a few days, and credit in the release notes if you want it.
