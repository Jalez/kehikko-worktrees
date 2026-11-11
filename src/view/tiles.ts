/**
 * How the glance tiles are laid out at a size, and what pointing at a chart does. Pure: the page draws
 * it, the tests read it. After Monitor's and Queue's tiles, so every chart on a kehikko behaves alike.
 *
 * The tiles carry no card: a hairline between them and a tight padding. In one column a tile is a
 * compact row (title, words, number on one line, the plot under it). A narrow tile draws its plot
 * without axes. A short container (under `CHARTS_FROM` px tall) shows the tiles as words and a thin
 * bar only, no plots; a tall one (from `LIST_FROM`) adds the list of worktrees under them.
 */

/** From this tile width up, a chart has axes and gridlines. */
export const AXES_FROM = 260
export const SPARK_HEIGHT = 48
export const AXES_HEIGHT = 96
export const RING_WIDE = 96
export const RING_MID = 64
export const LEGEND_ROW = 14
export const DIVIDER = 1
export const PAD_X = 8
export const PAD_Y = 6
export const HEAD_HEIGHT = 20
export const SUB_HEIGHT = 16
export const ROW_GAP = 2
/** From this container height up, the tiles draw their charts; below it, words and a thin bar. */
export const CHARTS_FROM = 150
/** From this container height up, the list of worktrees shows under the tiles. */
export const LIST_FROM = 340

export type Level = 'words' | 'charts' | 'full'

/** How much the page shows in a box: words only when short, the charts, then the list too. Null (not measured): the charts. */
export function levelOf(box: { width: number; height: number } | null): Level {
  if (!box) return 'charts'
  if (box.height < CHARTS_FROM) return 'words'
  return box.height < LIST_FROM ? 'charts' : 'full'
}

export interface TileLayout {
  columns: number
  tile: number | null
  axes: boolean
  plot: number
  ring: number
  legend: boolean
  compact: boolean
}

export function columnsOf(width: number): number {
  return width < 360 ? 1 : width < 640 ? 2 : 3
}

export function tileLayout(width: number | null): TileLayout {
  if (width === null || width <= 0) return { columns: 1, tile: null, axes: false, plot: SPARK_HEIGHT, ring: SPARK_HEIGHT, legend: false, compact: true }
  const columns = columnsOf(width)
  const tile = Math.floor((width - DIVIDER * (columns - 1)) / columns)
  const axes = tile >= AXES_FROM
  const legend = tile >= 180
  return { columns, tile, axes, plot: axes ? AXES_HEIGHT : SPARK_HEIGHT, ring: axes ? RING_WIDE : legend ? RING_MID : SPARK_HEIGHT, legend, compact: columns === 1 }
}

/** A ring's plot row: as tall as its doughnut, or its list beside it when that is taller. */
export function ringRow(layout: Pick<TileLayout, 'ring' | 'legend'>, segments: number): number {
  return Math.max(layout.ring, layout.legend ? segments * LEGEND_ROW : 0)
}

/** The doughnut's hole, as a share of its radius. */
export const HOLE = 0.66

/* ---- pointing at a chart ---- */

/** Which point a pointer `x` px across a plot `width` px wide is on: the nearest point of a line, the bar it is over. */
export function indexAt(x: number, width: number, count: number, kind: 'line' | 'bar'): number | null {
  if (count <= 0 || width <= 0) return null
  const at = Math.min(1, Math.max(0, x / width))
  const index = kind === 'line' ? Math.round(at * (count - 1)) : Math.floor(at * count)
  return Math.min(count - 1, Math.max(0, index))
}

/**
 * Which segment of a doughnut `size` px square a pointer at (`x`, `y`) is on. Segments run clockwise
 * from twelve o'clock, as drawn; `fractions` add up to 1. Null in the hole or outside the ring.
 */
export function segmentAt(x: number, y: number, size: number, fractions: readonly number[], hole = HOLE): number | null {
  const r = size / 2
  const dx = x - r
  const dy = y - r
  const distance = Math.hypot(dx, dy)
  if (!fractions.length || distance > r || distance < r * hole) return null
  /* 0 at twelve o'clock, growing clockwise, in turns. */
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1
  let sum = 0
  for (let i = 0; i < fractions.length; i++) {
    sum += fractions[i] as number
    if (turn < sum) return i
  }
  return fractions.length - 1
}

/** Where a tooltip sits along its plot, so it never runs off the tile: under the point, kept inside. */
export function tipAlign(index: number, count: number): 'start' | 'center' | 'end' {
  if (count <= 1) return 'center'
  const at = index / (count - 1)
  return at < 1 / 3 ? 'start' : at > 2 / 3 ? 'end' : 'center'
}

/** The space between a tooltip and its plot, in px. */
export const TIP_GAP = 4

/**
 * Whether a tooltip goes above its plot or below it — outside the plot either way, so it never lies
 * over the chart's own labels. Above when it fits under the top of what clips the page (`room`: the
 * px from there to the plot's top), else below.
 */
export function tipSide(room: number, tipHeight: number): 'above' | 'below' {
  return room >= tipHeight + TIP_GAP ? 'above' : 'below'
}

/** The key that moves the point a chart's tooltip is on: the next index, or null to close it. */
export function stepped(key: string, index: number | null, count: number): number | null | undefined {
  if (!count) return undefined
  const from = index ?? count - 1
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(count - 1, index === null ? from : from + 1)
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, index === null ? from : from - 1)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'Escape') return null
  return undefined
}

/* ---- what a tooltip says ---- */

/**
 * A tooltip: three short lines at most. The value first (drawn bold), then what or whose it is, then
 * a muted note — the time of the point, or a second figure. An empty line is left out.
 */
export interface Tip {
  value: string
  detail: string
  note: string
}

/** The longest line a tooltip holds, in characters: it fits about 15 rem at 12 px without wrapping. */
export const TIP_LINE_MAX = 28

/** A tooltip's lines, in order, none empty. */
export const tipLines = (tip: Tip): string[] => [tip.value, tip.detail, tip.note].filter(Boolean)

/** A name cut to fit a tooltip's line. */
export const clip = (text: string, most = TIP_LINE_MAX): string => (text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`)

export const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })


/** The top of a y-axis: a round number at or above the highest value. */
export function niceTop(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= max) return Math.round(step * power * 1000) / 1000
  return 10 * power
}
