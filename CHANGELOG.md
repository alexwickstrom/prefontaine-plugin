# Changelog

## 0.1.0 (2026-10-02)

First release. Run through the tape.

- `prefontaine` skill: take the fork, log it, stop only at one-way doors. Stays on until "stand down".
- `velcro` Stop hook: blocks a working turn that ends by offering to act, or with open tasks; optional backlog pull; one self-review pass per session. Per-tier budgets, never blocks a forced continuation, fails open.
- `/prefontaine:setup`: five-question palate quiz inside Claude Code.
- `bin/prefontaine-setup`: the same quiz as a terminal TUI (gum, with a plain fallback), plus `--defaults` and `--dry-run`.
- One config file, `~/.claude/prefontaine/config.json`, plus plugin options for `claude plugin configure`.
- Off switches: `~/.claude/prefontaine/disabled` and `PREFONTAINE_DISABLE=1`.
