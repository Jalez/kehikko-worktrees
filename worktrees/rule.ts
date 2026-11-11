/**
 * The rule and the words, shared by the server (which runs git) and the page. Pure: nothing here runs
 * a program or reads a disk.
 *
 * ## Which worktrees
 *
 * Every linked worktree of every repository in the projects this module knows: a project folder that
 * is a repository's main checkout, and each repository directly inside a project folder (a module
 * repository under it). `git worktree list --porcelain` less its first entry, the main checkout, which
 * is never listed and never touched.
 *
 * ## What may be removed, by itself or on "Clean up merged"
 *
 * A worktree is RECLAIMABLE only when all of these hold:
 *
 *  1. its branch's pull or merge request is merged;
 *  2. its HEAD is contained in the branch the request was merged into, as last fetched
 *     (`git merge-base --is-ancestor HEAD origin/<target>`);
 *  3. no tracked file has changes and nothing is untracked (ignored files do not count);
 *  4. no commit of it is on no remote (`git rev-list HEAD --not --remotes`);
 *  5. it is not locked;
 *  6. no running process — an agent session above all — has its working directory inside it.
 *
 * Otherwise it is KEPT with the first reason that holds (`keptSaid`), or ACTIVE when its request is
 * open or it has none. "Remove" on one row asks the person and goes through `git worktree remove`
 * too, so git itself refuses a worktree with changes.
 */

/** A pull (`#`) or merge (`!`) request whose head is a worktree's branch. */
export interface Change {
  sign: '#' | '!'
  number: number
  state: 'open' | 'merged' | 'closed'
  /** The branch it targets: `main`. */
  base: string
  /** Its link on the forge, when the forge said. */
  url?: string
}

/** A process whose working directory is inside a worktree. */
export interface Busy {
  pid: number
  /** The program's name, as `lsof` says it: `claude`, `codex`, `node`. */
  command: string
  /** Whether that program is an agent CLI (`AGENT_COMMANDS`). */
  agent: boolean
}

/** The agent CLIs whose working directory says a session is using a worktree. */
export const AGENT_COMMANDS = ['claude', 'codex', 'gemini', 'opencode', 'vibe', 'aider', 'cursor-agent', 'goose', 'amp', 'copilot']

