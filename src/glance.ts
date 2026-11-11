import { bytesSaid, changeSaid, repoName, totalsOf, type Group, type Row, type State, type Totals } from '../worktrees/rule.ts'
import { clip, type Tip } from './view/tiles.ts'

/**
 * What the three charts draw, and the sentence each is an image of. Pure.
 *
 * - **By project** (or by repository): the disk each takes, stacked reclaimable, kept and active.
 * - **Share**: the doughnut of reclaimable, kept and active bytes.
 * - **Biggest**: the largest worktrees, one bar each, coloured by group.
 *
 * A chart is never the only place a number is: each tile says its figure in words, and each plot
 * carries its sentence as its label.
 */

export const GROUPS: readonly Group[] = ['reclaimable', 'kept', 'active']
export const GROUP_SAID: Record<Group, string> = { reclaimable: 'Reclaimable', kept: 'Kept', active: 'Active' }
/** One colour per group, never by order. Tokens in index.css, both themes. */
export const GROUP_COLOUR: Record<Group, string> = { reclaimable: 'var(--series-reclaimable)', kept: 'var(--series-kept)', active: 'var(--series-active)' }

export type By = 'project' | 'repo'
export const BY: readonly By[] = ['project', 'repo']

/** The most bars a chart draws; the rest are folded into "Other" (by project) or left out (biggest). */
export const BARS_MOST = 8

export interface Stack {
  key: string
  label: string
  reclaimable: number
  kept: number
  active: number
  total: number
  count: number
}

const projectName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

/** The disk by project or by repository, biggest first, at most `BARS_MOST` bars (the rest as Other). */
export function stacks(rows: readonly Row[], by: By): Stack[] {
  const map = new Map<string, Stack>()
  for (const row of rows) {
    const key = by === 'project' ? row.project : row.repo
    const label = by === 'project' ? projectName(row.project) : repoName(row.repo)
    const one = map.get(key) ?? { key, label, reclaimable: 0, kept: 0, active: 0, total: 0, count: 0 }
    const bytes = row.bytes ?? 0
    one[row.group] += bytes
    one.total += bytes
    one.count++
    map.set(key, one)
  }
  const sorted = [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count)
  if (sorted.length <= BARS_MOST) return sorted
  const kept = sorted.slice(0, BARS_MOST - 1)
  const rest = sorted.slice(BARS_MOST - 1)
  const other: Stack = { key: '(other)', label: 'Other', reclaimable: 0, kept: 0, active: 0, total: 0, count: 0 }
  for (const one of rest) for (const k of ['reclaimable', 'kept', 'active', 'total', 'count'] as const) other[k] += one[k]
  return [...kept, other]
}

export function stacksSaid(list: readonly Stack[], by: By): string {
  if (!list.length) return 'No worktrees yet.'
  return `Disk by ${by === 'project' ? 'project' : 'repository'}: ${list.map((one) => `${one.label} ${bytesSaid(one.total)} (${bytesSaid(one.reclaimable)} reclaimable)`).join('; ')}.`
}

export function stackTip(one: Stack): Tip {
  return { value: clip(one.label), detail: `${bytesSaid(one.total)} · ${one.count} worktree${one.count === 1 ? '' : 's'}`, note: `${bytesSaid(one.reclaimable)} reclaimable` }
}

export interface Segment {
  key: Group
  label: string
  bytes: number
  count: number
  fraction: number
}

/** The doughnut: each group's bytes and share; a group of size 0 is left out. */
export function segments(totals: Totals): Segment[] {
  const sum = totals.bytes
  if (!sum) return []
  return GROUPS.filter((g) => totals[g].bytes > 0).map((g) => ({ key: g, label: GROUP_SAID[g], bytes: totals[g].bytes, count: totals[g].count, fraction: totals[g].bytes / sum }))
}

export const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`

export function segmentsSaid(list: readonly Segment[]): string {
  if (!list.length) return 'Nothing measured yet.'
  return `Of the disk worktrees take: ${list.map((one) => `${one.label.toLowerCase()} ${bytesSaid(one.bytes)} (${percent(one.fraction)}, ${one.count})`).join('; ')}.`
}

export function segmentTip(one: Segment): Tip {
  return { value: one.label, detail: `${bytesSaid(one.bytes)} · ${percent(one.fraction)}`, note: `${one.count} worktree${one.count === 1 ? '' : 's'}` }
}

/** The biggest measured worktrees, at most `BARS_MOST`. */
export function biggest(rows: readonly Row[]): Row[] {
  return rows.filter((row) => (row.bytes ?? 0) > 0).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, BARS_MOST)
}

export const rowLabel = (row: Row): string => row.branch ?? row.path.split('/').filter(Boolean).at(-1) ?? row.path

export function biggestSaid(list: readonly Row[]): string {
  if (!list.length) return 'No sizes measured yet.'
  return `The biggest worktrees: ${list.map((row) => `${rowLabel(row)} ${bytesSaid(row.bytes)}`).join('; ')}.`
}

export function biggestTip(row: Row): Tip {
  return { value: clip(rowLabel(row)), detail: `${bytesSaid(row.bytes)} · ${repoName(row.repo)}`, note: row.group === 'kept' ? clip(`kept: ${row.kept ?? ''}`) : `${GROUP_SAID[row.group]} · ${changeSaid(row.change)}` }
}

/** The words of the three tiles, for every size: value and the line under it. */
export function tileWords(state: State): { total: { value: string; sub: string }; share: { value: string; sub: string }; biggest: { value: string; sub: string } } {
  const totals = totalsOf(state.rows)
  const top = biggest(state.rows)[0]
  const measuring = totals.unmeasured ? `${totals.unmeasured} not measured yet` : ''
  return {
    total: { value: bytesSaid(totals.bytes), sub: [`${totals.count} worktree${totals.count === 1 ? '' : 's'}`, measuring].filter(Boolean).join(' · ') },
    share: { value: `${bytesSaid(totals.reclaimable.bytes)} reclaimable`, sub: `${totals.reclaimable.count} merged · ${totals.kept.count} kept · ${totals.active.count} active` },
    biggest: top ? { value: bytesSaid(top.bytes), sub: rowLabel(top) } : { value: '—', sub: 'nothing measured yet' },
  }
}
