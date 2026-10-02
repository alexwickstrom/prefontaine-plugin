#!/usr/bin/env node
/**
 * Validate a questionnaire answer set, write ~/.claude/prefontaine/config.json, print the profile card.
 *
 *   echo '{"name":"Sam","autonomy":"balanced",...}' | node lib/profile.js write [--dry-run]
 *   node lib/profile.js card        # card for the current effective config
 */

const fs = require('fs')
const path = require('path')
const config = require('./config.js')

const SUMMARY = {
  cautious: 'Takes the obvious default inside the task; asks before widening scope.',
  balanced: 'Picks a lane, writes down why, stops only where you said.',
  full_send: 'Takes the default and the adjacent work it finds; reports after.',
}

const IDLE_LABEL = {
  stop: 'Stops and reports',
  backlog: 'Starts the next backlog item',
  self_review: 'Reviews its own diff once, then stops',
}

function normalize(answers) {
  const a = answers && typeof answers === 'object' ? answers : {}
  const out = {
    name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : config.DEFAULTS.name,
    autonomy: config.AUTONOMY.includes(a.autonomy) ? a.autonomy : config.DEFAULTS.autonomy,
    one_way_doors:
      Array.isArray(a.one_way_doors) && a.one_way_doors.some((d) => typeof d === 'string' && d.trim())
        ? a.one_way_doors.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
        : config.DEFAULT_ONE_WAY_DOORS,
    when_idle: config.WHEN_IDLE.includes(a.when_idle) ? a.when_idle : config.DEFAULTS.when_idle,
    backlog_file: typeof a.backlog_file === 'string' && a.backlog_file.trim() ? a.backlog_file.trim() : null,
    notes_dir: typeof a.notes_dir === 'string' && a.notes_dir.trim() ? a.notes_dir.trim() : 'repo',
  }
  if (out.when_idle === 'backlog' && !out.backlog_file) out.backlog_file = '~/.claude/prefontaine/backlog.md'
  if (a.tiers && typeof a.tiers === 'object') out.tiers = a.tiers
  return out
}

function notesLabel(n) {
  if (n === 'repo') return '.prefontaine/forks.md in the repo (git-excluded)'
  if (n === 'home') return '~/.claude/prefontaine/<project>/forks.md'
  return `${n}/<project>/forks.md`
}

function card(cfg) {
  const profile = config.PROFILES[cfg.autonomy]
  const t = cfg.tiers || {}
  const on = (k) => (t[k] > 0 ? `on (${t[k]})` : 'off')
  return [
    `PREFONTAINE PROFILE: ${profile.toUpperCase()}`,
    `"${SUMMARY[cfg.autonomy]}"`,
    '',
    `Name:            ${cfg.name}`,
    `Autonomy:        ${cfg.autonomy}`,
    `Done early:      ${IDLE_LABEL[cfg.when_idle]}`,
    `Backlog:         ${cfg.backlog_file || 'off'}`,
    `Decision log:    ${notesLabel(cfg.notes_dir)}`,
    `Waits for your OK on:`,
    ...cfg.one_way_doors.map((d) => `  - ${d}`),
    `Stop hook tiers: offer ${on('offer')}, tasks ${on('tasks')}, backlog ${on('backlog')}, self-review ${on('self_review')}`,
  ].join('\n')
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'card') {
    process.stdout.write(card(config.loadConfig()) + '\n')
    return
  }
  if (cmd !== 'write') {
    process.stderr.write('usage: profile.js write [--dry-run] < answers.json | profile.js card\n')
    process.exit(2)
  }
  let answers = {}
  try {
    answers = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch (e) {
    process.stderr.write(`could not parse answers JSON: ${e.message}\n`)
    process.exit(2)
  }
  const saved = normalize(answers)
  if (!rest.includes('--dry-run')) {
    const file = config.configPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(saved, null, 2) + '\n')
    fs.renameSync(tmp, file) // atomic: the hook never reads a half-written config
  }
  process.stdout.write(card(config.resolve(saved, {})) + '\n')
}

module.exports = { normalize, card }
if (require.main === module) main()
