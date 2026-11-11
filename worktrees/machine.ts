import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { moduleFile } from 'kehikot-module-protocol'

import type { Removal } from './rule.ts'

/**
 * What this module keeps on this computer, in its own folder of Kehikot's machine folder
 * (`~/Library/Application Support/Kehikot/worktrees/`, `KEHIKOT_WORKTREES_DIR` for the tests):
 *
 * - `settings.json`: the automatic cleanup, on or off (on unless the person turned it off);
 * - `sizes.json`: each worktree's last measured size and when, so `du` runs seldom;
 * - `projects.json`: the projects it has been shown, so a restart scans them before a page opens;
 * - `removed.jsonl`: every removal, one line each.
 *
 * In a project it writes one small file, `.kehikot/worktrees/seen.json`, so the host's
 * `projects.mine` names that project to it after a restart.
 */

type Env = Record<string, string | undefined>

export function machineDir(env: Env = process.env, platform: string = process.platform): string {
  if (env.KEHIKOT_WORKTREES_DIR) return env.KEHIKOT_WORKTREES_DIR
  const home = homedir() // kehikot-storage: allow the module's machine-level settings, size cache and removal log live in Kehikot's machine folder
  const base = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Kehikot') : join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'kehikot')
  return join(base, 'worktrees')
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, name)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, file)
}

/** The automatic cleanup is on by default. */
export const AUTO_DEFAULT = true

export class Machine {
  readonly dir: string
  constructor(dir: string = machineDir()) {
    this.dir = dir
  }

  auto(): boolean {
    const read = readJson(join(this.dir, 'settings.json')) as { auto?: unknown } | null
    return typeof read?.auto === 'boolean' ? read.auto : AUTO_DEFAULT
  }

  setAuto(on: boolean): void {
    const read = (readJson(join(this.dir, 'settings.json')) as Record<string, unknown> | null) ?? {}
    writeJson(this.dir, 'settings.json', { ...read, auto: on })
  }

  sizes(): Record<string, { bytes: number; at: number }> {
    const read = readJson(join(this.dir, 'sizes.json'))
    if (!read || typeof read !== 'object' || Array.isArray(read)) return {}
    const out: Record<string, { bytes: number; at: number }> = {}
    for (const [path, one] of Object.entries(read as Record<string, unknown>)) {
      const value = one as { bytes?: unknown; at?: unknown }
      if (typeof value?.bytes === 'number' && typeof value.at === 'number') out[path] = { bytes: value.bytes, at: value.at }
    }
    return out
  }

  setSizes(sizes: Record<string, { bytes: number; at: number }>): void {
    writeJson(this.dir, 'sizes.json', sizes)
  }

  projects(): string[] {
    const read = readJson(join(this.dir, 'projects.json'))
    return Array.isArray(read) ? read.filter((one): one is string => typeof one === 'string' && one.startsWith('/')).slice(0, 200) : []
  }

  setProjects(projects: readonly string[]): void {
    writeJson(this.dir, 'projects.json', projects.slice(0, 200))
  }

  logRemoval(one: Removal): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    appendFileSync(join(this.dir, 'removed.jsonl'), `${JSON.stringify(one)}\n`, { mode: 0o600 })
  }

  removals(most = 50): Removal[] {
    try {
      const lines = readFileSync(join(this.dir, 'removed.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
      return lines
        .slice(-most)
        .map((line) => JSON.parse(line) as Removal)
        .reverse()
    } catch {
      return []
    }
  }
}

/** Mark a project as one this module was shown, so `projects.mine` names it after a restart. */
export function markProject(project: string, now: number, moduleId: string): void {
  const file = moduleFile(project, moduleId, 'seen')
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ seenAt: now })}\n`)
  } catch {
    /* a project we cannot write in is still scanned */
  }
}
