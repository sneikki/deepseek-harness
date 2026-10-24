/**
 * Subagent lanes: one vertical lane per subagent from its spawn record to its
 * end, drawn in the right-side lane zone beside the cards. Pure derivation over record indexes; a
 * row asks for the state of every lane over the indexes it stands for, so the
 * lanes stay continuous through hidden (filtered, collapsed) rows.
 */

import type { TrajectoryTurnModel } from './layout.ts'
import { IDLE_NOTE_MS } from './trajectory-agent-bar.ts'
import type { AgentTreeRow } from './trajectory-agent-tree.ts'
import type { TrajectorySubagentLifecycle } from './trajectory-subagent.ts'
import { packTimelineTracks } from './timeline.ts'

/** Lanes drawn side by side; further concurrent lanes fold into "+N". */
export const AGENT_LANE_MAX_VISIBLE = 6

/** CSS colour per slot; slot = lane track, so concurrent lanes never share a colour. */
export const AGENT_LANE_COLORS: readonly string[] = [
  'var(--amv-accent)',
  'var(--amv-act-code)',
  'var(--amv-act-deploy)',
  'var(--amv-act-review)',
  'var(--amv-act-test)',
  'var(--amv-text-2)',
]

export type AgentLaneStatus = 'running' | 'done' | 'failed' | 'interrupted'

/** Moments on a lane, strongest first (a row shows only the strongest in its range). */
export type AgentLaneEventKind = 'interrupt' | 'resume' | 'settle' | 'send' | 'report'

const EVENT_RANK: Record<AgentLaneEventKind, number> = { interrupt: 0, resume: 1, settle: 2, send: 3, report: 4 }

export interface AgentLaneEvent {
  /** Record index. */
  index: number
  kind: AgentLaneEventKind
}

export interface AgentLane {
  id: string
  /** `AgentTreeRow.sessionId` of the matching AGENTS row (what the waterfall highlights). */
  rowId: string
  label: string
  shortId: string
  status: AgentLaneStatus
  /** Spawn record index. */
  startIndex: number
  /** Index of the record the lane ends on; `Infinity` while running. */
  endIndex: number
  /** The end row is the agent's own settle record, not a row inferred from its end time. */
  endIsRecord?: true
  /** Packed track; slots at or above {@link AGENT_LANE_MAX_VISIBLE} are not drawn. */
  slot: number
  /** Ascending by index. */
  events: readonly AgentLaneEvent[]
  /** The agent's turns (wall ms); absent = no timing, the lane is always solid. */
  turns?: AgentTreeRow['turns']
}

export interface AgentLaneModel {
  lanes: readonly AgentLane[]
  /** Slots actually drawn: sets the lane zone width. */
  slots: number
  /** Lanes folded into "+N" (slot at or above the visible cap). */
  overflow: number
}

export type AgentLaneState = 'pass' | 'start' | 'event' | 'end'

/** What one row shows for one lane. */
export interface AgentLaneCell {
  lane: AgentLane
  state: AgentLaneState
  /** The strongest event in the row's range (`event` state), else nothing. */
  event?: AgentLaneEvent
  /** The row falls while the agent is idle (between turns, or waiting after its last): drawn dashed. */
  idle?: true
}

/**
 * True when `at` (wall ms) lies after a closed turn and before the next one starts, if any,
 * in a gap of at least {@link IDLE_NOTE_MS}: the same idle the agent bar labels.
 */
function inIdleGap(turns: AgentLane['turns'], at: number | null): boolean {
  if (turns === undefined || at === null) return false
  return turns.some((turn, i) => {
    const next = turns[i + 1]
    if (turn.end === null || at <= turn.end) return false
    return next === undefined ? at - turn.end >= IDLE_NOTE_MS : at < next.start && next.start - turn.end >= IDLE_NOTE_MS
  })
}

const STATUS_OF = {
  running: 'running', finished: 'done', failed: 'failed', interrupted: 'interrupted',
} as const

/**
 * Derive the lanes of every subagent the transcript shows.
 * @param turns - Annotated layout turns (`cell.subagent` set by the layout).
 * @param lifecycles - `trajectorySubagentLifecycles(turns)`.
 * @param agentRows - AGENTS rows: label, status, end time and the row to highlight.
 * @returns Lanes packed into slots, in spawn order.
 */
