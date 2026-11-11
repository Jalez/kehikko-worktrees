import { describe, expect, test } from 'bun:test'
import { rowsAdvice } from 'kehikot-module-protocol'

import { AUTO_LABEL, footerItems, headerItems, pressed } from '../src/header.ts'
import type { Row, State } from '../worktrees/rule.ts'

const row = (group: Row['group'], bytes: number): Row => ({ path: `/w/${group}${bytes}`, repo: '/r', project: '/r', branch: 'b', changedAt: 0, bytes, measuredAt: 1, change: null, dirty: 0, untracked: 0, unpushed: 0, busy: null, group, kept: group === 'kept' ? 'it is locked' : null })
export const STATE: State = { at: 1, scanning: false, measuring: false, auto: true, projects: ['/r'], notes: [], removed: [], rows: [row('reclaimable', 3 * 1024 ** 3), row('kept', 1024 ** 3), row('active', 2 * 1024 ** 3)] }

describe('the header', () => {
  test('the toggle, on by default, the grouping, Rescan and Prune', () => {
    const items = headerItems({ state: null, by: 'project' })
    expect(items.map((one) => one.id)).toEqual(['auto', 'by', 'scan', 'prune'])
    expect(items[0]).toMatchObject({ kind: 'toggle', label: AUTO_LABEL, checked: true })
    expect(items.filter((one) => one.agents).map((one) => one.id)).toEqual(['by', 'scan'])
    expect(headerItems({ state: { ...STATE, measuring: true }, by: 'repo' })[2]).toMatchObject({ id: 'scan', state: 'busy' })
  })
})

describe('the footer', () => {
  test('the readout and Clean up merged beside it', () => {
    const items = footerItems(STATE)
    expect(items[0]).toMatchObject({ kind: 'text', id: 'readout', text: '3 worktrees · 6 GB · 3 GB reclaimable' })
    expect(items.at(-1)).toMatchObject({ kind: 'run', id: 'clean', label: 'Clean up merged (1)', actsOn: 'readout', confirm: true, disabled: null })
  })

  test('nothing reclaimable: Clean up merged says why it cannot run', () => {
    const items = footerItems({ ...STATE, rows: STATE.rows.filter((one) => one.group !== 'reclaimable') })
    expect(items.at(-1)).toMatchObject({ label: 'Clean up merged (0)' })
    expect((items.at(-1) as { disabled: string | null }).disabled).toBeTruthy()
  })

  test('the rows follow the rule', () => {
    expect(rowsAdvice(headerItems({ state: STATE, by: 'repo' }), footerItems(STATE))).toEqual([])
  })

  test('presses', () => {
    expect(pressed('auto', false)).toEqual({ auto: false })
    expect(pressed('by', 'repo')).toEqual({ by: 'repo' })
    expect(typeof pressed('by', 'x')).toBe('string')
    expect(pressed('clean', undefined)).toEqual({ clean: true })
  })
})
