import { describe, expect, test } from 'bun:test'

import { agoSaid, bytesSaid, decide, freedSaid, isAgent, keptSaid, readoutSaid, toldSaid, totalsOf, type Facts, type Row } from '../worktrees/rule.ts'

export function facts(extra: Partial<Facts> = {}): Facts {
  return {
    path: '/p/app-worktrees/feature',
    repo: '/p/app',
    project: '/p/app',
    branch: 'feature',
    head: 'abc',
    locked: false,
    dirty: 0,
    untracked: 0,
    unpushed: 0,
    changedAt: 0,
    busy: null,
    change: { sign: '#', number: 12, state: 'merged', base: 'main' },
    contained: true,
    ...extra,
  }
}

describe('the rule', () => {
  test('merged, contained, clean, pushed and idle is reclaimable', () => {
    expect(decide(facts())).toEqual({ group: 'reclaimable' })
  })

  test('an open request or none is active', () => {
    expect(decide(facts({ change: null })).group).toBe('active')
    expect(decide(facts({ change: { sign: '#', number: 1, state: 'open', base: 'main' } })).group).toBe('active')
  })

  test('every condition keeps it, with its reason', () => {
    const said = (extra: Partial<Facts>) => {
      const d = decide(facts(extra))
      return d.group === 'kept' ? keptSaid(d.kept) : d.group
    }
    expect(said({ contained: false })).toBe('its last commit is not in main')
    expect(said({ locked: true })).toBe('it is locked')
    expect(said({ dirty: 2 })).toBe('2 files have uncommitted changes')
    expect(said({ untracked: 1 })).toBe('1 untracked file')
    expect(said({ unpushed: 3 })).toBe('3 commits are not pushed')
    expect(said({ busy: { pid: 9, command: 'claude', agent: true } })).toBe('an agent session (claude) works in it')
    expect(said({ busy: { pid: 9, command: 'vim', agent: false } })).toBe('vim (pid 9) works in it')
    expect(said({ change: { sign: '!', number: 4, state: 'closed', base: 'main' } })).toBe('MR !4 was closed without merging')
  })

  test('agent CLIs are told from other programs', () => {
    expect(isAgent('claude')).toBe(true)
    expect(isAgent('/usr/local/bin/codex')).toBe(true)
    expect(isAgent('zsh')).toBe(false)
  })
})

describe('the words', () => {
  test('sizes and times', () => {
    expect(bytesSaid(1536)).toBe('1.5 KB')
    expect(bytesSaid(5 * 1024 ** 3)).toBe('5 GB')
    expect(bytesSaid(null)).toBe('—')
    expect(agoSaid(Date.now() - 3 * 86_400_000, Date.now())).toBe('3 days ago')
  })

  test('the readout and totals', () => {
    const row = (group: Row['group'], bytes: number | null): Row => ({ path: `/x/${Math.random()}`, repo: '/x', project: '/x', branch: 'b', changedAt: 0, bytes, measuredAt: null, change: null, dirty: 0, untracked: 0, unpushed: 0, busy: null, group, kept: null })
    const totals = totalsOf([row('reclaimable', 1024 ** 3), row('kept', 1024 ** 3), row('active', null)])
    expect(totals.count).toBe(3)
    expect(totals.unmeasured).toBe(1)
    expect(readoutSaid(totals)).toBe('3 worktrees · 2 GB · 1 GB reclaimable')
  })

  test('what is told', () => {
    expect(freedSaid([{ bytes: 1024 ** 2 }, { bytes: null }])).toBe('Removed 2 worktrees, freeing 1 MB.')
    expect(toldSaid({ at: 0, path: '/a', repo: '/r', branch: 'b', bytes: null, by: 'auto', branchDeleted: true, change: { sign: '#', number: 3, state: 'merged', base: 'main' } })).toContain('PR #3 is merged, and its local branch')
  })
})
