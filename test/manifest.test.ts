import { describe, expect, test } from 'bun:test'
import { editDecision, guardDecision, guardSays, placedGuardsSchema } from 'kehikot-module-protocol'

import pkg from '../package.json'
import { ID, MANIFEST, VERSION } from '../manifest.ts'

const placed = placedGuardsSchema.parse((MANIFEST.guards ?? []).map((guard) => ({ module: ID, name: 'Worktrees', guard })))
const HOME = '/Users/person'

describe('the manifest', () => {
  test('who it is', () => {
    expect(MANIFEST.id).toBe('kehikot.worktrees')
    expect(VERSION).toBe(pkg.version)
    expect(MANIFEST.tags).toEqual(['worktrees', 'git', 'agents', 'disk'])
    expect(MANIFEST.agentSays).toContain('git worktree add')
    expect(MANIFEST.absentSays).toBeTruthy()
    expect(MANIFEST.declares?.uses).toEqual(['agents:message', 'state:keep'])
  })

  test('the edit guard refuses a main checkout and an installed copy, and lets a worktree through', () => {
    expect(placed.map((one) => one.guard.id)).toEqual(['main-checkout', 'register'])
    const main = editDecision(placed, `${HOME}/Projects/app/src/a.ts`, { home: HOME, checkout: 'main' })
    expect(main.action).toBe('deny')
    if (main.action === 'deny') expect(guardSays(main)).toContain('git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main')
    expect(editDecision(placed, `${HOME}/Library/Application Support/Kehikot/installed/kehikot.queue/a.ts`, { home: HOME, checkout: 'linked' }).action).toBe('deny')
    expect(editDecision(placed, `${HOME}/Projects/app-worktrees/x/a.ts`, { home: HOME, checkout: 'linked' }).action).toBe('pass')
  })

  test('the shell guard refuses bun run register, and nothing else', () => {
    expect(guardDecision(placed, 'bun run register').action).toBe('deny')
    expect(guardDecision(placed, 'cd x && npm run register').action).toBe('deny')
    expect(guardDecision(placed, 'bun test').action).toBe('pass')
  })
})
