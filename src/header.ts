import { footerItemsSchema, headerItemsSchema, LIMITS, type FooterItem, type HeaderItem } from 'kehikot-module-protocol'

import { bytesSaid, cleanSaid, readoutSaid, totalsOf, type State } from '../worktrees/rule.ts'
import { BY, type By } from './glance.ts'

/**
 * The two rows the host draws. The HEADER is how the module is set up: the automatic cleanup (on by
 * default, per computer), how the first chart groups (by project or repository), Rescan and Prune.
 * The FOOTER is what is going on now: "N worktrees · X GB · Y GB reclaimable", whether it is scanning
 * or measuring, and Clean up merged beside the readout it acts on. Nothing is in both.
 *
 * `agents: true` only on what loses nothing: the grouping switch and Rescan. Nothing that removes is
 * an agent's to press.
 */

export const AUTO_LABEL = 'Clean up merged worktrees automatically'
export const BY_SAID: Record<By, string> = { project: 'By project', repo: 'By repository' }

export interface Rows {
  state: State | null
  by: By
}

export function headerItems({ state, by }: Rows): HeaderItem[] {
  const scanning = Boolean(state?.scanning || state?.measuring)
  return headerItemsSchema.parse([
    { kind: 'toggle', id: 'auto', label: AUTO_LABEL, checked: state?.auto ?? true },
    { kind: 'switch', id: 'by', label: 'Group', agents: true, options: BY.map((one) => ({ id: one, label: BY_SAID[one] })), value: by },
    { kind: 'run', id: 'scan', label: 'Rescan', icon: 'refresh', agents: true, state: scanning ? 'busy' : 'idle' },
    { kind: 'run', id: 'prune', label: 'Prune', state: 'idle' },
  ])
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems(state: State | null): FooterItem[] {
  if (!state) return footerItemsSchema.parse([{ kind: 'text', id: 'readout', text: 'Reading worktrees…' }])
  const totals = totalsOf(state.rows)
  const items: unknown[] = []
  items.push({
    kind: 'text',
    id: 'readout',
    text: cut(state.at === null ? 'First scan…' : readoutSaid(totals), LIMITS.FOOTER_TEXT),
    tooltip: cut(
      `${totals.count} worktrees take ${bytesSaid(totals.bytes)}${totals.unmeasured ? ` (${totals.unmeasured} not measured yet)` : ''}; ${bytesSaid(totals.reclaimable.bytes)} in ${totals.reclaimable.count} merged and safe to remove.`,
      LIMITS.FOOTER_TOOLTIP,
    ),
  })
  if (state.scanning) items.push({ kind: 'text', id: 'busy', text: 'Scanning…', optional: true, align: 'center' })
  else if (state.measuring) items.push({ kind: 'text', id: 'busy', text: 'Measuring…', optional: true, align: 'center' })
  items.push({
    kind: 'run',
    id: 'clean',
    label: cleanSaid(totals.reclaimable.count),
    actsOn: 'readout',
    align: 'end',
    confirm: true,
    disabled: totals.reclaimable.count ? null : 'No worktree is merged and safe to remove.',
    tooltip: 'Remove every worktree that is merged and safe to remove, and its local branch.',
  })
  return footerItemsSchema.parse(items)
}

export type Pressed = { auto: boolean } | { by: By } | { scan: true } | { prune: true } | { clean: true }

/** What a press asks for, or a sentence saying why it was not taken. */
export function pressed(item: string, value: unknown): Pressed | string {
  if (item === 'auto') return typeof value === 'boolean' ? { auto: value } : 'The automatic cleanup is on or off.'
  if (item === 'by') return (BY as readonly unknown[]).includes(value) ? { by: value as By } : 'Group by project or by repository.'
  if (item === 'scan') return { scan: true }
  if (item === 'prune') return { prune: true }
  if (item === 'clean') return { clean: true }
  return `Worktrees has nothing called "${item.slice(0, 40)}" to press.`
}
