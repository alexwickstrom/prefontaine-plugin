---
name: setup
description: 'Four-question setup quiz that writes your prefontaine profile (~/.claude/prefontaine/config.json). Use when the user runs /prefontaine:setup or asks to configure, set up, or change how bold prefontaine is.'
disable-model-invocation: true
allowed-tools: AskUserQuestion, Bash, Read
---

# prefontaine setup

Four questions, one per independent axis of how the agent behaves: autonomy, hard stops,
what to do when done early, and where to log decisions. Do not ask for a name; you already
know what to call the user. Each question is a concrete
scenario, so the user answers with what they would want rather than a self-rating. Keep your
own text between questions to one short line.

## 0. Read the current profile

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/profile.js" card` and `git config user.name`. If a config
already exists (`~/.claude/prefontaine/config.json`), say "Updating your current profile" in
one line and mark its current values "(current)" in the option labels below.

## 1. Ask four questions in ONE AskUserQuestion call

**Q1** header `Autonomy`, question "Mid-task, it hits a choice with a sensible default. It should...", single select:
- `Pick, log why, keep going (Recommended)`: balanced. Stops only at the actions in Q2.
- `Ask me first`: cautious. Takes forks inside the task, asks before widening scope. Stop hook nudges lightly.
- `Pick, keep going, take adjacent work`: full_send. Also pulls in adjacent work it finds. Stop hook pushes hardest.

**Q2** header `Hard stops`, question "Which actions must always wait for your OK?", **multiSelect: true**:
- `Pushes & merges`: a git push to a shared branch, or a merge
- `External sends`: any external send: chat, email, ticketing, docs, any API that publishes
- `Deletes & money`: deleting data you have not read; spending money
- `Credentials`: changing a credential or permission

(AskUserQuestion allows 4 options; the user can add more through "Other". Split any "Other"
text on commas or semicolons into extra entries.)

**Q3** header `Done early`, question "It finishes before you are back. Best use of the time:", single select:
- `Review its own diff (Recommended)`: self_review. One pass over its own diff, then stop.
- `Start the next backlog item`: backlog. Pull the top `- [ ]` item from a backlog file.
- `Stop and report`: stop. Say "queue empty" and wait.

**Q4** header `Decision log`, question "Where should it log the choices it made?", single select:
- `In the repo (Recommended)`: repo. `.prefontaine/forks.md`, git-excluded locally, never in the shared .gitignore.
- `In my home dir`: home. `~/.claude/prefontaine/<project>/forks.md`.
- Custom path via "Other": use the typed directory.

## 2. Follow up only if needed

If Q3 was backlog, ask one more question: header `Backlog`,
"Which backlog file?", options `~/.claude/prefontaine/backlog.md (Recommended)` and
`./BACKLOG.md in this repo`, plus "Other".

## 3. Map answers and write

Map labels to values:
- Q1: Ask me first -> `cautious`, Pick, log why -> `balanced`, Pick, keep going, take adjacent work -> `full_send`.
- Q2: each selected option -> its full door text above (Deletes & money is two entries). If
  nothing was selected, omit `one_way_doors` (the defaults apply).
- Q3: `self_review`, `backlog`, or `stop`.
- Q4: `repo`, `home`, or the custom path.

Then pipe the answers as JSON to the writer (it validates, backs up any existing config to
`config.json.bak`, writes, and prints the card):

```
echo '<answers json>' | node "${CLAUDE_PLUGIN_ROOT}/lib/profile.js" write
```

## 4. Show the profile card

Print the writer's output inside a fenced code block, then one line:
"Saved to ~/.claude/prefontaine/config.json. Re-run /prefontaine:setup any time; start the
loop with /prefontaine:prefontaine."

If the user chose backlog and the backlog file does not exist, create it with a one-line
header `# Backlog` and say so. Do not add items to it.
