import { describe, expect, test } from 'bun:test'

import { busyIn, changeOf, forgeOf, newestReflogEntry, parseDu, parseWorktrees, statusCounts } from '../worktrees/git.ts'

describe('reading git', () => {
  test('parseWorktrees', () => {
    const out = 'worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r-w/x\nHEAD bbb\nbranch refs/heads/x\nlocked\n\nworktree /gone\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n'
    const listed = parseWorktrees(out)
    expect(listed.map((one) => one.path)).toEqual(['/r', '/r-w/x', '/gone'])
    expect(listed[1]).toMatchObject({ branch: 'x', locked: true })
    expect(listed[2]).toMatchObject({ branch: null, prunable: true })
  })

  test('statusCounts leaves ignored files out (git does not report them)', () => {
    expect(statusCounts(' M a.ts\n?? new.ts\nA  b.ts\n')).toEqual({ dirty: 2, untracked: 1 })
    expect(statusCounts('')).toEqual({ dirty: 0, untracked: 0 })
  })

  test('parseDu', () => {
    const sizes = parseDu('12\t/a b/c\n3\t/d\nnoise\nkehikot-queue: x passed (exit 0).')
    expect(sizes.get('/a b/c')).toBe(12 * 1024)
    expect(sizes.size).toBe(2)
  })

  test('busyIn prefers an agent CLI, and only inside the folder', () => {
    const cwds = [
      { pid: 1, command: 'zsh', cwd: '/w/x' },
      { pid: 2, command: 'claude', cwd: '/w/x/src' },
      { pid: 3, command: 'claude', cwd: '/w/xy' },
    ]
    expect(busyIn('/w/x', cwds)).toEqual({ pid: 2, command: 'claude', agent: true })
    expect(busyIn('/w/z', cwds)).toBeNull()
  })

  test('changeOf and forgeOf', () => {
    expect(changeOf([{ sign: '#', number: 1, state: 'closed', base: 'main' }, { sign: '#', number: 2, state: 'merged', base: 'main' }])?.number).toBe(2)
    expect(changeOf([])).toBeNull()
    expect(forgeOf('git@github.com:Jalez/x.git')).toBe('github')
    expect(forgeOf('https://gitlab.example.com/a/b.git')).toBe('gitlab')
    expect(forgeOf('/srv/repo.git')).toBeNull()
  })

  test('newestReflogEntry', () => {
    expect(newestReflogEntry('a b Me <m> 100 +0000\tcommit\na b Me <m> 200 +0000\tcheckout\n')).toBe(200_000)
  })
})
