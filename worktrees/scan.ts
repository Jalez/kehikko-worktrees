import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { changeOf, changesOf, factsOf, forgeOf, linkedWorktrees, parseDu, processCwds, reposIn, run, type Forge, type Listed, type Runner } from './git.ts'
import { Machine, markProject } from './machine.ts'
import { decide, freedSaid, keptSaid, toldSaid, type Change, type Facts, type Removal, type Row, type State } from './rule.ts'

/**
 * The scan, the sizes, the removals and the automatic cleanup, for every project this module knows.
 *
 * - A scan reads git and the forges only: `git fetch` at most once per repository every
 *   `FETCH_EVERY_MS`, the forge's request list at most every `CHANGES_EVERY_MS`, `lsof` once. It runs
 *   by itself every `SCAN_EVERY_MS` while there are projects, and when the person presses Rescan.
 * - Sizes are heavy (`du`), so they are measured apart from the scan, in one batch, for worktrees
 *   never measured or measured longer than `SIZE_EVERY_MS` ago, never on a page's read: through
 *   Queue's CLI when it is on this computer (one queued task), else at the lowest priority.
 * - The automatic cleanup runs after each scan when it is on: each worktree the scan found
 *   reclaimable is read and decided again just before `git worktree remove`, then its local branch
 *   goes with `git branch -D` (its commits are in the merged target, which the rule checked). Never a
 *   main checkout, never `--force`, never a remote branch, never anything but `git worktree remove`.
 */

export const SCAN_EVERY_MS = 15 * 60_000
export const FETCH_EVERY_MS = 10 * 60_000
export const CHANGES_EVERY_MS = 5 * 60_000
export const SIZE_EVERY_MS = 6 * 60 * 60_000
/** Paths `du` is handed at once. */
export const SIZE_BATCH = 40

export interface ScanDeps {
  moduleId: string
  machine?: Machine
  git?: Runner
  now?: () => number
  /** Tell the agent sessions at a project's last known place (`messages.tell`). */
  tell?: (project: string, place: Place, text: string) => Promise<void>
  /** Queue's CLI, when it is on this computer; null to measure here. */
  queueCli?: () => string | null
  /** Whether to fetch before reading. The tests do not. */
  fetch?: boolean
  log?: (line: string) => void
}

/** Where a page last showed a project: what `messages.tell` names. */
export interface Place {
  epic?: string
  kehikko?: string
}

/** Queue's CLI, where Kehikot installs it, or null. */
export function findQueueCli(machine: Machine): string | null {
  const cli = join(dirname(machine.dir), 'installed', 'kehikot.queue', 'bin', 'kehikot-queue')
  return existsSync(cli) ? cli : null
}

interface Held {
  facts: Facts
  row: Row
}

export class Scanner {
  readonly #deps: ScanDeps
  readonly #machine: Machine
  readonly #git: Runner
  readonly #now: () => number
  #projects: string[]
  #places = new Map<string, Place>()
  #held = new Map<string, Held>()
  #fetched = new Map<string, number>()
  #changes = new Map<string, { at: number; byBranch: Map<string, Change[]>; note: string | null }>()
  #notes: string[] = []
  #at: number | null = null
  #scanning: Promise<void> | null = null
  #measuring: Promise<void> | null = null
  #removing: Promise<unknown> = Promise.resolve()
  #timer: ReturnType<typeof setTimeout> | null = null
  #listeners = new Set<() => void>()

  constructor(deps: ScanDeps) {
    this.#deps = deps
    this.#machine = deps.machine ?? new Machine()
    this.#git = deps.git ?? run
    this.#now = deps.now ?? Date.now
    this.#projects = this.#machine.projects()
  }

  /** Hear every change of the state (a scan, a size, a removal). */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #changed(): void {
    for (const listener of this.#listeners) listener()
  }

  #log(line: string): void {
    ;(this.#deps.log ?? ((one: string) => console.log(`worktrees: ${one}`)))(line)
  }

