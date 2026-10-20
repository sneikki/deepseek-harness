/** Operation-sequence and recorded-time projections for the trajectory overview. */

import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryTranslate } from './locales.ts'
import { trajectorySubagentLifecycles, type TrajectorySubagentLifecycle } from './trajectory-subagent.ts'
import { formatDurationMillis } from './trajectory-record.ts'
import type { TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'

/** Horizontal projection used by the trajectory timeline. */
export type TrajectoryTimelineMode = 'sequence' | 'duration' | 'time' | 'actual'

/** Inclusive selection in the active timeline projection's domain. */
export interface TrajectoryTimeRange {
  start: number
  end: number
}

/** One ledger record projected into the active timeline domain. */
export interface TrajectoryTimelineSpan extends TrajectoryTimeRange {
  index: number
  isError: boolean
  kind: TrajectoryCellKind
  label: string
  lane: number
  toolName?: string | undefined
}

/** One turn boundary in the active timeline domain. */
export interface TrajectoryTimelineTurnBoundary {
  turn: number
  time: number
}

/** One subagent bar in the active timeline domain; `end` is the model end while it runs. */
export interface TrajectoryTimelineSubagent extends TrajectoryTimeRange {
  lifecycle: TrajectorySubagentLifecycle
  /** Record the bar focuses on click. */
  index: number
}

/** Full-domain model used by the overview. */
export interface TrajectoryTimelineModel extends TrajectoryTimeRange {
  spans: readonly TrajectoryTimelineSpan[]
  subagents: readonly TrajectoryTimelineSubagent[]
  turnBoundaries: readonly TrajectoryTimelineTurnBoundary[]
}

/**
 * Format a timeline duration as an integer-millisecond label.
 * @param milliseconds - Non-negative duration in milliseconds.
 * @param t - Trajectory locale translator.
 * @returns Millisecond label with thousands separators.
 */
export function formatTimelineOffset(
  milliseconds: number,
  t: TrajectoryTranslate,
): string {
  return formatDurationMillis(milliseconds, t)
}

function laneFor(kind: TrajectoryCellKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'thinking' || kind === 'message' || kind === 'compacted') return 1
  return 0
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

function cellRange(cell: TrajectoryCellProps): TrajectoryTimeRange | null {
  if (!finite(cell.startedAt)) return null
  const durationMs = finite(cell.timeSeconds)
    ? Math.max(0, cell.timeSeconds * 1_000)
    : 0
  return { start: cell.startedAt, end: cell.startedAt + durationMs }
}

/**
 * Project every visible record into a stable three-lane timeline.
 * @param turns - Unfiltered trajectory layout.
 * @param mode - Independent equal/recorded duration and compressed/complete time projection.
 * @returns Timeline model, or `null` when no record is visible.
 */
export function deriveTrajectoryTimeline(
  turns: readonly TrajectoryTurnModel[],
  mode: TrajectoryTimelineMode = 'sequence',
): TrajectoryTimelineModel | null {
  const model = deriveSpans(turns, mode)
  if (model === null) return null
  const byIndex = new Map(model.spans.map(span => [span.index, span]))
  const subagents = trajectorySubagentLifecycles(turns).flatMap((lifecycle) => {
    const first = byIndex.get(lifecycle.startIndex)
    if (first === undefined) return []
    const last = lifecycle.endIndex === null ? undefined : byIndex.get(lifecycle.endIndex)
    return [{
      lifecycle,
      index: first.index,
      start: first.start,
      end: lifecycle.endIndex === null
        ? model.end
        : Math.max(first.end, last?.end ?? first.end),
    }]
  })
  return { ...model, subagents }
}

function deriveSpans(
  turns: readonly TrajectoryTurnModel[],
  mode: TrajectoryTimelineMode,
): Omit<TrajectoryTimelineModel, 'subagents'> | null {
  if (mode !== 'sequence') {
    return deriveTimedTimeline(
      turns,
      mode === 'duration' || mode === 'actual',
      mode === 'duration',
    )
  }
  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []

  for (const turn of turns) {
    const cells = turn.groups.flatMap(group =>
      group.cells.filter(cell => cell.requestOnly !== true),
    )
    if (cells.length === 0) continue
    if (turn.turn !== null) {
      turnBoundaries.push({
        turn: turn.turn,
        time: spans.length,
      })
    }
    spans.push(...cells.map((cell, offset): TrajectoryTimelineSpan => ({
      start: spans.length + offset,
      end: spans.length + offset + 1,
      index: cell.index,
      isError: cell.isError === true,
      kind: cell.kind,
      label: cell.text,
      lane: laneFor(cell.kind),
      toolName: cell.toolName,
    })))
  }

  if (spans.length === 0) return null
  return {
    start: 0,
    end: spans.length,
    spans,
    turnBoundaries,
  }
}

function deriveTimedTimeline(
  turns: readonly TrajectoryTurnModel[],
  actualDuration: boolean,
  compressIdle: boolean,
): Omit<TrajectoryTimelineModel, 'subagents'> | null {
  const timedTurns = turns.flatMap((turn) => {
    const rawSpans = turn.groups.flatMap(group =>
      group.cells.flatMap((cell): TrajectoryTimelineSpan[] => {
        if (cell.requestOnly === true) return []
        const range = cellRange(cell)
        return range === null
          ? []
          : [{
            ...range,
            index: cell.index,
            isError: cell.isError === true,
            kind: cell.kind,
            label: cell.text,
            lane: laneFor(cell.kind),
            toolName: cell.toolName,
          }]
      }),
    )
    return rawSpans.length === 0 ? [] : [{ turn: turn.turn, rawSpans }]
  })
  const rawSpans = timedTurns.flatMap(turn => turn.rawSpans)
  if (rawSpans.length === 0) return null

  const removedIdleBySpan = new Map<TrajectoryTimelineSpan, number>()
  let removedIdle = 0
  let coveredUntil: number | null = null
  for (const span of [...rawSpans].sort((left, right) =>
    left.start - right.start || left.end - right.end)) {
    if (compressIdle && coveredUntil !== null && span.start > coveredUntil) {
      removedIdle += span.start - coveredUntil
    }
    removedIdleBySpan.set(span, removedIdle)
    coveredUntil = coveredUntil === null ? span.end : Math.max(coveredUntil, span.end)
  }

  const spans: TrajectoryTimelineSpan[] = []
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
  for (const turn of timedTurns) {
    const projected = turn.rawSpans.map((span): TrajectoryTimelineSpan => {
      const offset = removedIdleBySpan.get(span) ?? 0
      return {
        ...span,
        start: span.start - offset,
        end: (actualDuration ? span.end : span.start) - offset,
      }
    })
    spans.push(...projected)
    if (turn.turn !== null) {
      turnBoundaries.push({
        turn: turn.turn,
        time: Math.min(...projected.map(span => span.start)),
      })
    }
  }

  return {
    start: Math.min(...spans.map(span => span.start)),
    end: Math.max(...spans.map(span => span.end)),
    spans,
    turnBoundaries,
  }
}

/**
 * Identify records active at any point inside an inclusive selected interval.
 * @param turns - Unfiltered trajectory layout.
 * @param range - Selected interval in the active projection.
 * @param mode - Independent equal/recorded duration and compressed/complete time projection.
 * @returns Record indexes inside the focus interval.
 */
export function trajectoryTimelineFocusIndexes(
  turns: readonly TrajectoryTurnModel[],
  range: TrajectoryTimeRange,
  mode: TrajectoryTimelineMode = 'sequence',
): ReadonlySet<number> {
  const model = deriveTrajectoryTimeline(turns, mode)
  return new Set(
    model?.spans
      .filter(span => span.start <= range.end && span.end >= range.start)
      .map(span => span.index),
  )
}

/** Most stacked tracks one lane shows; later overlaps share the last track and count as overflow. */
export const TIMELINE_MAX_TRACKS = 8

/**
 * Greedy interval partitioning: each item takes the first track whose last interval ended.
 * @param items - Intervals in any order; touching intervals share a track.
 * @param cap - Maximum tracks; items beyond it land on the last track.
 * @returns Track per item (input order), tracks used, and how many items overflowed the cap.
 */
export function packTimelineTracks(
  items: readonly TrajectoryTimeRange[],
  cap: number = TIMELINE_MAX_TRACKS,
): { tracks: number[]; count: number; overflow: number } {
  const ends: number[] = []
  const tracks: number[] = Array.from({ length: items.length }, () => 0)
  let overflow = 0
  const order = items.map((item, position) => ({ item, position }))
    .sort((left, right) =>
      left.item.start - right.item.start || left.item.end - right.item.end
      || left.position - right.position)
  for (const { item, position } of order) {
    let track = ends.findIndex(end => end <= item.start)
    if (track === -1) {
      if (ends.length < cap) track = ends.length
      else { track = cap - 1; overflow++ }
    }
    ends[track] = Math.max(ends[track] ?? Number.NEGATIVE_INFINITY, item.end)
    tracks[position] = track
  }
  return { tracks, count: Math.max(1, ends.length), overflow }
}

/** Vertical geometry of one timeline lane, in px inside the lane area. */
export interface TrajectoryTimelineLane {
  top: number
  height: number
  tracks: number
  overflow: number
  /** Distance between track tops. */
  pitch: number
  /** Bar height. */
  bar: number
}

/** Stacked-track placement for every span and subagent bar plus lane geometry. */
export interface TrajectoryTimelineLanes {
  lanes: readonly TrajectoryTimelineLane[]
  spanTrack: ReadonlyMap<TrajectoryTimelineSpan, number>
  subagentTrack: readonly number[]
  /** Total plot height in px: lane area plus its top and bottom padding. */
  plotHeight: number
}

/**
 * Pack overlapping spans (per lane) and subagent bars into stacked tracks.
 * @param model - Timeline model in the active projection.
 * @returns Track per record plus lane tops/heights; a one-track lane keeps the roomy 10px bar.
 */
export function layoutTimelineLanes(model: TrajectoryTimelineModel): TrajectoryTimelineLanes {
  const groups: { items: readonly TrajectoryTimeRange[] }[] = [0, 1, 2].map(lane => ({
    items: model.spans.filter(span => span.lane === lane),
  }))
  if (model.subagents.length > 0) groups.push({ items: model.subagents })
  const spanTrack = new Map<TrajectoryTimelineSpan, number>()
  let subagentTrack: readonly number[] = []
  let top = 0
  const lanes = groups.map((group, lane): TrajectoryTimelineLane => {
    const packed = packTimelineTracks(group.items)
    group.items.forEach((item, position) => {
      if (lane < 3) spanTrack.set(item as TrajectoryTimelineSpan, packed.tracks[position] ?? 0)
    })
    if (lane === 3) subagentTrack = packed.tracks
    const single = packed.count === 1
    const result: TrajectoryTimelineLane = {
      top,
      tracks: packed.count,
      overflow: packed.overflow,
      pitch: single ? 14 : 8,
      bar: single ? 10 : 6,
      height: single ? 14 : packed.count * 8 + 4,
    }
    top += result.height
    return result
  })
  return { lanes, spanTrack, subagentTrack, plotHeight: top + 8 }
}
