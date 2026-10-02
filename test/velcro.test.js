// Tests for the velcro Stop hook. No dependencies: `node --test test/`.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const HOOK = path.join(__dirname, '..', 'hooks', 'velcro.js')
const SETUP = path.join(__dirname, '..', 'bin', 'prefontaine-setup')

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'velcro-'))
  return home
}

function writeTranscript(home, entries) {
  const p = path.join(home, 'transcript.jsonl')
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

const human = (text) => ({ type: 'user', message: { content: text } })
const edit = () => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.js' } }] },
})
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

function writeConfig(home, cfg) {
  const dir = path.join(home, '.claude', 'prefontaine')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg))
}

function writeTask(home, sessionId, task) {
  const dir = path.join(home, '.claude', 'tasks', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${task.id}.json`), JSON.stringify(task))
}

function run(home, input, env = {}) {
  const cleanEnv = { ...process.env, HOME: home, ...env }
  delete cleanEnv.CLAUDE_PLUGIN_DATA
  for (const k of Object.keys(cleanEnv)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_')) delete cleanEnv[k]
  delete cleanEnv.PREFONTAINE_DISABLE
  Object.assign(cleanEnv, env)
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), env: cleanEnv, encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `hook must always exit 0, stderr: ${r.stderr}`)
  return r.stdout ? JSON.parse(r.stdout) : null
}

test('allows the stop when there is nothing to do', () => {
  const home = sandbox()
  const t = writeTranscript(home, [human('what is 2+2?'), say('4.')])
  assert.strictEqual(run(home, { session_id: 's1', transcript_path: t }), null)
})

test('allows the stop on empty or garbage input', () => {
  const home = sandbox()
  assert.strictEqual(run(home, {}), null)
  assert.strictEqual(run(home, { transcript_path: '/nonexistent', session_id: 'x' }), null)
})

test('a conversational turn may end in an offer', () => {
  const home = sandbox()
  const t = writeTranscript(home, [human('ideas?'), say('Here are three. Want me to start on the first?')])
  assert.strictEqual(run(home, { session_id: 's2', transcript_path: t }), null)
})

test('blocks a working turn that ends by offering to act', () => {
  const home = sandbox()
  const t = writeTranscript(home, [human('fix it'), edit(), say('Fixed. Want me to add a test too?')])
  const out = run(home, { session_id: 's3', transcript_path: t })
  assert.strictEqual(out.decision, 'block')
  assert.match(out.reason, /offering to do the next thing/)
  assert.match(out.reason, /Offer guard 1\/4/)
  assert.match(out.reason, /the user/)
})

test('offer tier budget: balanced allows 4 blocks then falls through', () => {
  const home = sandbox()
  writeConfig(home, { when_idle: 'stop' })
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Should I push it?')])
  for (let i = 1; i <= 4; i++) {
    const out = run(home, { session_id: 's4', transcript_path: t })
    assert.match(out.reason, new RegExp(`Offer guard ${i}/4`))
  }
  assert.strictEqual(run(home, { session_id: 's4', transcript_path: t }), null)
})

test('cautious autonomy lowers the offer budget to 2', () => {
  const home = sandbox()
  writeConfig(home, { autonomy: 'cautious', when_idle: 'stop' })
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Shall I continue?')])
  assert.match(run(home, { session_id: 's5', transcript_path: t }).reason, /1\/2/)
  assert.match(run(home, { session_id: 's5', transcript_path: t }).reason, /2\/2/)
  assert.strictEqual(run(home, { session_id: 's5', transcript_path: t }), null)
})

test('blocks on open tasks, ignores blocked and completed ones, and respects the budget', () => {
  const home = sandbox()
  writeConfig(home, { tiers: { tasks: 2 } })
  writeTask(home, 's6', { id: 1, status: 'pending', subject: 'write docs' })
  writeTask(home, 's6', { id: 2, status: 'pending', subject: 'waits on 1', blockedBy: [1] })
  writeTask(home, 's6', { id: 3, status: 'completed', subject: 'done' })
  const input = { session_id: 's6', transcript_path: '' }
  const out = run(home, input)
  assert.match(out.reason, /1 task\(s\) still open/)
  assert.match(out.reason, /#1 \[pending\] write docs/)
  assert.doesNotMatch(out.reason, /waits on 1/)
  assert.match(run(home, input).reason, /Task guard 2\/2/)
  assert.strictEqual(run(home, input), null)
})

test('self-review fires once per session on a working turn', () => {
  const home = sandbox()
  const t = writeTranscript(home, [human('refactor'), edit(), say('Refactored.')])
  const out = run(home, { session_id: 's7', transcript_path: t })
  assert.match(out.reason, /Self-review fires once per session/)
  assert.strictEqual(run(home, { session_id: 's7', transcript_path: t }), null)
})

test('self-review override above 1 is clamped to 1', () => {
  const home = sandbox()
  writeConfig(home, { tiers: { self_review: 5 } })
  const t = writeTranscript(home, [human('x'), edit(), say('Done.')])
  assert.ok(run(home, { session_id: 's8', transcript_path: t }))
  assert.strictEqual(run(home, { session_id: 's8', transcript_path: t }), null)
})

test('backlog tier pulls an unchecked item, skips done and parked ones', () => {
  const home = sandbox()
  const bl = path.join(home, 'backlog.md')
  fs.writeFileSync(bl, '# Backlog\n- [x] done thing\n- [~] parked thing\n- [ ] real thing\n')
  writeConfig(home, { when_idle: 'backlog', backlog_file: bl })
  const t = writeTranscript(home, [human('x'), edit(), say('Done.')])
  const out = run(home, { session_id: 's9', transcript_path: t })
  assert.match(out.reason, /Next item:\n\n {2}real thing/)
  assert.doesNotMatch(out.reason, /parked thing|done thing/)
})

test('backlog is off by default even if ~/.claude/backlog.md exists', () => {
  const home = sandbox()
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'backlog.md'), '- [ ] something\n')
  const t = writeTranscript(home, [human('x'), edit(), say('Done.')])
  const out = run(home, { session_id: 's10', transcript_path: t })
  assert.doesNotMatch(out.reason, /backlog/)
})

test('when_idle=stop turns off backlog and self-review', () => {
  const home = sandbox()
  writeConfig(home, { when_idle: 'stop' })
  const t = writeTranscript(home, [human('x'), edit(), say('Done.')])
  assert.strictEqual(run(home, { session_id: 's11', transcript_path: t }), null)
})

test('never blocks when stop_hook_active is set', () => {
  const home = sandbox()
  writeTask(home, 's12', { id: 1, status: 'pending', subject: 'open' })
  const t = writeTranscript(home, [human('x'), edit(), say('Want me to continue?')])
  assert.strictEqual(run(home, { session_id: 's12', transcript_path: t, stop_hook_active: true }), null)
})

test('disabled by file switch', () => {
  const home = sandbox()
  fs.mkdirSync(path.join(home, '.claude', 'prefontaine'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'prefontaine', 'disabled'), '')
  writeTask(home, 's13', { id: 1, status: 'pending', subject: 'open' })
  assert.strictEqual(run(home, { session_id: 's13', transcript_path: '' }), null)
})

test('disabled by PREFONTAINE_DISABLE=1', () => {
  const home = sandbox()
  writeTask(home, 's14', { id: 1, status: 'pending', subject: 'open' })
  assert.strictEqual(run(home, { session_id: 's14', transcript_path: '' }, { PREFONTAINE_DISABLE: '1' }), null)
})

test('config absent or corrupt falls back to balanced defaults', () => {
  const home = sandbox()
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Want me to ship it?')])
  assert.match(run(home, { session_id: 's15', transcript_path: t }).reason, /1\/4/)
  const home2 = sandbox()
  fs.mkdirSync(path.join(home2, '.claude', 'prefontaine'), { recursive: true })
  fs.writeFileSync(path.join(home2, '.claude', 'prefontaine', 'config.json'), '{not json')
  assert.match(run(home2, { session_id: 's15', transcript_path: t }).reason, /1\/4/)
})

test('configured name and one-way doors appear in the reason', () => {
  const home = sandbox()
  writeConfig(home, { name: 'Sam', one_way_doors: ['launching the rocket'] })
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Should I launch?')])
  const out = run(home, { session_id: 's16', transcript_path: t })
  assert.match(out.reason, /costs Sam a turn/)
  assert.match(out.reason, /launching the rocket/)
})

test('plugin option overrides config.json; from_config defers to it', () => {
  const home = sandbox()
  writeConfig(home, { autonomy: 'cautious', when_idle: 'stop' })
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Should I go on?')])
  const opt = { CLAUDE_PLUGIN_OPTION_AUTONOMY: 'full_send' }
  assert.match(run(home, { session_id: 's17', transcript_path: t }, opt).reason, /1\/8/)
  const home2 = sandbox()
  writeConfig(home2, { autonomy: 'cautious', when_idle: 'stop' })
  const fc = { CLAUDE_PLUGIN_OPTION_AUTONOMY: 'from_config' }
  assert.match(run(home2, { session_id: 's17', transcript_path: t }, fc).reason, /1\/2/)
})

test('counters live in CLAUDE_PLUGIN_DATA when set', () => {
  const home = sandbox()
  const data = path.join(home, 'plugin-data')
  const t = writeTranscript(home, [human('x'), edit(), say('Done.')])
  run(home, { session_id: 's18', transcript_path: t }, { CLAUDE_PLUGIN_DATA: data })
  assert.ok(fs.existsSync(path.join(data, 'selfreview-s18')))
})

test('setup --defaults --dry-run prints a card and writes nothing', () => {
  const home = sandbox()
  const r = spawnSync('bash', [SETUP, '--defaults', '--dry-run', '--no-gum'], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.match(r.stdout, /PREFONTAINE PROFILE: PINOT NOIR/)
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'prefontaine', 'config.json')))
})

// Regression tests for QA findings.

test('non-array blockedBy does not crash the hook (exit 0)', () => {
  const home = sandbox()
  writeTask(home, 'q1', { id: 1, status: 'pending', subject: 'odd task', blockedBy: 'oops' })
  writeTask(home, 'q1', { id: 2, status: 'pending', subject: 'odd task 2', blockedBy: { a: 1 } })
  const out = run(home, { session_id: 'q1', transcript_path: '' })
  assert.match(out.reason, /2 task\(s\) still open/)
})

test('unwritable state dir fails open: allows the stop instead of blocking forever', () => {
  const home = sandbox()
  const ro = path.join(home, 'readonly')
  fs.mkdirSync(ro)
  fs.chmodSync(ro, 0o500)
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Want me to ship it?')])
  const env = { CLAUDE_PLUGIN_DATA: path.join(ro, 'data') }
  try {
    assert.strictEqual(run(home, { session_id: 'q2', transcript_path: t }, env), null)
  } finally {
    fs.chmodSync(ro, 0o700)
  }
})

test('missing session_id keys budgets per transcript, and never blocks with neither', () => {
  const home = sandbox()
  writeConfig(home, { autonomy: 'cautious', when_idle: 'stop' })
  const t1 = writeTranscript(home, [human('go'), edit(), say('Done. Should I continue?')])
  assert.match(run(home, { transcript_path: t1 }).reason, /1\/2/)
  assert.match(run(home, { transcript_path: t1 }).reason, /2\/2/)
  assert.strictEqual(run(home, { transcript_path: t1 }), null)
  const t2 = path.join(home, 'other.jsonl')
  fs.copyFileSync(t1, t2)
  assert.match(run(home, { transcript_path: t2 }).reason, /1\/2/, 'a new transcript gets a fresh budget')
  assert.strictEqual(run(home, {}), null)
})

test('push/merge door is always present even if deselected', () => {
  const home = sandbox()
  writeConfig(home, { one_way_doors: ['spending money'] })
  const t = writeTranscript(home, [human('go'), edit(), say('Done. Should I deploy?')])
  const out = run(home, { session_id: 'q4', transcript_path: t })
  assert.match(out.reason, /a git push to a shared branch, or a merge/)
  assert.match(out.reason, /spending money/)
})

test('setup write is atomic and leaves no temp file', () => {
  const home = sandbox()
  const r = spawnSync('node', [path.join(__dirname, '..', 'lib', 'profile.js'), 'write'], {
    input: JSON.stringify({ name: 'Sam', autonomy: 'cautious' }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  assert.strictEqual(r.status, 0, r.stderr)
  const dir = path.join(home, '.claude', 'prefontaine')
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['config.json'])
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).name, 'Sam')
})
