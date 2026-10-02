---
name: setup
description: 'Five-question palate quiz that writes your prefontaine profile (~/.claude/prefontaine/config.json). Use when the user runs /prefontaine:setup or asks to configure, set up, or change how bold prefontaine is.'
disable-model-invocation: true
allowed-tools: AskUserQuestion, Bash, Read
---

# prefontaine setup: the palate quiz

Walk the user through five playful questions, then write their profile and show the card.
Keep your own text between questions to one short line. Tone: a wine-subscription palate
quiz, warm and a little cheeky, never long.

## 0. Look at what is already poured

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/profile.js" card` and `git config user.name`. If a config
already exists (`~/.claude/prefontaine/config.json`), say "Re-tasting your current profile" in
one line and mark its current values "(current)" in the option labels below.

## 1. Ask four questions in ONE AskUserQuestion call

**Q1** header `Body`, question "How bold do you like your agent?", single select:
- `Crisp Sauvignon Blanc`: cautious. Takes forks inside the task, asks before widening scope. Stop hook nudges lightly.
- `Pinot Noir (Recommended)`: balanced. Picks a lane, logs why, stops only at one-way doors.
- `Bold Cabernet`: full_send. Also pulls in adjacent work it finds. Stop hook pushes hardest.

**Q2** header `Doors`, question "Which doors always need a knock?", **multiSelect: true**:
- `Pushes & merges`: a git push to a shared branch, or a merge
- `External sends`: any external send: chat, email, ticketing, docs, any API that publishes
- `Deletes & money`: deleting data you have not read; spending money
- `Credentials`: changing a credential or permission

(AskUserQuestion allows 4 options; the user can add more through "Other". Split any "Other"
text on commas or semicolons into extra entries.)

**Q3** header `Idle`, question "When I finish early, I should...", single select:
- `Swirl my own glass (Recommended)`: self_review. One pass over my own diff, then stop.
- `Open the next bottle`: backlog. Pull the top `- [ ]` item from a backlog file.
- `Cork it`: stop. Say "queue empty" and wait.

**Q4** header `Cellar`, question "Where should I cellar my notes?", single select:
- `In the repo (Recommended)`: repo. `.prefontaine/forks.md`, git-excluded locally, never in the shared .gitignore.
- `In my home dir`: home. `~/.claude/prefontaine/<project>/forks.md`.
- Custom path via "Other": use the typed directory.

## 2. Ask the fifth question

**Q5** header `Name`, question "What should I call you?", single select:
- `<git user.name>` (only if `git config user.name` returned something)
- `Just "the user"`
- Custom via "Other".

If Q3 was backlog, add a sixth only-if-needed question in the same call: header `Backlog`,
"Which bottle do I open next?", options `~/.claude/prefontaine/backlog.md (Recommended)` and
`./BACKLOG.md in this repo`, plus "Other".

## 3. Map answers and write

Map labels to values:
- Q1: Crisp Sauvignon Blanc -> `cautious`, Pinot Noir -> `balanced`, Bold Cabernet -> `full_send`.
- Q2: each selected option -> its full door text above (Deletes & money is two entries). If
  nothing was selected, omit `one_way_doors` (the defaults apply).
- Q3: `self_review`, `backlog`, or `stop`.
- Q4: `repo`, `home`, or the custom path.
- Q5: the chosen name, or omit it for "the user".

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