export function deriveAgentLanes(
  turns: readonly TrajectoryTurnModel[],
  lifecycles: readonly TrajectorySubagentLifecycle[],
  agentRows: readonly AgentTreeRow[] = [],
): AgentLaneModel {
  if (lifecycles.length === 0) return { lanes: [], slots: 0, overflow: 0 }
  const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
    .sort((left, right) => left.index - right.index)
  const eventsById = new Map<string, AgentLaneEvent[]>()
  const finishById = new Map<string, number[]>()
  const push = (id: string, event: AgentLaneEvent) => {
    const list = eventsById.get(id)
    if (list === undefined) eventsById.set(id, [event])
    else list.push(event)
  }
  // Settled agents the parent has woken again (a delivered message after a settle).
  const settled = new Set<string>()
  for (const cell of cells) {
    const info = cell.subagent
    if (info === undefined) continue
    if (info.phase === 'report') push(info.id, { index: cell.index, kind: 'report' })
    else if (info.phase === 'finish') {
      settled.add(info.id)
      const list = finishById.get(info.id)
      if (list === undefined) finishById.set(info.id, [cell.index])
      else list.push(cell.index)
    } else if (info.phase === 'control') {
      const interrupt = cell.toolName === 'interrupt_agent'
      const delivered = cell.outputDetail !== undefined && cell.isError !== true
      const woke = !interrupt && delivered && settled.delete(info.id)
      push(info.id, { index: cell.index, kind: interrupt ? 'interrupt' : woke ? 'resume' : 'send' })
    }
  }
  const rowByStart = new Map(agentRows.filter(row => row.depth === 1 && row.startIndex !== null).map(row => [row.startIndex, row]))
  const rowById = new Map(agentRows.map(row => [row.sessionId, row]))

  const drafts = lifecycles.map((lifecycle) => {
    const row = rowByStart.get(lifecycle.startIndex) ?? rowById.get(lifecycle.id)
    const own = STATUS_OF[lifecycle.status]
    // The AGENTS row knows more when the parent has no settle record (old or windowed sessions).
    const rowStatus = row === undefined || row.status === 'unknown' ? undefined : row.status
    const status: AgentLaneStatus = lifecycle.endIndex !== null || own !== 'running' ? own : rowStatus ?? own
    let endIndex = Number.POSITIVE_INFINITY
    if (status !== 'running') {
      const endedAt = lifecycle.endedAt ?? row?.endedAt ?? null
      // Without a settle record the lane ends at the first record after the agent's end time; with no end time,
      // or an end after every loaded record, the end is not on screen and the lane stays open (no end marker).
      endIndex = lifecycle.endIndex
        ?? (endedAt === null
          ? undefined
          : cells.find(cell => cell.startedAt != null && cell.startedAt >= endedAt)?.index)
        ?? Number.POSITIVE_INFINITY
    }
    const finishes = (finishById.get(lifecycle.id) ?? []).filter(index => index !== endIndex)
    const events = [
      ...(eventsById.get(lifecycle.id) ?? []),
      ...finishes.map((index): AgentLaneEvent => ({ index, kind: 'settle' })),
    ].sort((left, right) => left.index - right.index)
    const label = lifecycle.description === '' ? row?.label ?? lifecycle.shortId : lifecycle.description
    return {
      id: lifecycle.id,
      rowId: row?.sessionId ?? lifecycle.id,
      label,
      shortId: lifecycle.shortId,
      status,
      startIndex: lifecycle.startIndex,
      endIndex: Math.max(endIndex, lifecycle.startIndex),
      ...lifecycle.endIndex === null ? {} : { endIsRecord: true as const },
      events,
      ...row?.turns === undefined ? {} : { turns: row.turns },
    }
  })
  // A lane owns its end row, so the next one starts a row later; huge cap: hidden slots still stay apart.
  const packed = packTimelineTracks(
    drafts.map(draft => ({ start: draft.startIndex, end: draft.endIndex + 1 })),
    Number.MAX_SAFE_INTEGER,
  )
  const lanes = drafts.map((draft, position): AgentLane => ({ ...draft, slot: packed.tracks[position] ?? 0 }))
  return {
    lanes,
    slots: Math.min(AGENT_LANE_MAX_VISIBLE, packed.count),
    overflow: lanes.filter(lane => lane.slot >= AGENT_LANE_MAX_VISIBLE).length,
  }
}

/**
 * State of every lane on one row.
 * @param model - Derived lanes.
 * @param previousIndex - Index of the row shown before this one (hidden rows between fold into this row); null for the first.
 * @param index - Record index of this row.
 * @param at - The row record's wall-clock ms; decides `idle` against each lane's turns.
 * @returns Active lanes (drawn slots and hidden ones), lane order.
 */
