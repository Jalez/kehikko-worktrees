import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { run, type Runner } from '../worktrees/git.ts'
import { Machine } from '../worktrees/machine.ts'
import { Scanner } from '../worktrees/scan.ts'

/**
 * The scan and the cleanup against real repositories in a scratch folder: an origin, a project's
 * main checkout, and worktrees in every state. `gh` and `lsof` are answered by the test; git is real.
 */

let scratch = ''
let project = ''
let origin = ''
let prs: Array<{ number: number; state: string; headRefName: string; baseRefName: string }> = []
let cwds: Array<{ pid: number; command: string; cwd: string }> = []

const sh = (cwd: string, ...args: string[]) => {
  const done = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  if (done.status !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr}`)
  return done.stdout.trim()
}

const runner: Runner = async (argv, options) => {
  if (argv[0] === 'git' && argv.includes('get-url')) return { ok: true, out: 'git@github.com:x/y.git', why: '' }
  if (argv[0] === 'gh') return { ok: true, out: JSON.stringify(prs), why: '' }
  if (argv[0] === 'lsof') return { ok: true, out: cwds.map((one) => `p${one.pid}\nc${one.command}\nn${one.cwd}`).join('\n'), why: '' }
  return run(argv, options)
}

function worktree(branch: string, merge: boolean): string {
  const path = join(scratch, 'app-worktrees', branch)
  sh(project, 'worktree', 'add', '-q', path, '-b', branch, 'origin/main')
  writeFileSync(join(path, `${branch}.txt`), branch)
  sh(path, 'add', '.')
  sh(path, 'commit', '-qm', branch)
  sh(path, 'push', '-q', 'origin', branch)
  if (merge) {
    sh(project, 'fetch', '-q', 'origin')
    sh(project, 'checkout', '-q', 'main')
    sh(project, 'merge', '-q', '--no-ff', '-m', `merge ${branch}`, `origin/${branch}`)
    sh(project, 'push', '-q', 'origin', 'main')
    sh(project, 'fetch', '-q', 'origin')
  }
  return path
}

let scanner: Scanner
let machine: Machine

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worktrees-')))
  origin = join(scratch, 'origin.git')
  project = join(scratch, 'app')
  sh(scratch, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(scratch, 'clone', '-q', origin, project)
  sh(project, 'checkout', '-q', '-b', 'main')
  writeFileSync(join(project, 'README'), 'hi')
  writeFileSync(join(project, '.gitignore'), 'node_modules\n')
  sh(project, 'add', '.')
  sh(project, 'commit', '-qm', 'first')
  sh(project, 'push', '-q', '-u', 'origin', 'main')
  sh(project, 'remote', 'set-url', 'origin', origin)
  prs = []
  cwds = []
  machine = new Machine(join(scratch, 'machine'))
  scanner = new Scanner({ moduleId: 'kehikot.worktrees', machine, git: runner, fetch: false, queueCli: () => null, log: () => {} })
})

afterEach(() => {
  scanner.stop()
  rmSync(scratch, { recursive: true, force: true })
})


describe('the scan', () => {
  test('lists linked worktrees only, with their groups, and never the main checkout', async () => {
    const merged = worktree('done', true)
    const open = worktree('open', false)
    prs = [
      { number: 1, state: 'MERGED', headRefName: 'done', baseRefName: 'main' },
      { number: 2, state: 'OPEN', headRefName: 'open', baseRefName: 'main' },
    ]
    machine.setAuto(false)
    scanner.know(project)
    await scanner.scan()
    const state = scanner.state()
    expect(state.rows.map((row) => row.path).sort()).toEqual([merged, open].sort())
    expect(state.rows.find((row) => row.path === merged)?.group).toBe('reclaimable')
    expect(state.rows.find((row) => row.path === open)?.group).toBe('active')
    expect(existsSync(join(project, '.kehikot', 'worktrees', 'seen.json'))).toBe(true)
  })

  test('the automatic cleanup removes a merged worktree and its branch, keeps the rest with reasons', async () => {
    const clean = worktree('clean', true)
    const dirty = worktree('dirty', true)
    const busy = worktree('busy', true)
    const ignored = worktree('ignored', true)
    writeFileSync(join(dirty, 'README'), 'changed')
    mkdirSync(join(ignored, 'node_modules'))
    writeFileSync(join(ignored, 'node_modules', 'x.js'), '1')
    cwds = [{ pid: 42, command: 'claude', cwd: join(busy, 'src') }]
    prs = ['clean', 'dirty', 'busy', 'ignored'].map((b, i) => ({ number: i + 1, state: 'MERGED', headRefName: b, baseRefName: 'main' }))
    scanner.know(project)
    await scanner.scan()
    expect(existsSync(clean)).toBe(false)
    expect(existsSync(ignored)).toBe(false)
    expect(existsSync(dirty)).toBe(true)
    expect(existsSync(busy)).toBe(true)
    expect(sh(project, 'branch', '--list', 'clean')).toBe('')
    const state = scanner.state()
    expect(state.rows.find((row) => row.path === dirty)?.kept).toBe('1 file has uncommitted changes')
    expect(state.rows.find((row) => row.path === busy)?.kept).toBe('an agent session (claude) works in it')
    expect(state.removed.map((one) => one.path).sort()).toEqual([clean, ignored].sort())
    expect(readFileSync(join(machine.dir, 'removed.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(existsSync(project)).toBe(true)
  })

  test('not contained in the merged target, or unpushed, is kept', async () => {
    const after = worktree('after', true)
    writeFileSync(join(after, 'more.txt'), 'more')
    sh(after, 'add', '.')
    sh(after, 'commit', '-qm', 'more')
    prs = [{ number: 1, state: 'MERGED', headRefName: 'after', baseRefName: 'main' }]
    scanner.know(project)
    await scanner.scan()
    expect(existsSync(after)).toBe(true)
    expect(scanner.state().rows[0]?.kept).toBe('its last commit is not in main')
  })

  test('off, nothing is removed by itself; Clean up merged removes on a press', async () => {
    const clean = worktree('clean', true)
    prs = [{ number: 1, state: 'MERGED', headRefName: 'clean', baseRefName: 'main' }]
    machine.setAuto(false)
    scanner.know(project)
    await scanner.scan()
    expect(existsSync(clean)).toBe(true)
    const done = await scanner.cleanMerged('person')
    expect(done.removed).toHaveLength(1)
    expect(existsSync(clean)).toBe(false)
  })

  test('a person’s Remove goes through git, which refuses changes; a main checkout is never removed', async () => {
    const open = worktree('open', false)
    machine.setAuto(false)
    scanner.know(project)
    await scanner.scan()
    writeFileSync(join(open, 'README'), 'changed')
    const refused = await scanner.remove(open, 'person')
    expect(refused.ok).toBe(false)
    expect(existsSync(open)).toBe(true)
    expect((await scanner.remove(project, 'person')).ok).toBe(false)
    sh(open, 'checkout', '-q', '--', 'README')
    const done = await scanner.remove(open, 'person')
    expect(done.ok).toBe(true)
    /* Not merged: the branch stays. */
    expect(sh(project, 'branch', '--list', 'open')).toContain('open')
  })

  test('prune forgets a worktree whose folder is gone', async () => {
    const gone = worktree('gone', false)
    rmSync(gone, { recursive: true, force: true })
    scanner.know(project)
    await scanner.prune()
    expect(sh(project, 'worktree', 'list')).not.toContain('gone')
  })

  test('sizes are measured after the scan and cached', async () => {
    const open = worktree('open', false)
    machine.setAuto(false)
    scanner.know(project)
    await scanner.scan()
    await scanner.measure()
    expect(machine.sizes()[open]?.bytes).toBeGreaterThan(0)
    expect(scanner.state().rows[0]?.bytes).toBeGreaterThan(0)
  })
})
