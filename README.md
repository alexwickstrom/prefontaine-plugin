# prefontaine

**Run through the tape.**

*Your coding agent keeps going until the work is done: it logs every fork it takes and stops only at the doors you can't walk back through.*

> "To give anything less than your best is to sacrifice the gift." (Steve Prefontaine)

[![CI](https://github.com/alexwickstrom/prefontaine-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwickstrom/prefontaine-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexwickstrom/prefontaine-plugin?sort=semver)](https://github.com/alexwickstrom/prefontaine-plugin/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://code.claude.com/docs/en/plugins)

## Why

- **No more "Want me to fix that?"** An offer with no plausible "no" is a stop wearing a question mark. prefontaine makes the agent do the predictable yes and report after.
- **Bold, but with a backtrack stack.** Every fork it takes gets four written lines (what, why, the road not taken, how to prove it wrong), so a wrong call is cheap to undo.
- **Stops where it should.** Pushes, merges, external sends, deletes, money, credentials: the doors you name always get a knock.

## Your profile card

```
PREFONTAINE PROFILE: PINOT NOIR
"Smooth, confident, picks a lane and logs why."

Poured for:      the user
Body:            balanced
When idle:       Swirl and sniff its own work (self-review)
Backlog:         off
Cellar (notes):  .prefontaine/forks.md in the repo (git-excluded)
Always knock at:
  - a git push to a shared branch, or a merge
  - any external send: chat, email, ticketing, docs, any API that publishes
  - deleting data you have not read
  - spending money
  - changing a credential or permission
Stop hook tiers: offer on (4), tasks on (12), backlog off, self-review on (1)
```

*Maintainers: render `assets/setup.gif` with `vhs assets/setup.tape` ([VHS](https://github.com/charmbracelet/vhs)) and embed it here. Users can skip this.*

## Install

From a clone (or any local path):

```bash
claude plugin marketplace add /path/to/prefontaine-plugin
claude plugin install prefontaine@prefontaine
```

From GitHub: `claude plugin marketplace add alexwickstrom/prefontaine-plugin`. To try it for one session without installing: `claude --plugin-dir /path/to/prefontaine-plugin`.

Requires `node` on PATH (the Stop hook runs on it). `gum` is optional, for the fancy terminal quiz.

## Setup

Pick a profile with a five-question palate quiz. Either:

- **In Claude Code:** `/prefontaine:setup` (multiple-choice cards).
- **In your terminal:** `bin/prefontaine-setup` (gum TUI; plain prompts if gum is missing). Flags: `--defaults` (no questions), `--dry-run` (print the card, write nothing), `--no-gum` (plain prompts, no gum UI).

Then start the loop in a session with `/prefontaine:prefontaine`. To turn the skill's behavior off, type "stand down" or "normal mode" to the agent in Claude Code. That does not turn off the Stop hook; use the off switch under [How it works](#how-it-works) (Safety first) for that.

## How it works

<details>
<summary>The Stop hook, safety rules, and config reference (click to expand)</summary>

### The helper at the door

Think of a helper at the door who checks the chore list before letting you leave. When the agent tries to end its turn, the Stop hook (`velcro`) looks at what actually happened:

1. **Offer guard.** The turn did real work and its last line offers to do the next thing? Do it instead.
2. **Task guard.** Tasks still open in this session? Finish the top one.
3. **Backlog pull** (opt-in). Work done and your backlog has `- [ ]` items? Pull one.
4. **Self-review** (once per session). Take one pass over your own diff; if it is clean, say so and stop.

A purely conversational turn is always allowed to end in a question. The skill supplies the rules (the fork log, claim stamps, when to fan out to subagents); the hook supplies the nudge.

### Safety first

- **Never on its own:** pushes, merges, external sends, deletes, spending, or credential changes are one-way doors. The agent stops and names the door in one line.
- **Budgets:** every tier has a per-session block budget (see the table below). When it runs out, the hook lets the stop through.
- **Self-review fires at most once per session**, so a review that edits files cannot re-arm itself.
- **Never blocks a forced continuation** (`stop_hook_active`), and every read fails open: a broken hook cannot wedge a session.
- **Off switch:**
  - `touch ~/.claude/prefontaine/disabled` (pause; delete the file to resume)
  - `PREFONTAINE_DISABLE=1 claude` (one session)
  - `claude plugin disable prefontaine@prefontaine` (everything)

> **Heads up:** the Stop hook makes the agent keep working after it would normally stop. If that is ever not what you want, use the off switch above.
>
> **Already have a personal prefontaine or velcro Stop hook in `~/.claude/settings.json`?** Remove that `Stop` entry before installing, or both hooks will fire on every stop.

### Config reference

One file: `~/.claude/prefontaine/config.json`. Every key is optional; absent keys use the defaults. The hook reads it on every run; the skill reads it when invoked. Print the effective config with `node lib/config.js`.

| Key | Default | Meaning |
| :- | :- | :- |
| `name` | `"the user"` | What the agent calls you. |
| `autonomy` | `"balanced"` | `cautious`, `balanced`, or `full_send`. Sets the tier budgets and how assertive the skill is. |
| `one_way_doors` | the five above | List of strings. The only legitimate reasons to stop. A git push or merge is always included, even if you leave it out. |
| `when_idle` | `"self_review"` | `stop`, `backlog`, or `self_review`. What a finished working turn does. |
| `backlog_file` | `null` (off) | Markdown checklist for the backlog tier. `~` is expanded. |
| `notes_dir` | `"repo"` | `repo`: `.prefontaine/forks.md` at the repo root, added to `.git/info/exclude` (never the shared `.gitignore`), falling back to `~/.claude/prefontaine/<project>/forks.md` outside a repo. `home`: always the latter. Any other value: a directory. Notes are append-only. |
| `tiers` | from `autonomy` | Per-session budget overrides: `{"offer": n, "tasks": n, "backlog": n, "self_review": 0 or 1}`. `0` turns a tier off. |

Budgets per autonomy preset:

| Tier | cautious | balanced | full_send |
| :- | :-: | :-: | :-: |
| offer | 2 | 4 | 8 |
| tasks | 4 | 12 | 24 |
| backlog | 0 | 6 | 12 |
| self_review | 1 | 1 | 1 |

`when_idle: "stop"` turns off backlog and self-review; `"self_review"` turns off backlog; backlog is also off whenever `backlog_file` is unset.

#### Plugin options and precedence

`name`, `autonomy`, `when_idle`, and `backlog_file` are also plugin options, so `claude plugin configure prefontaine@prefontaine` and `/config` work. Precedence, highest first:

1. Off switch (`PREFONTAINE_DISABLE=1` or the `disabled` file)
2. Plugin options, when set (the value `from_config` or empty means "use the file")
3. `~/.claude/prefontaine/config.json`
4. Built-in defaults

Hook block counters live in the plugin data directory (`${CLAUDE_PLUGIN_DATA}`), or `~/.claude/prefontaine/state/` when run outside the plugin.

</details>

## Development

```bash
npm test                                         # node --test, no dependencies
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
claude plugin details prefontaine@prefontaine    # after install: inventory and token cost
```

Projected cost: about 110 tokens always-on; about 2.4k when `/prefontaine:prefontaine` is invoked and about 0.9k for `/prefontaine:setup`. The hook itself costs no model context.

## License

MIT. See [LICENSE](LICENSE).
