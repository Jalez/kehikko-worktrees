import { afterEach, describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Screen } from '../src/app.tsx'
import { levelOf, tileLayout } from '../src/view/tiles.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import type { Worktrees } from '../src/wire/use-worktrees.ts'
import { STATE } from './header.test.ts'

let root: Root | null = null
let at: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  at?.remove()
  root = null
})

const host = (extra: Partial<Host> = {}): Host => ({ where: 'hosted', projectPath: '/r', theme: 'light', header: () => {}, drawsFooter: true, footer: () => {}, ...extra }) as Host

function draw(box: { width: number; height: number }, worktrees: Partial<Worktrees> = {}, h: Host = host()): HTMLElement {
  at = document.createElement('div')
  document.body.append(at)
  root = createRoot(at)
  const w: Worktrees = { state: STATE, problem: null, said: null, act: async () => {}, ...worktrees }
  act(() => root!.render(createElement(Screen, { host: h, worktrees: w, by: 'project', now: 10, box })))
  return at
}

describe('sizes', () => {
  test('levelOf: words when short, then charts, then the list', () => {
    expect(levelOf({ width: 300, height: 100 })).toBe('words')
    expect(levelOf({ width: 300, height: 250 })).toBe('charts')
    expect(levelOf({ width: 300, height: 600 })).toBe('full')
    expect(tileLayout(200).compact).toBe(true)
    expect(tileLayout(700).columns).toBe(3)
  })

  test('a short container: three tiles of words and one thin bar, no plots, no list', () => {
    const page = draw({ width: 280, height: 100 })
    expect(page.querySelector('[data-testid="tiles"]')?.getAttribute('data-level')).toBe('words')
    expect(page.querySelector('[data-testid="thin-bar"]')).not.toBeNull()
    expect(page.querySelector('[role="img"][tabindex]')).toBeNull()
    expect(page.querySelector('[data-testid="list"]')).toBeNull()
    expect(page.querySelector('[data-testid="tile-share-value"]')?.textContent).toBe('3 GB reclaimable')
  })

  test('a tall container: the charts, each an image of its sentence, and the list with Remove', () => {
    const page = draw({ width: 700, height: 700 })
    const images = [...page.querySelectorAll('[role="img"]')].map((one) => one.getAttribute('aria-label'))
    expect(images.some((label) => label?.startsWith('Disk by project'))).toBe(true)
    expect(images.some((label) => label?.startsWith('Of the disk worktrees take'))).toBe(true)
    expect(images.some((label) => label?.startsWith('The biggest worktrees'))).toBe(true)
    expect(page.querySelectorAll('[data-testid="row"]')).toHaveLength(3)
    expect(page.textContent).toContain('kept: it is locked')
  })

  test('Remove asks again before it acts', () => {
    const removed: string[] = []
    const page = draw({ width: 700, height: 700 }, { act: async (path, body) => void (path === 'remove' && removed.push(String(body?.path))) })
    const button = page.querySelector('button[aria-label^="Remove /w/kept"]') as HTMLButtonElement
    act(() => button.click())
    expect(removed).toEqual([])
    const again = page.querySelector('button[aria-label^="Press again to remove /w/kept"]') as HTMLButtonElement
    act(() => again.click())
    expect(removed).toEqual(['/w/kept1073741824'])
  })

  test('the footer is declared with the readout', () => {
    let said: unknown = null
    draw({ width: 400, height: 400 }, {}, host({ footer: (items) => void (said = items) }))
    expect(JSON.stringify(said)).toContain('3 worktrees · 6 GB · 3 GB reclaimable')
  })

  test('a host that draws no footer: Clean up merged stays on the page', () => {
    const page = draw({ width: 400, height: 400 }, {}, host({ drawsFooter: false }))
    expect(page.textContent).toContain('Clean up merged (1)')
  })
})
