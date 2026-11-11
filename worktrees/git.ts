import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { personEnv } from 'kehikot-module-protocol/serve'

import { isAgent, type Busy, type Change, type Facts } from './rule.ts'

/**
 * Reading git, the forges and the processes. Everything here runs a program as an argv (never a
 * shell line), with a time limit, at a low priority for anything heavy; nothing here changes a
 * repository. Removing is in `scan.ts`.
 */

export interface Ran {
  ok: boolean
  out: string
  /** What went wrong, in a line, when not ok. */
  why: string
}

export type Runner = (argv: readonly string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<Ran>

/** Run a program, its output, and whether it exited 0. Never throws. Under Node and Bun alike. */
export const run: Runner = (argv, options = {}) =>
  new Promise((done) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(argv[0]!, argv.slice(1), {
        cwd: options.cwd,
        env: { ...personEnv(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', NO_COLOR: '1', GH_PROMPT_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      done({ ok: false, out: '', why: error instanceof Error ? error.message : String(error) })
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 30_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 8_000_000) out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 20_000) err += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      done({ ok: false, out: '', why: error.message })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const why = signal ? `stopped (${signal}) after taking too long` : (err.trim().split('\n').at(-1) ?? `exit ${code}`)
      done({ ok: code === 0, out: out.replace(/\n$/, ''), why: code === 0 ? '' : why.slice(0, 300) })
    })
  })

/* ------------------------------------------------------------------ *
 * Repositories and their worktrees
 * ------------------------------------------------------------------ */

const isMainCheckout = (dir: string): boolean => {
  try {
    return statSync(join(dir, '.git')).isDirectory()
  } catch {
    return false
  }
}

/** The repositories' main checkouts in a project folder: the folder itself, and the folders directly in it. */
export function reposIn(project: string): string[] {
  const out: string[] = []
  if (isMainCheckout(project)) out.push(project)
  try {
    for (const entry of readdirSync(project, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const dir = join(project, entry.name)
      if (isMainCheckout(dir)) out.push(dir)
      if (out.length >= 100) break
    }
  } catch {
    /* unreadable: what was found */
  }
  return out
}

/** One entry of `git worktree list --porcelain`. */
export interface Listed {
  path: string
  head: string
  branch: string | null
  locked: boolean
  prunable: boolean
  bare: boolean
}

export function parseWorktrees(out: string): Listed[] {
  const listed: Listed[] = []
  for (const block of out.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) continue
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length) ?? null
    listed.push({
      path,
      head: lines.find((l) => l.startsWith('HEAD '))?.slice('HEAD '.length) ?? '',
      branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
      bare: lines.includes('bare'),
    })
  }
  return listed
}

/** The linked worktrees of a repository: the list less its first entry (the main checkout), less bare and prunable ones. */
export async function linkedWorktrees(repo: string, git: Runner = run): Promise<{ linked: Listed[]; prunable: number } | null> {
  const listed = await git(['git', '-C', repo, 'worktree', 'list', '--porcelain'])
  if (!listed.ok) return null
  const all = parseWorktrees(listed.out).slice(1)
  return { linked: all.filter((one) => !one.bare && !one.prunable), prunable: all.filter((one) => one.prunable).length }
}

