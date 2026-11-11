import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from 'kehikot-module-protocol/client/ui/chart'

import { bytesSaid, totalsOf, type Row, type State } from '../../worktrees/rule.ts'
import {
  biggest,
  biggestSaid,
  biggestTip,
  GROUP_COLOUR,
  GROUPS,
  GROUP_SAID,
  percent,
  segments as segmentsOf,
  segmentsSaid,
  segmentTip,
  stacks as stacksOf,
  stacksSaid,
  stackTip,
  tileWords,
  type By,
  type Segment,
  type Stack,
} from '@/glance'
import { Plot } from '@/view/plot'
import { HEAD_HEIGHT, HOLE, LEGEND_ROW, niceTop, PAD_X, PAD_Y, ringRow, ROW_GAP, SUB_HEIGHT, tileLayout, type Level, type TileLayout } from '@/view/tiles'

/**
 * The three tiles, shadcn's chart in each: the disk by project or repository (stacked by group), the
 * share that is reclaimable, kept or active (a doughnut), and the biggest worktrees. Each says its
 * figure in words; each chart is an image of its sentence, with a small solid tooltip outside the
 * plot that never stays behind (the protocol's `useTip`, through `Plot`).
 *
 * At `words` (a short container) the tiles are words and one thin stacked bar, no plots. In one
 * column a tile is a compact row with its plot under it; side by side the words go under the title.
 */

const STACKED: ChartConfig = {
  reclaimable: { label: GROUP_SAID.reclaimable, color: GROUP_COLOUR.reclaimable },
  kept: { label: GROUP_SAID.kept, color: GROUP_COLOUR.kept },
  active: { label: GROUP_SAID.active, color: GROUP_COLOUR.active },
}
const SIZES: ChartConfig = { bytes: { label: 'Size', color: 'var(--series-active)' } }

const MARGIN = { top: 2, right: 0, bottom: 0, left: 0 }
const AXES_MARGIN = { top: 6, right: 4, bottom: 0, left: 0 }

export function Charts({ state, by, width, level }: { state: State; by: By; width: number | null; level: Level }) {
  const layout = tileLayout(width)
  const words = tileWords(state)
  const totals = totalsOf(state.rows)
  const stacked = stacksOf(state.rows, by)
  const ring = segmentsOf(totals)
  const top = biggest(state.rows)
  const plots = level !== 'words'
  return (
    <div
      className="bg-border grid min-w-0 shrink-0 grid-cols-1 gap-px @min-[360px]:grid-cols-2 @min-[640px]:grid-cols-3"
      data-testid="tiles"
      data-axes={layout.axes}
      data-compact={layout.compact}
      data-level={level}
    >
      <Tile layout={layout} title={by === 'project' ? 'By project' : 'By repository'} value={words.total.value} sub={words.total.sub} testId="tile-total">
        {plots ? (
          <Plot said={stacksSaid(stacked, by)} count={stacked.length} kind="bar" height={layout.plot} tip={(i) => stackTip(stacked[i] as Stack)} testId="tile-total">
            {(active) => (stacked.length ? <StackedBars stacks={stacked} axes={layout.axes} active={active} /> : null)}
          </Plot>
        ) : (
          <ThinBar segments={ring} />
        )}
      </Tile>
      <Tile layout={layout} title="Reclaimable" value={words.share.value} sub={words.share.sub} testId="tile-share">
        {plots ? (
          <Plot
            said={segmentsSaid(ring)}
            count={ring.length}
            kind="ring"
            height={ringRow(layout, ring.length)}
            ring={layout.ring}
            fractions={ring.map((one) => one.fraction)}
            tip={(i) => segmentTip(ring[i] as Segment)}
            testId="tile-share"
            aside={<Legend segments={ring} shown={layout.legend} />}
          >
            {(active) => (ring.length ? <Doughnut segments={ring} size={layout.ring} active={active} /> : null)}
          </Plot>
        ) : null}
      </Tile>
      <Tile layout={layout} className="@min-[360px]:col-span-2 @min-[640px]:col-span-1" title="Biggest" value={words.biggest.value} sub={words.biggest.sub} testId="tile-biggest">
        {plots ? (
          <Plot said={biggestSaid(top)} count={top.length} kind="bar" height={layout.plot} tip={(i) => biggestTip(top[i] as Row)} testId="tile-biggest">
            {(active) => (top.length ? <SizeBars rows={top} axes={layout.axes} active={active} /> : null)}
          </Plot>
        ) : null}
      </Tile>
    </div>
  )
}