  state(): State {
    const sizes = this.#machine.sizes()
    const rows = [...this.#held.values()].map(({ row }) => ({ ...row, bytes: sizes[row.path]?.bytes ?? null, measuredAt: sizes[row.path]?.at ?? null }))
    rows.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1))
    return {
      at: this.#at,
      scanning: this.#scanning !== null,
      measuring: this.#measuring !== null,
      auto: this.#machine.auto(),
      projects: [...this.#projects],
      rows,
      notes: [...this.#notes],
      removed: this.#machine.removals(20),
    }
  }

  projects(): string[] {
    return [...this.#projects]
  }

  /** A project a page showed, or the host named: scanned from now on. `place` is where the page is. */
  know(project: string, place?: Place): void {
    if (typeof project !== 'string' || !project.startsWith('/')) return
    const path = resolve(project)
    if (place && (place.epic || place.kehikko)) this.#places.set(path, place)
    if (this.#projects.includes(path)) return
    this.#projects.push(path)
    this.#machine.setProjects(this.#projects)
    markProject(path, this.#now(), this.#deps.moduleId)
    void this.scan().catch(() => null)
  }

  /** Scan by itself every `SCAN_EVERY_MS`, the first at once. */
  start(): void {
    if (this.#timer) return
    const tick = () => {
      void this.scan()
        .catch(() => null)
        .finally(() => {
          this.#timer = setTimeout(tick, SCAN_EVERY_MS)
          this.#timer.unref?.()
        })
    }
    tick()
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  /** Start a scan, or join the one running. After it: stale sizes measured, and the automatic cleanup when on. */
  scan(options: { force?: boolean } = {}): Promise<void> {
    if (this.#scanning) return this.#scanning
    this.#scanning = this.#scanNow(Boolean(options.force))
      .then(async () => {
        if (this.#machine.auto()) await this.cleanMerged('auto')
        void this.measure({ force: Boolean(options.force) }).catch(() => null)
      })
      .finally(() => {
        this.#scanning = null
        this.#changed()
      })
    this.#changed()
    return this.#scanning
  }

  async #fetch(repo: string, force: boolean): Promise<void> {
    if (this.#deps.fetch === false) return
    const last = this.#fetched.get(repo) ?? 0
    if (!force && this.#now() - last < FETCH_EVERY_MS) return
    this.#fetched.set(repo, this.#now())
    const fetched = await this.#git(['git', '-C', repo, 'fetch', '--quiet', '--no-tags', '--prune', 'origin'], { timeoutMs: 90_000 })
    if (!fetched.ok) this.#notes.push(`${repo}: could not fetch, so what was fetched before is used (${fetched.why})`)
  }

  async #changesFor(repo: string, force: boolean): Promise<Map<string, Change[]>> {
    const cached = this.#changes.get(repo)
    if (!force && cached && this.#now() - cached.at < CHANGES_EVERY_MS) {
      if (cached.note) this.#notes.push(cached.note)
      return cached.byBranch
    }
    const remote = await this.#git(['git', '-C', repo, 'remote', 'get-url', 'origin'])
    const forge: Forge = remote.ok ? forgeOf(remote.out) : null
    const read = await changesOf(repo, forge, this.#git)
    this.#changes.set(repo, { at: this.#now(), ...read })
    if (read.note) this.#notes.push(read.note)
    return read.byBranch
  }

  /** Read one repository's worktrees: their facts, or null for one git cannot read. */
  async #read(repo: string, project: string, force: boolean, cwds: Awaited<ReturnType<typeof processCwds>>, only?: string): Promise<Facts[]> {
    const listed = await linkedWorktrees(repo, this.#git)
    if (!listed) return []
    const roots = new Set(this.#projects)
    const linked = listed.linked.filter((one: Listed) => !roots.has(resolve(one.path)) && existsSync(one.path) && (only === undefined || one.path === only))
    if (!linked.length) return []
    await this.#fetch(repo, force)
    const byBranch = await this.#changesFor(repo, force)
    const out: Facts[] = []
    for (const entry of linked) {
      const facts = await factsOf(entry, { repo, project }, entry.branch ? changeOf(byBranch.get(entry.branch)) : null, cwds, this.#git)
      if (facts) out.push(facts)
    }
    return out
  }

  async #scanNow(force: boolean): Promise<void> {
    this.#notes = []
    const cwds = await processCwds(this.#git)
    const held = new Map<string, Held>()
    const seen = new Set<string>()
    for (const project of this.#projects) {
      if (!existsSync(project)) continue
      for (const repo of reposIn(project)) {
        if (seen.has(repo)) continue
        seen.add(repo)
        for (const facts of await this.#read(repo, project, force, cwds)) held.set(facts.path, { facts, row: rowOf(facts) })
      }
    }
    this.#held = held
    this.#at = this.#now()
    this.#notes = [...new Set(this.#notes)].slice(0, 20)
  }

  /** Measure the sizes that are missing or older than `SIZE_EVERY_MS` (all of them with `force`), in batches. */
  measure(options: { force?: boolean } = {}): Promise<void> {
    if (this.#measuring) return this.#measuring
    const sizes = this.#machine.sizes()
    const now = this.#now()
    const stale = [...this.#held.keys()].filter((path) => options.force || !sizes[path] || now - sizes[path]!.at > SIZE_EVERY_MS)
    if (!stale.length) return Promise.resolve()
    this.#measuring = (async () => {
      for (let at = 0; at < stale.length; at += SIZE_BATCH) {
        const batch = stale.slice(at, at + SIZE_BATCH)
        const measured = await this.#du(batch)
        const next = this.#machine.sizes()
        for (const [path, bytes] of measured) next[path] = { bytes, at: this.#now() }
        /* Sizes of worktrees that are gone are forgotten. */
        for (const path of Object.keys(next)) if (!existsSync(path)) delete next[path]
        this.#machine.setSizes(next)
        this.#changed()
      }
    })().finally(() => {
      this.#measuring = null
      this.#changed()
    })
    this.#changed()
    return this.#measuring
  }

  async #du(paths: readonly string[]): Promise<Map<string, number>> {
    const cli = this.#deps.queueCli ? this.#deps.queueCli() : findQueueCli(this.#machine)
    const du = ['nice', '-n', '19', 'du', '-sk', ...paths]
    if (cli) {
      const queued = await this.#git([cli, 'run', '--kind', 'task', '--label', `Worktrees: sizes of ${paths.length} worktrees`, '--from', dirname(paths[0]!), '--', ...du], { cwd: dirname(paths[0]!), timeoutMs: 30 * 60_000 })
      const sizes = parseDu(queued.out)
      if (sizes.size) return sizes
    }
    return parseDu((await this.#git(du, { timeoutMs: 20 * 60_000 })).out)
  }

  /** Paths the last scan found reclaimable. */
  reclaimable(): string[] {
    return [...this.#held.values()].filter(({ row }) => row.group === 'reclaimable').map(({ row }) => row.path)
  }

  /**
   * Remove one worktree. `by: 'auto'` or a "Clean up merged" press removes only what is reclaimable
   * when read again now; a person's Remove on one row removes any worktree the scan listed that git
   * agrees to remove (`git worktree remove` refuses changes and untracked files by itself), and no
   * worktree a process works in. A main checkout is never removed.
   */
  remove(path: string, by: 'auto' | 'person', strict = by === 'auto'): Promise<{ ok: true; removal: Removal } | { ok: false; why: string }> {
    const next = this.#removing.then(() => this.#removeNow(path, by, strict))
    this.#removing = next.catch(() => null)
    return next
  }

  async #removeNow(path: string, by: 'auto' | 'person', strict: boolean): Promise<{ ok: true; removal: Removal } | { ok: false; why: string }> {
    const held = this.#held.get(path)
    if (!held) return { ok: false, why: 'That is not a worktree the last scan found.' }
    const { repo, project } = held.facts
    if (this.#projects.includes(resolve(path)) || resolve(path) === resolve(repo)) return { ok: false, why: 'That is a main checkout, which is never removed.' }
    /* Read again: what was true at the scan may not be now. */
    const cwds = await processCwds(this.#git)
    await this.#fetch(repo, true)
    const facts = (await this.#read(repo, project, true, cwds, path))[0]
    if (!facts) return { ok: false, why: 'It is no longer a worktree git can read.' }
    const decision = decide(facts)
    if (strict && decision.group !== 'reclaimable') {
      this.#held.set(path, { facts, row: rowOf(facts) })
      return { ok: false, why: decision.group === 'kept' ? `kept: ${keptSaid(decision.kept)}` : 'its request is not merged' }
    }
    if (facts.busy) return { ok: false, why: `kept: ${facts.busy.agent ? `an agent session (${facts.busy.command})` : facts.busy.command} works in it` }
    const gone = await this.#git(['git', '-C', repo, 'worktree', 'remove', path], { timeoutMs: 10 * 60_000 })
    if (!gone.ok) return { ok: false, why: `git did not remove it: ${gone.why}` }
    let branchDeleted = false
    if (decision.group === 'reclaimable' && facts.branch) branchDeleted = (await this.#git(['git', '-C', repo, 'branch', '-D', facts.branch])).ok
    const sizes = this.#machine.sizes()
    const removal: Removal = { at: this.#now(), path, repo, branch: facts.branch, bytes: sizes[path]?.bytes ?? null, by, branchDeleted, change: facts.change }
    this.#machine.logRemoval(removal)
    delete sizes[path]
    this.#machine.setSizes(sizes)
    this.#held.delete(path)
    this.#log(`removed ${path}${branchDeleted ? ` and its branch ${facts.branch}` : ''} (${by === 'auto' ? 'automatic cleanup' : 'a person pressed Remove'})`)
    const place = this.#places.get(project)
    if (place && this.#deps.tell) await this.#deps.tell(project, place, toldSaid(removal)).catch(() => null)
    this.#changed()
    return { ok: true, removal }
  }

  /** Remove every reclaimable worktree, each decided again. */
  async cleanMerged(by: 'auto' | 'person'): Promise<{ removed: Removal[]; kept: Array<{ path: string; why: string }>; said: string }> {
    const removed: Removal[] = []
    const kept: Array<{ path: string; why: string }> = []
    for (const path of this.reclaimable()) {
      const done = await this.remove(path, by, true)
      if (done.ok) removed.push(done.removal)
      else kept.push({ path, why: done.why })
    }
    const repos = new Set(removed.map((one) => one.repo))
    for (const repo of repos) await this.#git(['git', '-C', repo, 'worktree', 'prune'])
    if (removed.length) this.#log(freedSaid(removed))
    return { removed, kept, said: freedSaid(removed) }
  }

  /** `git worktree prune` in every repository: forgets worktrees whose folders are gone. Deletes no folder. */
  async prune(): Promise<{ repos: number }> {
    const repos = new Set<string>()
    for (const project of this.#projects) for (const repo of reposIn(project)) repos.add(repo)
    for (const repo of repos) await this.#git(['git', '-C', repo, 'worktree', 'prune'])
    this.#log(`pruned ${repos.size} repositories`)
    return { repos: repos.size }
  }

  /** Whether a path is a worktree the last scan found (for Open in Finder). */
  listed(path: string): boolean {
    return this.#held.has(path)
  }

  setAuto(on: boolean): void {
    this.#machine.setAuto(on)
    this.#changed()
    if (on) void this.cleanMerged('auto').catch(() => null)
  }
}

export function rowOf(facts: Facts): Row {
  const decision = decide(facts)
  return {
    path: facts.path,
    repo: facts.repo,
    project: facts.project,
    branch: facts.branch,
    changedAt: facts.changedAt,
    bytes: null,
    measuredAt: null,
    change: facts.change,
    dirty: facts.dirty,
    untracked: facts.untracked,
    unpushed: facts.unpushed,
    busy: facts.busy,
    group: decision.group,
    kept: decision.group === 'kept' ? keptSaid(decision.kept) : null,
  }
}


