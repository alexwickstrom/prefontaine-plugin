/**
 * prefontaine config: one file, read on every hook run, with defaults when absent.
 *
 * Precedence (highest first):
 *   1. PREFONTAINE_DISABLE=1 env var, or the ~/.claude/prefontaine/disabled file
 *   2. Plugin options set through `claude plugin configure` or /config
 *      (exported to hooks as CLAUDE_PLUGIN_OPTION_<KEY>; the value "from_config" or an
 *      empty string means "not set here, use config.json")
 *   3. ~/.claude/prefontaine/config.json
 *   4. Built-in defaults below
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const AUTONOMY = ['cautious', 'balanced', 'full_send']
const WHEN_IDLE = ['stop', 'backlog', 'self_review']

const DEFAULT_ONE_WAY_DOORS = [
  'a git push to a shared branch, or a merge',
  'any external send: chat, email, ticketing, docs, any API that publishes',
  'deleting data you have not read',
  'spending money',
  'changing a credential or permission',
]

// Block budgets per session, per tier. 0 turns a tier off.
// self_review is capped at 1: it is the only self-triggering tier.
const TIER_PRESETS = {
  cautious: { offer: 2, tasks: 4, backlog: 0, self_review: 1 },
  balanced: { offer: 4, tasks: 12, backlog: 6, self_review: 1 },
  full_send: { offer: 8, tasks: 24, backlog: 12, self_review: 1 },
}

const PROFILES = {
  cautious: 'Crisp Sauvignon Blanc',
  balanced: 'Pinot Noir',
  full_send: 'Bold Cabernet',
}

const DEFAULTS = {
  name: 'the user',
  autonomy: 'balanced',
  one_way_doors: DEFAULT_ONE_WAY_DOORS,
  when_idle: 'self_review',
  backlog_file: null,
  notes_dir: 'repo',
  tiers: {},
}

function homeDir() {
  return path.join(os.homedir(), '.claude', 'prefontaine')
}

function configPath() {
  return path.join(homeDir(), 'config.json')
}

function isDisabled(env = process.env) {
  if (String(env.PREFONTAINE_DISABLE || '') === '1') return true
  try {
    return fs.existsSync(path.join(homeDir(), 'disabled'))
  } catch {
    return false
  }
}

function readFileConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {} // absent or unparseable -> defaults
  }
}

function pluginOption(env, key) {
  const v = env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`]
  if (v === undefined) return undefined
  const s = String(v).trim()
  return s === '' || s === 'from_config' ? undefined : s
}

function expandHome(p) {
  if (typeof p !== 'string' || !p) return p
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p
}

function nonNegInt(v, fallback) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

/** The effective config after applying every layer. Never throws. */
function loadConfig(env = process.env) {
  return resolve(readFileConfig(), env)
}

/** Apply plugin options, validation, and tier derivation to a raw config object. */
function resolve(raw, env = {}) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }

  for (const key of ['name', 'autonomy', 'when_idle', 'backlog_file', 'notes_dir']) {
    const v = pluginOption(env, key)
    if (v !== undefined) cfg[key] = v
  }

  if (!AUTONOMY.includes(cfg.autonomy)) cfg.autonomy = DEFAULTS.autonomy
  if (!WHEN_IDLE.includes(cfg.when_idle)) cfg.when_idle = DEFAULTS.when_idle
  if (typeof cfg.name !== 'string' || !cfg.name.trim()) cfg.name = DEFAULTS.name
  if (!Array.isArray(cfg.one_way_doors) || cfg.one_way_doors.length === 0) {
    cfg.one_way_doors = DEFAULT_ONE_WAY_DOORS
  }
  cfg.one_way_doors = cfg.one_way_doors.filter((d) => typeof d === 'string' && d.trim())
  if (cfg.one_way_doors.length === 0) cfg.one_way_doors = DEFAULT_ONE_WAY_DOORS
  // Pushes and merges are always a one-way door, whatever the user deselected.
  if (!cfg.one_way_doors.some((d) => /push/i.test(d) && /merge/i.test(d))) {
    cfg.one_way_doors = [DEFAULT_ONE_WAY_DOORS[0], ...cfg.one_way_doors]
  }
  cfg.backlog_file = typeof cfg.backlog_file === 'string' && cfg.backlog_file ? expandHome(cfg.backlog_file) : null
  if (typeof cfg.notes_dir !== 'string' || !cfg.notes_dir) cfg.notes_dir = DEFAULTS.notes_dir

  const preset = TIER_PRESETS[cfg.autonomy]
  const overrides = cfg.tiers && typeof cfg.tiers === 'object' ? cfg.tiers : {}
  const tiers = {}
  for (const t of Object.keys(preset)) tiers[t] = nonNegInt(overrides[t], preset[t])
  tiers.self_review = Math.min(tiers.self_review, 1)
  // when_idle decides what a finished working turn does.
  if (cfg.when_idle === 'stop') {
    tiers.backlog = 0
    tiers.self_review = 0
  } else if (cfg.when_idle === 'self_review') {
    tiers.backlog = 0
  }
  if (!cfg.backlog_file) tiers.backlog = 0
  cfg.tiers = tiers
  cfg.profile = PROFILES[cfg.autonomy]
  return cfg
}

module.exports = {
  AUTONOMY,
  WHEN_IDLE,
  DEFAULTS,
  DEFAULT_ONE_WAY_DOORS,
  TIER_PRESETS,
  PROFILES,
  homeDir,
  configPath,
  isDisabled,
  loadConfig,
  resolve,
}

// `node lib/config.js` prints the effective config (used by the skills and the setup TUI).
if (require.main === module) {
  process.stdout.write(JSON.stringify(loadConfig(), null, 2) + '\n')
}
