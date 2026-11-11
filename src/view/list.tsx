import { useEffect, useState } from 'react'
import { Bot, FolderOpen, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { agoSaid, bytesSaid, changeSaid, repoName, type Row } from '../../worktrees/rule.ts'
import { GROUP_COLOUR, GROUP_SAID } from '@/glance'

/**
 * Every worktree, biggest first: its branch and repository, its folder, last activity and size, its
 * request, uncommitted or unpushed work, an agent session in it, and whether it is reclaimable, kept
 * (and why) or active. Remove asks once more before it acts (a second press within `CONFIRM_MS`);
 * Open shows the folder in Finder. Text only: a branch, a path and a reason are never markup.
 */

export const CONFIRM_MS = 4000

export function List({ rows, now, onRemove, onOpen }: { rows: readonly Row[]; now: number; onRemove: (path: string) => void; onOpen: (path: string) => void }) {
  if (!rows.length) return null
  return (
    <section aria-labelledby="list-title" className="flex min-w-0 flex-col gap-1 px-2 pb-3">
      <h2 id="list-title" className="text-muted-foreground pt-2 text-[10px] font-medium tracking-wide uppercase">
        Worktrees
      </h2>
      <ul className="flex min-w-0 flex-col divide-y" data-testid="list">
        {rows.map((row) => (
          <Item key={row.path} row={row} now={now} onRemove={onRemove} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  )
}

function Item({ row, now, onRemove, onOpen }: { row: Row; now: number; onRemove: (path: string) => void; onOpen: (path: string) => void }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const timer = setTimeout(() => setArming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [arming])
  const work = [row.dirty ? `${row.dirty} changed` : '', row.untracked ? `${row.untracked} untracked` : '', row.unpushed ? `${row.unpushed} unpushed` : ''].filter(Boolean).join(' · ')
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-1.5 text-xs" data-testid="row" data-group={row.group}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: GROUP_COLOUR[row.group] }} />
        <span className="min-w-0 flex-1 truncate font-medium" title={row.branch ?? 'detached HEAD'}>
          {row.branch ?? 'detached HEAD'}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{bytesSaid(row.bytes)}</span>
        <Button variant="ghost" size="icon" className="size-6" aria-label={`Open ${row.path} in Finder`} title="Open in Finder" onClick={() => onOpen(row.path)}>
          <FolderOpen className="size-3.5" />
        </Button>
        <Button
          variant={arming ? 'destructive' : 'ghost'}
          size="sm"
          className="h-6 px-1.5 text-xs"
          aria-label={arming ? `Press again to remove ${row.path}` : `Remove ${row.path}`}
          onClick={() => {
            if (!arming) return setArming(true)
            setArming(false)
            onRemove(row.path)
          }}
        >
          <Trash2 className="size-3.5" />
          {arming ? 'Remove?' : <span className="sr-only @min-[300px]:not-sr-only">Remove</span>}
        </Button>
      </div>
      <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-2 pl-3.5">
        <span className="truncate" title={row.path}>
          {repoName(row.repo)} · {row.path}
        </span>
        <span>{changeSaid(row.change)}</span>
        <span>{agoSaid(row.changedAt, now)}</span>
        {work ? <span className="text-amber-700 dark:text-amber-400">{work}</span> : null}
        {row.busy ? (
          <span className="inline-flex items-center gap-0.5">
            {row.busy.agent ? <Bot className="size-3" aria-hidden /> : null}
            {row.busy.agent ? `agent session (${row.busy.command})` : `${row.busy.command} running in it`}
          </span>
        ) : null}
        <span className={row.group === 'reclaimable' ? 'text-foreground' : ''}>{row.group === 'kept' ? `kept: ${row.kept}` : GROUP_SAID[row.group]}</span>
      </div>
    </li>
  )
}
