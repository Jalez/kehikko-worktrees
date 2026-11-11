import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SERVER, TICKET, answer, tools, worktreesSaid } from '../doors.ts'
import { Machine } from '../worktrees/machine.ts'
import { Scanner } from '../worktrees/scan.ts'
import type { State } from '../worktrees/rule.ts'

let scratch = ''
const opened: string[] = []
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worktrees-doors-'))
  SERVER.scanner = new Scanner({ moduleId: 'kehikot.worktrees', machine: new Machine(scratch), fetch: false, queueCli: () => null, log: () => {} })
  SERVER.open = (path) => opened.push(path)
})
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const q = new URLSearchParams()

describe('the doors', () => {
  test('healthz and the state are read without a ticket', async () => {
    expect((await answer('GET', '/healthz', q, null, null))?.status).toBe(200)
    const state = await answer('GET', '/api/state', q, null, null)
    expect((state?.body as State).auto).toBe(true)
  })

  test('every write needs the page’s ticket', async () => {
    for (const path of ['/api/scan', '/api/clean', '/api/remove', '/api/prune', '/api/open', '/api/auto', '/api/here']) {
      const refused = await answer('POST', path, q, {}, null)
      expect(refused?.status).toBeGreaterThanOrEqual(400)
    }
  })

  test('the toggle is kept on this computer', async () => {
    expect((await answer('POST', '/api/auto', q, { on: false }, TICKET))?.status).toBe(200)
    expect(((await answer('GET', '/api/state', q, null, null))?.body as State).auto).toBe(false)
    expect((await answer('POST', '/api/auto', q, { on: 'yes' }, TICKET))?.status).toBe(400)
  })

  test('open only opens a worktree the scan found', async () => {
    expect((await answer('POST', '/api/open', q, { path: '/etc' }, TICKET))?.status).toBe(400)
    expect(opened).toEqual([])
  })

  test('the MCP door has one read-only tool', async () => {
    expect(tools().map((t) => t.name)).toEqual(['worktrees'])
    expect(tools()[0]?.annotations.readOnlyHint).toBe(true)
    const listed = await answer('POST', '/mcp', q, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    expect(JSON.stringify(listed?.body)).toContain('worktrees')
    const remove = await answer('POST', '/mcp', q, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'remove', arguments: {} } }, null)
    expect(JSON.stringify(remove?.body)).toContain('isError')
  })

  test('worktreesSaid lists rows with their group and reason', () => {
    const state: State = {
      at: Date.now(),
      scanning: false,
      measuring: false,
      auto: true,
      projects: ['/p'],
      notes: [],
      removed: [],
      rows: [{ path: '/p-w/x', repo: '/p', project: '/p', branch: 'x', changedAt: Date.now(), bytes: 2048, measuredAt: 1, change: { sign: '#', number: 3, state: 'merged', base: 'main' }, dirty: 1, untracked: 0, unpushed: 0, busy: null, group: 'kept', kept: '1 file has uncommitted changes' }],
    }
    const said = worktreesSaid(state, {}, Date.now())
    expect(said).toContain('1 worktree · 2 KB · 0 B reclaimable')
    expect(said).toContain('- x — /p-w/x — 2 KB — PR #3 merged — 1 changed — kept: 1 file has uncommitted changes')
    expect(worktreesSaid(state, { group: 'active' }, Date.now())).not.toContain('/p-w/x')
  })
})