function StackedBars({ stacks, axes, active }: { stacks: readonly Stack[]; axes: boolean; active: number | null }) {
  const top = niceTop(Math.max(1, ...stacks.map((one) => one.total)))
  return (
    <ChartContainer config={STACKED} className="aspect-auto size-full">
      <BarChart data={stacks as Stack[]} margin={axes ? AXES_MARGIN : MARGIN} barCategoryGap={axes ? '20%' : 2} accessibilityLayer={false}>
        {axes ? <CartesianGrid vertical={false} stroke="var(--border)" /> : null}
        <YAxis hide={!axes} width={axes ? 48 : 0} domain={[0, top]} ticks={[0, top]} tickFormatter={(v: number) => bytesSaid(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
        <XAxis hide={!axes} dataKey="label" tickLine={false} axisLine={false} height={16} tick={{ fontSize: 10 }} interval={0} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
        {GROUPS.map((group, g) => (
          <Bar key={group} dataKey={group} stackId="disk" fill={`var(--color-${group})`} isAnimationActive={false} radius={g === GROUPS.length - 1 ? [2, 2, 0, 0] : 0}>
            {stacks.map((one, i) => (
              <Cell key={one.key} fillOpacity={active === null || active === i ? 1 : 0.4} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}

function SizeBars({ rows, axes, active }: { rows: readonly Row[]; axes: boolean; active: number | null }) {
  const data = rows.map((row) => ({ key: row.path, label: row.branch ?? row.path, bytes: row.bytes ?? 0, group: row.group }))
  const top = niceTop(Math.max(1, ...data.map((one) => one.bytes)))
  return (
    <ChartContainer config={SIZES} className="aspect-auto size-full">
      <BarChart data={data} margin={axes ? AXES_MARGIN : MARGIN} barCategoryGap={axes ? '20%' : 2} accessibilityLayer={false}>
        {axes ? <CartesianGrid vertical={false} stroke="var(--border)" /> : null}
        <YAxis hide={!axes} width={axes ? 48 : 0} domain={[0, top]} ticks={[0, top]} tickFormatter={(v: number) => bytesSaid(v)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
        <XAxis hide dataKey="label" />
        <Bar dataKey="bytes" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((one, i) => (
            <Cell key={one.key} fill={GROUP_COLOUR[one.group]} fillOpacity={active === null || active === i ? 1 : 0.4} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

function Doughnut({ segments, size, active }: { segments: readonly Segment[]; size: number; active: number | null }) {
  const config: ChartConfig = Object.fromEntries(segments.map((one) => [one.key, { label: one.label, color: GROUP_COLOUR[one.key] }]))
  return (
    <ChartContainer config={config} className="aspect-square size-full" initialDimension={{ width: size, height: size }}>
      <PieChart accessibilityLayer={false}>
        <Pie data={segments as Segment[]} dataKey="bytes" nameKey="label" innerRadius={(size / 2) * HOLE} outerRadius={size / 2 - 1} startAngle={90} endAngle={-270} stroke="var(--background)" strokeWidth={1} isAnimationActive={false}>
          {segments.map((one, i) => (
            <Cell key={one.key} fill={`var(--color-${one.key})`} fillOpacity={active === null || active === i ? 1 : 0.4} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}

/** The doughnut in words: each group, its size and share. Beside it when the tile has room, for screen readers when not. */
function Legend({ segments, shown }: { segments: readonly Segment[]; shown: boolean }) {
  return (
    <ul aria-label="Reclaimable, kept and active" className={shown ? 'flex min-w-0 flex-1 flex-col text-[11px] tabular-nums' : 'sr-only'} data-testid="tile-share-legend">
      {segments.map((one) => (
        <li key={one.key} className="flex min-w-0 items-center gap-1.5" style={shown ? { height: LEGEND_ROW, lineHeight: `${LEGEND_ROW}px` } : undefined}>
          <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: GROUP_COLOUR[one.key] }} />
          <span className="min-w-0 flex-1 truncate">{one.label}</span>
          <span className="text-muted-foreground shrink-0">
            {bytesSaid(one.bytes)} · {percent(one.fraction)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A short container's whole picture: one thin bar of reclaimable, kept and active, with its words for screen readers. */
function ThinBar({ segments }: { segments: readonly Segment[] }) {
  if (!segments.length) return null
  return (
    <div role="img" aria-label={segmentsSaid(segments)} className="flex h-1.5 w-full overflow-hidden rounded-full" data-testid="thin-bar">
      {segments.map((one) => (
        <span key={one.key} style={{ width: `${one.fraction * 100}%`, background: GROUP_COLOUR[one.key] }} />
      ))}
    </div>
  )
}

function Tile({ layout, className = '', title, value, sub, testId, children }: { layout: TileLayout; className?: string; title: string; value: string; sub: string; testId: string; children: React.ReactNode }) {
  const words = (
    <p className={`text-muted-foreground min-w-0 truncate text-[11px] ${layout.compact ? 'flex-1' : ''}`} style={{ lineHeight: `${layout.compact ? HEAD_HEIGHT : SUB_HEIGHT}px` }} title={sub}>
      {sub}
    </p>
  )
  return (
    <section aria-label={title} className={`bg-background flex min-w-0 flex-col ${className}`} style={{ padding: `${PAD_Y}px ${PAD_X}px`, rowGap: ROW_GAP }} data-testid={testId}>
      <div className="flex min-w-0 items-baseline justify-between gap-2" style={{ height: HEAD_HEIGHT, lineHeight: `${HEAD_HEIGHT}px` }}>
        <h2 className="text-muted-foreground shrink-0 text-[10px] font-medium tracking-wide uppercase">{title}</h2>
        {layout.compact ? words : null}
        <p className="min-w-0 truncate text-sm font-semibold tabular-nums" data-testid={`${testId}-value`} title={value}>
          {value}
        </p>
      </div>
      {layout.compact ? null : words}
      {children}
    </section>
  )
}
