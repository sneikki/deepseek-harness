/**
 * Subagent lanes: one vertical lane per subagent from its spawn record to its
 * end, drawn in the transcript gutter. Pure derivation over record indexes; a
 * row asks for the state of every lane over the indexes it stands for, so the
 * lanes stay continuous through hidden (filtered, collapsed) rows.
 */

import type { TrajectoryTurnModel } from './layout.ts'
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
  /** Packed track; slots at or above {@link AGENT_LANE_MAX_VISIBLE} are not drawn. */
  slot: number
  /** Ascending by index. */
  events: readonly AgentLaneEvent[]
}

export interface AgentLaneModel {
  lanes: readonly AgentLane[]
  /** Slots actually drawn: sets the gutter width. */
  slots: number
}

export type AgentLaneState = 'pass' | 'start' | 'event' | 'end'

/** What one row shows for one lane. */
export interface AgentLaneCell {
  lane: AgentLane
  state: AgentLaneState
  /** The strongest event in the row's range (`event` state), else nothing. */
  event?: AgentLaneEvent
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
  if (lifecycles.length === 0) return { lanes: [], slots: 0 }
  const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
    .sort((left, right) => left.index - right.index)
  const lastIndex = cells.at(-1)?.index ?? 0
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
      endIndex = lifecycle.endIndex
        ?? (endedAt === null
          ? lastIndex
          : cells.find(cell => cell.startedAt != null && cell.startedAt >= endedAt)?.index ?? lastIndex)
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
      events,
    }
  })
  // A lane owns its end row, so the next one starts a row later; huge cap: hidden slots still stay apart.
  const packed = packTimelineTracks(
    drafts.map(draft => ({ start: draft.startIndex, end: draft.endIndex + 1 })),
    Number.MAX_SAFE_INTEGER,
  )
  const lanes = drafts.map((draft, position): AgentLane => ({ ...draft, slot: packed.tracks[position] ?? 0 }))
  return { lanes, slots: Math.min(AGENT_LANE_MAX_VISIBLE, packed.count) }
}

/**
 * State of every lane on one row.
 * @param model - Derived lanes.
 * @param previousIndex - Index of the row shown before this one (hidden rows between fold into this row); null for the first.
 * @param index - Record index of this row.
 * @returns Active lanes (drawn slots and hidden ones), lane order.
 */
export function agentLaneCells(model: AgentLaneModel, previousIndex: number | null, index: number): AgentLaneCell[] {
  const low = previousIndex !== null && previousIndex < index ? previousIndex : index - 1
  const cells: AgentLaneCell[] = []
  for (const lane of model.lanes) {
    if (lane.startIndex > index || lane.endIndex <= low) continue
    const started = lane.startIndex > low
    if (lane.endIndex <= index && lane.status !== 'running') cells.push({ lane, state: 'end' })
    else if (started) cells.push({ lane, state: 'start' })
    else {
      let event: AgentLaneEvent | undefined
      for (const candidate of lane.events) {
        if (candidate.index <= low) continue
        if (candidate.index > index) break
        if (event === undefined || EVENT_RANK[candidate.kind] < EVENT_RANK[event.kind]) event = candidate
      }
      cells.push(event === undefined ? { lane, state: 'pass' } : { lane, state: 'event', event })
    }
  }
  return cells
}
