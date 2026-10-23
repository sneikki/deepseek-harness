/** Waterfall bar geometry and duration texts of one agent row; the spawn card reads the same texts. */

import type { TrajectoryTranslate } from './locales.ts'
import { formatTurnDuration } from './trajectory-record.ts'
import { reasonStatus, type AgentTreeRow, type AgentTreeStatus } from './trajectory-agent-tree.ts'

/** Idle below this is not worth a "work · wall" label. */
const IDLE_NOTE_MS = 60_000

export const STATUS_KEY = {
  running: 'timeline.subagentRunning',
  done: 'timeline.subagentFinished',
  failed: 'timeline.subagentFailed',
  interrupted: 'timeline.subagentInterrupted',
  unknown: 'timeline.agentUnknown',
} as const satisfies Record<AgentTreeStatus, string>

export interface AgentBarSpan {
  start: number
  end: number
}

/** Solid turn segments and the dashed idle gaps between them, in the overview's domain units. */
export interface AgentBarParts {
  segments: AgentBarSpan[]
  gaps: AgentBarSpan[]
}

/**
 * Lay out a row's turns on the overview's x scale.
 * @param row - Agent row.
 * @param toDomain - Wall-clock ms to domain units (Duration mode compresses idle, so gaps may be short).
 * @param domainEnd - Where a running turn stops.
 * @returns the parts, or null when the row has no turns (draw today's single bar).
 */
export function agentBarParts(
  row: AgentTreeRow,
  toDomain: (wall: number) => number,
  domainEnd: number,
): AgentBarParts | null {
  const { turns } = row
  if (turns === undefined || turns.length === 0) return null
  const segments = turns.map((turn) => {
    const start = toDomain(turn.start)
    return { start, end: turn.end === null ? Math.max(start, domainEnd) : Math.max(start, toDomain(turn.end)) }
  })
  const gaps: AgentBarSpan[] = []
  segments.forEach((after, index) => {
    const before = segments[index - 1]
    if (before !== undefined && after.start > before.end) gaps.push({ start: before.end, end: after.start })
  })
  return { segments, gaps }
}

const wallMs = (row: AgentTreeRow): number | null =>
  row.startedAt !== null && row.endedAt !== null ? row.endedAt - row.startedAt : null

/**
 * "55 min work · 22 h" when the agent idled, else the plain duration.
 * @param row - Agent row.
 * @param t - Trajectory locale translator.
 * @returns the text, or null when the row has neither activity nor an interval.
 */
export function agentDurationText(row: AgentTreeRow, t: TrajectoryTranslate): string | null {
  const wall = wallMs(row)
  const work = row.activeMs ?? wall
  if (work === null) return null
  if (row.activeMs !== null && wall !== null && wall - row.activeMs >= IDLE_NOTE_MS) {
    return t('timeline.agentWorkWall', { work: formatTurnDuration(row.activeMs, t), wall: formatTurnDuration(wall, t) })
  }
  return formatTurnDuration(work, t)
}

/**
 * Tooltip text: name, status with wall and active time, then each turn and the idle between.
 * @param row - Agent row.
 * @param t - Trajectory locale translator.
 * @returns the lines joined by newlines.
 */
export function agentTooltip(row: AgentTreeRow, t: TrajectoryTranslate): string {
  const wall = wallMs(row)
  const lines = [
    `${row.label} · ${row.shortId}`,
    [
      t(STATUS_KEY[row.status]),
      wall === null ? null : t('timeline.agentWall', { duration: formatTurnDuration(wall, t) }),
      row.activeMs === null ? null : t('timeline.agentActive', { duration: formatTurnDuration(row.activeMs, t) }),
    ].filter(part => part !== null).join(' · '),
  ]
  const turns = row.turns ?? []
  turns.forEach((turn, index) => {
    const previous = turns[index - 1]
    if (previous?.end != null && turn.start > previous.end) {
      lines.push(t('timeline.agentIdle', { duration: formatTurnDuration(turn.start - previous.end, t) }))
    }
    lines.push([
      t('timeline.agentTurn', { n: index + 1 }),
      turn.end === null ? null : formatTurnDuration(turn.end - turn.start, t),
      t(STATUS_KEY[turn.reason === null ? 'running' : reasonStatus(turn.reason)]),
    ].filter(part => part !== null).join(' · '))
  })
  return lines.join('\n')
}