export function isAgent(command: string): boolean {
  const name = command.toLowerCase().replace(/^.*\//, '')
  return AGENT_COMMANDS.some((one) => name === one || name.startsWith(`${one}-`) || name.startsWith(`${one}.`))
}

/** What the server read of one worktree. */
export interface Facts {
  path: string
  /** The repository's main checkout. */
  repo: string
  /** The project folder it was found through. */
  project: string
  /** Null for a detached HEAD. */
  branch: string | null
  head: string
  locked: boolean
  /** Tracked files with changes, staged or not. */
  dirty: number
  /** Untracked paths (not ignored ones). */
  untracked: number
  /** Commits on no remote branch. Unknown is counted as one: a count that could not be read keeps it. */
  unpushed: number
  /** When work last happened in it, ms. */
  changedAt: number
  busy: Busy | null
  change: Change | null
  /** HEAD is contained in `origin/<change.base>`; false without a merged change. */
  contained: boolean
}

export type Group = 'reclaimable' | 'kept' | 'active'

export type Kept =
  | { kind: 'not-contained'; base: string }
  | { kind: 'locked' }
  | { kind: 'dirty'; count: number }
  | { kind: 'untracked'; count: number }
  | { kind: 'unpushed'; count: number }
  | { kind: 'busy'; busy: Busy }
  | { kind: 'closed'; sign: '#' | '!'; number: number }

export type Decision = { group: 'reclaimable' } | { group: 'kept'; kept: Kept } | { group: 'active' }

/** THE RULE (see the top of this file). */
export function decide(facts: Facts): Decision {
  const change = facts.change
  if (!change || change.state === 'open') return { group: 'active' }
  if (change.state === 'closed') return { group: 'kept', kept: { kind: 'closed', sign: change.sign, number: change.number } }
  if (!facts.contained) return { group: 'kept', kept: { kind: 'not-contained', base: change.base } }
  if (facts.locked) return { group: 'kept', kept: { kind: 'locked' } }
  if (facts.dirty > 0) return { group: 'kept', kept: { kind: 'dirty', count: facts.dirty } }
  if (facts.untracked > 0) return { group: 'kept', kept: { kind: 'untracked', count: facts.untracked } }
  if (facts.unpushed > 0) return { group: 'kept', kept: { kind: 'unpushed', count: facts.unpushed } }
  if (facts.busy) return { group: 'kept', kept: { kind: 'busy', busy: facts.busy } }
  return { group: 'reclaimable' }
}

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const requestWord = (sign: '#' | '!') => (sign === '!' ? 'MR' : 'PR')

/** Why a worktree is kept, as a clause after "kept: ". */
export function keptSaid(kept: Kept): string {
  switch (kept.kind) {
    case 'not-contained':
      return `its last commit is not in ${kept.base}`
    case 'locked':
      return 'it is locked'
    case 'dirty':
      return `${plural(kept.count, 'file has', 'files have')} uncommitted changes`
    case 'untracked':
      return `${plural(kept.count, 'untracked file')}`
    case 'unpushed':
      return `${plural(kept.count, 'commit is', 'commits are')} not pushed`
    case 'busy':
      return kept.busy.agent ? `an agent session (${kept.busy.command}) works in it` : `${kept.busy.command} (pid ${kept.busy.pid}) works in it`
    case 'closed':
      return `${requestWord(kept.sign)} ${kept.sign}${kept.number} was closed without merging`
  }
}

/** The request's state in a word or two: "PR #12 merged", "no PR". */
export function changeSaid(change: Change | null): string {
  if (!change) return 'no PR'
  return `${requestWord(change.sign)} ${change.sign}${change.number} ${change.state}`
}

/** A size: "1.2 GB", "340 MB", "12 KB". */
export function bytesSaid(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** "3 days ago", "today", for a last change. */
export function agoSaid(at: number, now: number): string {
  if (!at) return 'unknown'
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

/** The worktree's folder's last name, or its path's last two names when that is short. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

/** A repository's name: its folder's last name. */
export const repoName = (repo: string): string => repo.split('/').filter(Boolean).at(-1) ?? repo

/* ------------------------------------------------------------------ *
 * What the server answers the page
 * ------------------------------------------------------------------ */

/** One worktree as the page is shown it. */
export interface Row {
  path: string
  repo: string
  project: string
  branch: string | null
  changedAt: number
  /** Bytes on the disk, or null while not measured. */
  bytes: number | null
  /** When `bytes` was measured, ms. */
  measuredAt: number | null
  change: Change | null
  dirty: number
  untracked: number
  unpushed: number
  busy: Busy | null
  group: Group
  /** "kept: …" without the "kept: ", for a kept one. */
  kept: string | null
}

export interface Removal {
  at: number
  path: string
  repo: string
  branch: string | null
  bytes: number | null
  /** `auto` for the automatic cleanup, `person` for a press. */
  by: 'auto' | 'person'
  branchDeleted: boolean
  change: Change | null
}

export interface State {
  /** When the last scan finished, ms; null before the first. */
  at: number | null
  scanning: boolean
  measuring: boolean
  /** Whether the automatic cleanup is on, on this computer. */
  auto: boolean
  projects: string[]
  rows: Row[]
  /** Sentences about what could not be read (a fetch, a forge). */
  notes: string[]
  /** The newest removals, newest first. */
  removed: Removal[]
}

export interface Totals {
  count: number
  bytes: number
  reclaimable: { count: number; bytes: number }
  kept: { count: number; bytes: number }
  active: { count: number; bytes: number }
  /** Worktrees whose size is not measured yet. */
  unmeasured: number
}

export function totalsOf(rows: readonly Row[]): Totals {
  const out: Totals = { count: rows.length, bytes: 0, reclaimable: { count: 0, bytes: 0 }, kept: { count: 0, bytes: 0 }, active: { count: 0, bytes: 0 }, unmeasured: 0 }
  for (const row of rows) {
    const bytes = row.bytes ?? 0
    if (row.bytes === null) out.unmeasured++
    out.bytes += bytes
    out[row.group].count++
    out[row.group].bytes += bytes
  }
  return out
}

/** "Clean up merged (3)". */
export const cleanSaid = (count: number): string => `Clean up merged (${count})`

/** "12 worktrees · 8.4 GB · 3.1 GB reclaimable": the footer's readout. */
export function readoutSaid(totals: Totals): string {
  return `${plural(totals.count, 'worktree')} · ${bytesSaid(totals.bytes)} · ${bytesSaid(totals.reclaimable.bytes)} reclaimable`
}

/** "Removed 3 worktrees, freeing 1.2 GB." */
export function freedSaid(removed: readonly Pick<Removal, 'bytes'>[]): string {
  const bytes = removed.reduce((sum, one) => sum + (one.bytes ?? 0), 0)
  if (!removed.length) return 'Nothing was removed.'
  return `Removed ${plural(removed.length, 'worktree')}${bytes > 0 ? `, freeing ${bytesSaid(bytes)}` : ''}.`
}

/** What a session that worked in a worktree is told when it is removed. */
export function toldSaid(one: Removal): string {
  const what = one.branch ? `the worktree for ${one.branch}` : 'a worktree'
  const why = one.change ? `, since ${requestWord(one.change.sign)} ${one.change.sign}${one.change.number} is merged` : ''
  return `Worktrees removed ${what} at ${one.path}${why}${one.branchDeleted ? ', and its local branch' : ''}. Start new work in a new worktree.`
}
