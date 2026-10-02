#!/usr/bin/env node
/**
 * velcro: a Stop hook that refuses to end the turn while there is obvious work left.
 *
 * WHY THIS EXISTS
 * Emitting text with no tool call IS the stop. A line like "continuing on polish" reads as
 * a transition and behaves as a full stop. A skill cannot fix this: skills shape what gets
 * written, they cannot hand back another turn. Only the harness can, and this is its lever.
 *
 * CONTRACT
 *   exit 0, no output                       -> allow the stop
 *   exit 0 + {"decision":"block","reason"}  -> block it; `reason` is the next instruction
 * The JSON form is used instead of `exit 2 + stderr` because the harness renders every
 * non-zero exit as a "Stop hook error", so the harder the hook worked the more broken it
 * looked.
 *
 * TIERS, checked in order. First one that fires blocks.
 *   0. offer:       turn ends by offering to act    -> do it instead   (needs a working turn)
 *   1. tasks:       tasks still open in the session -> finish them
 *   2. backlog:     backlog file has unchecked items -> pull one       (needs a working turn)
 *   3. self_review: this turn edited files           -> one review pass (needs a working turn)
 *
 * DELIBERATELY NOT RANDOM. Every tier is a predicate on observable state. The only
 * randomness is WHICH backlog item gets picked, never WHETHER to continue. A forced cleanup
 * pass on a turn with nothing to clean produces churn, which the repo's checks then pay for.
 *
 * "A working turn" means this turn did something: an edit, or a build/test/lint run.
 * Tiers 0, 2 and 3 are gated on it so that asking a question stays a question.
 *
 * DELIBERATE LIMITS, so this cannot trap anyone in a loop:
 *  - Per-tier block budgets per session (see lib/config.js). 0 turns a tier off.
 *  - Tier 3 fires at most ONCE per session: a review pass edits files, which would
 *    otherwise re-arm it forever.
 *  - Never blocks when stop_hook_active is set (already mid-continuation).
 *  - Tier 1 counts only `pending` / `in_progress` tasks not blocked by an open task.
 *  - Every read is wrapped: anything unreadable means "nothing to do". A broken hook must
 *    never be able to wedge a session.
 *
 * TO DISABLE: PREFONTAINE_DISABLE=1, or `touch ~/.claude/prefontaine/disabled`, or
 * `claude plugin disable prefontaine`.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

let config
try {
  config = require('../lib/config.js')
} catch {
  process.exit(0) // a broken install must not wedge a session
}

const BACKLOG_TOP_N = 3
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const WORK_CMD =
  /\b(bazel|pytest|pnpm|npm|yarn|make|ruff|ty|tilt|pre-commit|mvn|gradle|cargo|go test|jest|vitest|tsc|eslint)\b/

// A turn that ends by offering to do the obvious next thing has stopped, whatever the
// punctuation says. The offer satisfies every other tier, because work did happen.
const OFFER_TO_ACT =
  /\b(want me to|should i|shall i|do you want me to|would you like me to|say the word|let me know if|tell me to|if you want,? i)\b[^.!?]*[?.!]?\s*$/i

const RECRUIT =
  '\nIf the remaining work is parallelizable or spans multiple files/areas, do NOT grind ' +
  'through it serially and do NOT wait to be told: spawn subagents on non-overlapping files, ' +
  'or a Workflow, then verify their output before reporting it done.\n'

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function stateDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(config.homeDir(), 'state')
}

function counter(name, sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '-')
  const file = path.join(stateDir(), `${name}-${safe}`)
  let n = 0
  try {
    n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0
  } catch {
    /* first block of the session */
  }
  return {
    count: n,
    bump() {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, String(n + 1))
      } catch {
        /* if the counter cannot be written, fail open rather than block forever */
      }
    },
  }
}

function openTasks(sessionId) {
  if (!sessionId) return []
  const dir = path.join(os.homedir(), '.claude', 'tasks', String(sessionId))
  let entries
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const all = []
  for (const file of entries) {
    try {
      all.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    } catch {
      /* a single unparseable task must not block the session */
    }
  }
  const unresolved = new Set(
    all.filter((t) => t && t.status !== 'completed' && t.status !== 'deleted').map((t) => String(t.id))
  )
  return all.filter((task) => {
    if (!task || (task.status !== 'pending' && task.status !== 'in_progress')) return false
    const blockers = (task.blockedBy || []).map(String).filter((id) => unresolved.has(id))
    return blockers.length === 0
  })
}

function transcriptLines(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return buf.toString('utf8').split('\n')
  } catch {
    return []
  }
}

/** Did this turn do real work? Walk back to the last human message, look for an edit or a build/test/lint run. */
function turnDidWork(lines) {
  let start = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"user"')) continue
    let o
    try {
      o = JSON.parse(lines[i])
    } catch {
      continue
    }
    const c = o?.message?.content
    const isToolEcho = Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')
    if (!isToolEcho) {
      start = i
      break
    }
  }
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].includes('"tool_use"')) continue
    let o
    try {
      o = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (o?.type !== 'assistant') continue
    for (const c of o?.message?.content || []) {
      if (!c || c.type !== 'tool_use') continue
      if (EDIT_TOOLS.has(c.name)) return true
      if (c.name === 'Bash' && WORK_CMD.test(String(c.input?.command || ''))) return true
    }
  }
  return false
}

