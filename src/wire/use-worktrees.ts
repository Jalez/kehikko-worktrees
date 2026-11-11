import { useCallback, useEffect, useRef, useState } from 'react'
import { answered, ask } from 'kehikot-module-protocol/client'

import type { State } from '../../worktrees/rule.ts'

/**
 * The server's state (`GET /api/state`), read while the page is on screen: every `BUSY_MS` while it
 * scans or measures, every `QUIET_MS` otherwise, and at once after each act. Reading it is cheap — the
 * server answers from memory; the heavy work (git, `du`) happens on its own clock, never on a read.
 */

export const BUSY_MS = 2500
export const QUIET_MS = 20_000

export interface Worktrees {
  state: State | null
  /** A sentence when the server would not answer, or an act was refused. */
  problem: string | null
  /** What the last act came to, in a sentence. */
  said: string | null
  act(path: 'scan' | 'clean' | 'prune' | 'auto' | 'remove' | 'open' | 'here', body?: Record<string, unknown>): Promise<void>
}

type Reply = { ok?: boolean; error?: string; said?: string; removed?: unknown[]; kept?: Array<{ path: string; why: string }>; repos?: number }

export function useWorktrees(onScreen: boolean, hosted: boolean): Worktrees {
  const [state, setState] = useState<State | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!onScreen || !hosted) return
    let gone = false
    const read = async () => {
      try {
        const got = answered(await ask<State>('./api/state'))
        if (gone) return
        setState(got)
        setProblem(null)
        timer.current = setTimeout(read, got.scanning || got.measuring ? BUSY_MS : QUIET_MS)
      } catch (error) {
        if (gone) return
        setProblem(error instanceof Error ? error.message : String(error))
        timer.current = setTimeout(read, QUIET_MS)
      }
    }
    void read()
    return () => {
      gone = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [onScreen, hosted, tick])

  const act = useCallback<Worktrees['act']>(async (path, body = {}) => {
    try {
      const got = answered(await ask<Reply>(`./api/${path}`, { body }))
      if (got.ok === false) setSaid(got.error ?? 'That was not done.')
      else if (path === 'clean') setSaid(`${got.said ?? ''}${got.kept?.length ? ` ${got.kept.length} kept on a second look.` : ''}`.trim())
      else if (path === 'remove') setSaid('Removed.')
      else if (path === 'prune') setSaid(`Pruned ${got.repos ?? 0} repositories.`)
      else if (path !== 'here' && path !== 'open') setSaid(null)
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error))
    }
    setTick((n) => n + 1)
  }, [])

  return { state, problem, said, act }
}
