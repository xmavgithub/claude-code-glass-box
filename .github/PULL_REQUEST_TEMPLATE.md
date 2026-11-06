## What and why

<!-- What this pull request changes, and the problem it solves. Link the issue: Closes #... -->

## How it was checked

<!-- The surfaces you tried it on (terminal, VS Code, desktop app), and anything you checked by hand. -->

## Checklist

- [ ] `claude plugin validate .` passes
- [ ] `claude plugin test .` passes, with tests for what changed
- [ ] Hooks still only observe: each returns what `next(e)` returned
- [ ] Shape tags bumped if a stored record's fields changed
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] README updated if what users see or do changed