/** The assistant's closing text this turn, or "". Only the tail matters. */
function closingText(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"assistant"')) continue
    let o
    try {
      o = JSON.parse(lines[i])
    } catch {
      continue
    }
    const text = (o?.message?.content || [])
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/** Unchecked `- [ ]` lines, in file order. `- [x]` (done) and `- [~]` (parked) are excluded. */
function backlogItems(file) {
  if (!file) return []
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s*\[([ x~])\]\s*(.+?)\s*$/))
    .filter(Boolean)
    .filter((m) => m[1] === ' ')
    .map((m) => m[2])
    .filter((s) => s.length > 0)
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason, suppressOutput: true }))
  process.exit(0)
}

function main() {
  const input = readStdin()
  if (input.stop_hook_active) process.exit(0)
  if (config.isDisabled()) process.exit(0)

  const cfg = config.loadConfig()
  const { tiers, name } = cfg
  const doors = cfg.one_way_doors.join('; ')
  const sessionId = input.session_id
  const lines = transcriptLines(input.transcript_path || '')
  const didWork = turnDidWork(lines)

  // Tier 0: the turn ends by offering to act.
  if (didWork && tiers.offer > 0) {
    const closing = closingText(lines)
    if (OFFER_TO_ACT.test(closing)) {
      const c = counter('offer', sessionId)
      if (c.count < tiers.offer) {
        c.bump()
        const tail = closing.slice(-200).replace(/\s+/g, ' ')
        block(
          `This turn ends by offering to do the next thing rather than doing it:\n\n` +
            `  "...${tail}"\n\n` +
            `You already know the answer. An offer with no plausible "no" is a stop wearing ` +
            `a question mark, and it costs ${name} a turn to say the yes you already predicted.\n\n` +
            `Do it now. Stop only if the next step is a one-way door (${doors}), and if so, ` +
            `say which one in a single line rather than asking. Report AFTER it is done and ` +
            `verified, in the same turn.\n` +
            `(Offer guard ${c.count + 1}/${tiers.offer} this session.)\n`
        )
      }
    }
  }

  // Tier 1: open tasks.
  if (tiers.tasks > 0) {
    const open = openTasks(sessionId)
    if (open.length > 0) {
      const c = counter('tasks', sessionId)
      if (c.count < tiers.tasks) {
        c.bump()
        const listed = open
          .slice(0, 6)
          .map((t) => `  #${t.id} [${t.status}] ${t.subject}`)
          .join('\n')
        const more = open.length > 6 ? `\n  ...and ${open.length - 6} more` : ''
        block(
          `You are about to end the turn with ${open.length} task(s) still open:\n\n` +
            `${listed}${more}\n\n` +
            `Ending the turn is the stop; there is no "continuing" after this message. ` +
            `If you intended to keep working, call a tool now instead of writing.\n\n` +
            `The only reasons to stop instead: a one-way door (${doors}), or a blocker you ` +
            `genuinely cannot resolve. Say which in one line. Otherwise pick the top task and do it.\n` +
            RECRUIT +
            `(Task guard ${c.count + 1}/${tiers.tasks} this session.)\n`
        )
      }
    }
  }

  if (!didWork) process.exit(0)

  // Tier 2: pull from the backlog.
  if (tiers.backlog > 0) {
    const items = backlogItems(cfg.backlog_file)
    if (items.length > 0) {
      const c = counter('backlog', sessionId)
      if (c.count < tiers.backlog) {
        c.bump()
        const pool = items.slice(0, BACKLOG_TOP_N)
        const pick = pool[Math.floor(Math.random() * pool.length)]
        const rest = items.slice(0, 5).filter((i) => i !== pick)
        block(
          `The turn's work is done and the backlog is not empty. Next item:\n\n` +
            `  ${pick}\n\n` +
            (rest.length ? `Also queued:\n${rest.map((i) => `  - ${i}`).join('\n')}\n\n` : '') +
            `Do this item now. When it is finished, tick it off in ${cfg.backlog_file} ` +
            `(change "- [ ]" to "- [x]") so it is not offered again.\n\n` +
            `Stop instead, saying which in one line, only if the item requires a one-way door ` +
            `(${doors}), or it is unrelated to what ${name} last asked for and would derail them.\n` +
            RECRUIT +
            `(Backlog pull ${c.count + 1}/${tiers.backlog} this session.)\n`
        )
      }
    }
  }

  // Tier 3: one self-review pass per session.
  if (tiers.self_review > 0) {
    const c = counter('selfreview', sessionId)
    if (c.count < 1) {
      c.bump()
      block(
        `This turn did work. Take one pass over your own changes before ending; ` +
          `not a general cleanup, only debt this turn created:\n\n` +
          `  1. Comments that restate the code, or explain a decision that belongs in the ` +
          `commit or PR description rather than the file. Cut them.\n` +
          `  2. Scaffolding left behind: dead branches, unused imports, a one-caller helper ` +
          `that should be inlined, a TODO you can just do.\n` +
          `  3. Anything you papered over and did not flag. Say so now.\n\n` +
          `If the diff is already clean, say "self-review: clean" in one line and stop. Do NOT ` +
          `invent changes to justify the pass: churn costs more than it saves against the ` +
          `repo's checks.\n` +
          `(Self-review fires once per session.)\n`
      )
    }
  }

  process.exit(0)
}

main()
