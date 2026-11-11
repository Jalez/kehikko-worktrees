import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PressValue } from 'kehikot-module-protocol'
import { Cover, coverFor, useKept, useServerStanding } from 'kehikot-module-protocol/client/react'

import { HeaderMenus } from '@/components/header-menus'
import { Button } from '@/components/ui/button'
import { cleanSaid } from '../worktrees/rule.ts'
import { BY, type By } from '@/glance'
import { footerItems, headerItems, pressed } from '@/header'
import { Charts } from '@/view/charts'
import { List } from '@/view/list'
import { levelOf } from '@/view/tiles'
import { useBox } from '@/view/use-box'
import { useKehikot, type Host } from '@/wire/use-kehikot'
import { useOnScreen } from '@/wire/use-on-screen'
import { useWorktrees, type Worktrees } from '@/wire/use-worktrees'

type Press = { item: string; value?: PressValue }

const among = (list: readonly unknown[]) => (value: unknown) => list.includes(value)

/**
 * The page. The server owns the worktrees, the toggle and every removal; the page owns only how the
 * first chart groups (kept per container), and tells the server which project and place it shows, so
 * that project is scanned and its sessions can be told of a removal.
 */
export function App() {
  const pressing = useRef<(press: Press) => unknown>(() => undefined)
  const host = useKehikot({ onPress: (press) => pressing.current(press) as never })
  const [by, setBy] = useKept<By>(host, 'by', 'project', among(BY))
  const shown = useOnScreen(host.visible)
  const worktrees = useWorktrees(shown, host.where === 'hosted')
  const { act } = worktrees

  const press = useCallback(
    ({ item, value }: Press) => {
      const said = pressed(item, value)
      if (typeof said === 'string') return said
      if ('by' in said) setBy(said.by)
      else if ('auto' in said) void act('auto', { on: said.auto })
      else if ('scan' in said) void act('scan')
      else if ('prune' in said) void act('prune')
      else void act('clean')
    },
    [setBy, act],
  )
  pressing.current = press

  /* Tell the server which project and place this page shows: it scans that project from now on. */
  const kehikko = host.kehikko?.key
  useEffect(() => {
    if (host.where !== 'hosted' || !host.projectPath) return
    void act('here', { project: host.projectPath, ...(host.epic ? { epic: host.epic } : {}), ...(kehikko ? { kehikko } : {}) })
  }, [host.where, host.projectPath, host.epic, kehikko, act])

  return <Screen host={host} worktrees={worktrees} by={by} onPress={press} />
}

/** Everything drawn, from plain values, so a test draws it with a made-up state. */
export function Screen({ host, worktrees, by, onPress = () => {}, now: given, box: givenBox }: { host: Host; worktrees: Worktrees; by: By; onPress?: (press: Press) => void; now?: number; box?: { width: number; height: number } }) {
  const server = useServerStanding()
  const [again, setAgain] = useState(0)
  const cover = coverFor({ ...host, server }, { host: true, project: false })
  const { state, problem, said, act } = worktrees
  const now = given ?? Date.now()
  const area = useRef<HTMLDivElement>(null)
  const measured = useBox(area)
  const box = givenBox ?? measured
  const level = levelOf(box)

  const items = useMemo(() => headerItems({ state, by }), [state, by])
  const { header } = host
  useEffect(() => header(items), [header, items])

  const footed = host.where === 'hosted' && host.drawsFooter === true
  const footerSaid = footed ? JSON.stringify(cover ? [] : footerItems(state)) : null
  const { footer } = host
  useEffect(() => {
    if (footerSaid) footer?.(JSON.parse(footerSaid))
  }, [footer, footerSaid])

  const drawn = cover !== null ? cover !== 'waiting' : state !== null || Boolean(problem)
  const { ready } = host
  useEffect(() => {
    if (drawn) ready?.()
  }, [drawn, ready])

  return (
    <div data-kehikot-page className="flex h-screen min-w-0 flex-col text-sm">
      {host.where === 'unhosted' ? (
        <header className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2">
          <span className="text-xs font-medium">Worktrees</span>
          <HeaderMenus items={items} onPress={onPress} />
        </header>
      ) : null}
      <main key={again} ref={area} data-kehikot-scroll className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-auto" data-level={level}>
        {cover ? (
          <Cover state={cover} name="Worktrees" onRetry={() => setAgain((n) => n + 1)} />
        ) : !state ? (
          <p className="text-muted-foreground m-3 text-xs" role="status">
            {problem ?? 'Reading the worktrees…'}
          </p>
        ) : (
          <>
            {problem || said ? (
              <p className={`px-2 py-1 text-xs ${problem ? 'text-destructive' : 'text-muted-foreground'}`} role="status" aria-live="polite">
                {problem ?? said}
              </p>
            ) : null}
            {!state.projects.length ? (
              <p className="text-muted-foreground m-3 text-xs" role="status">
                Open Worktrees in a project, and its repositories’ worktrees show here.
              </p>
            ) : state.at === null ? (
              <p className="text-muted-foreground m-3 text-xs" role="status">
                Reading every repository’s worktrees…
              </p>
            ) : state.rows.length ? (
              <Charts state={state} by={by} width={box?.width ?? null} level={level} />
            ) : (
              <p className="text-muted-foreground m-3 text-xs" role="status">
                No worktrees in {state.projects.length} project{state.projects.length === 1 ? '' : 's'}: nothing takes room.
              </p>
            )}
            {level === 'full' ? <List rows={state.rows} now={now} onRemove={(path) => void act('remove', { path })} onOpen={(path) => void act('open', { path })} /> : null}
            {!footed && state.rows.some((row) => row.group === 'reclaimable') ? (
              /* A host that draws no footer: the readout's act stays on the page. */
              <div className="px-2 py-1">
                <Button size="sm" variant="outline" onClick={() => void act('clean')}>
                  {cleanSaid(state.rows.filter((row) => row.group === 'reclaimable').length)}
                </Button>
              </div>
            ) : null}
            {level === 'full' && state.notes.length ? (
              <ul className="text-muted-foreground px-2 pb-3 text-xs">
                {state.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