/** The default branch: `origin/HEAD`'s, else `main` or `master`. */
export async function defaultBranch(repo: string, git: Runner = run): Promise<string> {
  const head = await git(['git', '-C', repo, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (head.ok && head.out) return head.out.replace(/^refs\/remotes\/origin\//, '')
  const master = await git(['git', '-C', repo, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/master'])
  return master.ok ? 'master' : 'main'
}

/* ------------------------------------------------------------------ *
 * Forges: where each branch's request stands
 * ------------------------------------------------------------------ */

export type Forge = 'github' | 'gitlab' | null

export function forgeOf(remote: string): Forge {
  if (/github\.com[:/]/.test(remote)) return 'github'
  if (/gitlab/.test(remote)) return 'gitlab'
  return null
}

/** The requests of a repository by head branch, newest first per branch, from the person's own `gh` or `glab`. */
export async function changesOf(repo: string, forge: Forge, git: Runner = run): Promise<{ byBranch: Map<string, Change[]>; note: string | null }> {
  const byBranch = new Map<string, Change[]>()
  const add = (branch: string, change: Change) => {
    const list = byBranch.get(branch) ?? []
    list.push(change)
    byBranch.set(branch, list)
  }
  if (forge === 'github') {
    const got = await git(['gh', 'pr', 'list', '--state', 'all', '--limit', '300', '--json', 'number,state,headRefName,baseRefName,url'], { cwd: repo, timeoutMs: 30_000 })
    if (!got.ok) return { byBranch, note: `GitHub could not be read for ${repo} with gh: ${got.why}` }
    try {
      for (const one of JSON.parse(got.out) as Array<{ number: number; state: string; headRefName: string; baseRefName: string; url?: string }>) {
        const state = one.state === 'MERGED' ? 'merged' : one.state === 'CLOSED' ? 'closed' : 'open'
        add(one.headRefName, { sign: '#', number: one.number, state, base: one.baseRefName, ...(one.url?.startsWith('https://') ? { url: one.url } : {}) })
      }
    } catch {
      return { byBranch, note: `gh said something unreadable for ${repo}.` }
    }
    return { byBranch, note: null }
  }
  if (forge === 'gitlab') {
    const got = await git(['glab', 'mr', 'list', '--all', '--per-page', '100', '--output', 'json'], { cwd: repo, timeoutMs: 30_000 })
    if (!got.ok) return { byBranch, note: `GitLab could not be read for ${repo} with glab: ${got.why}` }
    try {
      for (const one of JSON.parse(got.out) as Array<{ iid: number; state: string; source_branch: string; target_branch: string; web_url?: string }>) {
        const state = one.state === 'merged' ? 'merged' : one.state === 'opened' ? 'open' : 'closed'
        add(one.source_branch, { sign: '!', number: one.iid, state, base: one.target_branch, ...(one.web_url?.startsWith('https://') ? { url: one.web_url } : {}) })
      }
    } catch {
      return { byBranch, note: `glab said something unreadable for ${repo}.` }
    }
    return { byBranch, note: null }
  }
  return { byBranch, note: null }
}

/** The request that says most about a branch: an open one, else a merged one, else the newest closed one. */
export function changeOf(changes: readonly Change[] | undefined): Change | null {
  if (!changes?.length) return null
  const by = (state: Change['state']) => changes.filter((c) => c.state === state).sort((a, b) => b.number - a.number)[0]
  return by('open') ?? by('merged') ?? by('closed') ?? null
}

/* ------------------------------------------------------------------ *
 * Processes
 * ------------------------------------------------------------------ */

/** Every running process's working directory and program name: `lsof` once. Empty when it cannot be read. */
export async function processCwds(git: Runner = run): Promise<Array<{ pid: number; command: string; cwd: string }>> {
  const got = await git(['lsof', '-nP', '-d', 'cwd', '-Fpcn'], { timeoutMs: 15_000 })
  const out: Array<{ pid: number; command: string; cwd: string }> = []
  let pid: number | null = null
  let command = ''
  for (const line of got.out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1)) || null
      command = ''
    } else if (line.startsWith('c')) command = line.slice(1)
    else if (line.startsWith('n') && pid !== null) out.push({ pid, command, cwd: line.slice(1) })
  }
  return out
}

/** The process working inside a folder, an agent CLI first. */
export function busyIn(path: string, cwds: ReadonlyArray<{ pid: number; command: string; cwd: string }>): Busy | null {
  const inside = cwds.filter((one) => one.cwd === path || one.cwd.startsWith(`${path}/`))
  const agent = inside.find((one) => isAgent(one.command))
  const first = agent ?? inside[0]
  return first ? { pid: first.pid, command: first.command || 'a program', agent: Boolean(agent) } : null
}

/* ------------------------------------------------------------------ *
 * One worktree
 * ------------------------------------------------------------------ */

const mtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** The worktree's own folder in the repository (`.git/worktrees/<name>`), from its `.git` file. */
function gitDirOf(path: string): string | null {
  try {
    const text = readFileSync(join(path, '.git'), 'utf8')
    const dir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
    if (!dir) return null
    return isAbsolute(dir) ? dir : resolve(path, dir)
  } catch {
    return null
  }
}

/** The newest entry's own time in a reflog, ms, or 0. */
export function newestReflogEntry(text: string): number {
  let newest = 0
  for (const line of text.split('\n')) {
    const at = /> (\d+) [+-]\d{4}(?:\t|$)/.exec(line)
    if (at) newest = Math.max(newest, Number(at[1]) * 1000)
  }
  return newest
}

/** Count git status's lines: tracked changes, and untracked paths (ignored ones are not reported). */
export function statusCounts(porcelain: string): { dirty: number; untracked: number } {
  let dirty = 0
  let untracked = 0
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue
    if (line.startsWith('?? ')) untracked++
    else dirty++
  }
  return { dirty, untracked }
}

/** Everything the rule reads of one worktree. Null when git cannot read it. */
export async function factsOf(
  entry: Listed,
  where: { repo: string; project: string },
  change: Change | null,
  cwds: ReadonlyArray<{ pid: number; command: string; cwd: string }>,
  git: Runner = run,
): Promise<Facts | null> {
  const status = await git(['git', '-C', entry.path, 'status', '--porcelain=v1', '-unormal'], { timeoutMs: 60_000 })
  if (!status.ok) return null
  const { dirty, untracked } = statusCounts(status.out)
  const counted = await git(['git', '-C', entry.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes'])
  const unpushed = counted.ok ? Number(counted.out) || 0 : 1
  let contained = false
  if (change?.state === 'merged') {
    contained = (await git(['git', '-C', where.repo, 'merge-base', '--is-ancestor', entry.head, `refs/remotes/origin/${change.base}`])).ok
  }
  const committed = await git(['git', '-C', entry.path, 'log', '-1', '--format=%ct'])
  const gitDir = gitDirOf(entry.path)
  let reflog = ''
  try {
    if (gitDir) reflog = readFileSync(join(gitDir, 'logs', 'HEAD'), 'utf8')
  } catch {
    /* no reflog */
  }
  const changedAt = Math.max(committed.ok ? Number(committed.out) * 1000 || 0 : 0, newestReflogEntry(reflog), gitDir ? mtime(join(gitDir, 'index')) : 0)
  return {
    path: entry.path,
    repo: where.repo,
    project: where.project,
    branch: entry.branch,
    head: entry.head,
    locked: entry.locked,
    dirty,
    untracked,
    unpushed,
    changedAt,
    busy: busyIn(entry.path, cwds),
    change,
    contained,
  }
}

/* ------------------------------------------------------------------ *
 * Sizes
 * ------------------------------------------------------------------ */

/** `du -sk`'s lines as bytes by path. */
export function parseDu(out: string): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const line of out.split('\n')) {
    const m = /^(\d+)\t(\/.*)$/.exec(line)
    if (m) sizes.set(m[2]!, Number(m[1]) * 1024)
  }
  return sizes
}