export function agentLaneCells(
  model: AgentLaneModel,
  previousIndex: number | null,
  index: number,
  at: number | null = null,
): AgentLaneCell[] {
  const cells: AgentLaneCell[] = []
  const push = (cell: AgentLaneCell) => {
    // The end bend joins the outcome marker: a finished agent is not waiting.
    cells.push(cell.state !== 'end' && inIdleGap(cell.lane.turns, at) ? { ...cell, idle: true } : cell)
  }
  // A row older than the rows above it (system and request rows) sits inside whatever lanes are open there.
  if (previousIndex !== null && previousIndex >= index) {
    for (const lane of model.lanes) {
      if (lane.startIndex <= previousIndex && lane.endIndex > previousIndex) push({ lane, state: 'pass' })
    }
    return cells
  }
  const low = previousIndex ?? index - 1
  for (const lane of model.lanes) {
    if (lane.startIndex > index || lane.endIndex <= low) continue
    const started = lane.startIndex > low
    if (lane.endIndex <= index && lane.status !== 'running') push({ lane, state: 'end' })
    else if (started) push({ lane, state: 'start' })
    else {
      let event: AgentLaneEvent | undefined
      for (const candidate of lane.events) {
        if (candidate.index <= low) continue
        if (candidate.index > index) break
        if (event === undefined || EVENT_RANK[candidate.kind] < EVENT_RANK[event.kind]) event = candidate
      }
      push(event === undefined ? { lane, state: 'pass' } : { lane, state: 'event', event })
    }
  }
  return cells
}

/** Lane geometry, px. Lanes sit right of the card column; x runs from the cards' right edge. */
export const LANE_STROKE = 5
/** Centre-to-centre distance of neighbouring slots. */
export const LANE_PITCH = 10
/** Card edge to the centre of slot 0. */
export const LANE_ORIGIN = 22
/** Corner radius of a bend (stroke centre line). */
export const LANE_RADIUS = 6
/** Half height of the dent a lane makes into a card at an event. */
export const LANE_DENT = 9
/** Card edge to the centre of the station marker where a lane touches a card. */
export const LANE_PIN = 3

/** Centre x of a slot's lane. */
export const laneX = (slot: number): number => LANE_ORIGIN + slot * LANE_PITCH

/**
 * Width of the lane zone right of the cards (the table pads its card column by this minus the card gap).
 * @param model - Derived lanes.
 * @returns px; 0 without lanes. One extra slot holds the "+N" chip when lanes overflow the cap.
 */
export function laneZoneWidth(model: AgentLaneModel): number {
  if (model.slots === 0) return 0
  return Math.ceil(laneX(model.slots - 1) + LANE_STROKE / 2 + 6) + (model.overflow > 0 ? 24 : 0)
}

export interface LaneBend {
  /** SVG path in a box whose left edge is the card edge and whose top is `rise` above the card's header centre line. */
  d: string
  /** px between the box top and the header centre line (also where the straight lane stops or resumes). */
  rise: number
  height: number
}

/**
 * Rounded metro-style bend of one lane at its card's header line.
 * - `start`: leaves the card's right edge, turns down.
 * - `end`: comes down, turns left and stops at the card's right edge.
 * - `event`: comes down, dents left to the card's right edge, goes back out and on down.
 * @param state - Row state of the lane.
 * @param x - Centre x of the lane, {@link laneX}.
 * @returns the path to stroke, or undefined for a straight `pass`.
 */
export function laneBend(state: AgentLaneState, x: number): LaneBend | undefined {
  const r = LANE_RADIUS
  const arc = (sweep: 0 | 1, toX: number, toY: number) => `A${r} ${r} 0 0 ${sweep} ${toX} ${toY}`
  if (state === 'start') return { d: `M0 0H${x - r}${arc(1, x, r)}`, rise: 0, height: r }
  if (state === 'end') return { d: `M${x} 0${arc(1, x - r, r)}H${LANE_PIN}`, rise: r, height: r }
  if (state === 'pass') return undefined
  const d = LANE_DENT
  const rise = d + r
  return {
    d: `M${x} 0${arc(1, x - r, r)}H${LANE_PIN + r}${arc(0, LANE_PIN, 2 * r)}V${2 * d}`
      + `${arc(0, LANE_PIN + r, 2 * d + r)}H${x - r}${arc(1, x, 2 * rise)}`,
    rise,
    height: 2 * rise,
  }
}
