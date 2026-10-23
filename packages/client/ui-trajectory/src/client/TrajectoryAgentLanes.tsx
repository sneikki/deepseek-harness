/**
 * The subagent lanes of one transcript row: thick metro-style lines right of the card column.
 * A lane leaves its spawn card's right edge and turns down; at each event it dents back into that
 * card's right edge (a station marker sits there); the end card is where it bends in and stops.
 */

import { memo, type CSSProperties } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import {
  AGENT_LANE_COLORS,
  AGENT_LANE_MAX_VISIBLE,
  LANE_PIN,
  LANE_STROKE,
  laneBend,
  laneX,
  type AgentLane,
  type AgentLaneCell,
  type AgentLaneEventKind,
} from './trajectory-agent-lanes.ts'
import css from './TrajectoryAgentLanes.module.css'

const STATUS_KEY = {
  running: 'timeline.subagentRunning',
  done: 'timeline.subagentFinished',
  failed: 'timeline.subagentFailed',
  interrupted: 'timeline.subagentInterrupted',
} as const

const EVENT_KEY = {
  report: 'lane.report', send: 'lane.send', interrupt: 'lane.interrupt', resume: 'lane.resume', settle: 'lane.settle',
} as const

const GLYPH: Record<AgentLaneEventKind | 'done' | 'failed', string> = {
  report: 'M9 6H3M5.5 3.5 3 6l2.5 2.5',
  send: 'M3 6h6M6.5 3.5 9 6 6.5 8.5',
  interrupt: 'M4 4h4v4H4z',
  resume: 'M4.5 3.5v5l4-2.5z',
  settle: 'M4.5 3.5v5M7.5 3.5v5',
  done: 'M3.2 6.3 5.2 8.3 8.9 4',
  failed: 'M4 4l4 4M8 4l-4 4',
}

/** Station marker diameter, px (matches `.marker` in the stylesheet). */
const MARKER_PX = 13

function Marker({ kind, title, left, onClick }: { kind: keyof typeof GLYPH; title: string; left: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className={css.marker}
      data-marker={kind}
      aria-label={title}
      style={{ left }}
      onClick={(event) => { event.stopPropagation(); onClick() }}
      onDoubleClick={(event) => { event.stopPropagation() }}
    >
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={GLYPH[kind]} />
      </svg>
    </button>
  )
}

export interface TrajectoryAgentLanesProps {
  t: TrajectoryTranslate
  /** Active lanes on this row, from `agentLaneCells`. */
  cells: readonly AgentLaneCell[]
  onHover: (rowId: string | null) => void
  onSelect: (index: number) => void
}

const endMarker = (lane: AgentLane): 'done' | 'failed' => lane.status === 'done' ? 'done' : 'failed'

/** Lanes of one row; renders nothing for a row no lane crosses. */
export const TrajectoryAgentLanes = memo(function TrajectoryAgentLanes({
  t, cells, onHover, onSelect,
}: TrajectoryAgentLanesProps) {
  if (cells.length === 0) return null
  // Outer slots first: inner lanes paint over the connectors that cross them.
  const shown = cells.filter(cell => cell.lane.slot < AGENT_LANE_MAX_VISIBLE).sort((a, b) => b.lane.slot - a.lane.slot)
  const hidden = cells.filter(cell => cell.lane.slot >= AGENT_LANE_MAX_VISIBLE)
  const edge = hidden.some(cell => cell.state === 'start' || cell.state === 'end')
  return (
    <span className={css.lanes} data-agent-lanes aria-hidden={shown.length === 0 || undefined}>
      {shown.map(({ lane, state, event }) => {
        const status = t(STATUS_KEY[lane.status])
        const tip = t('lane.tip', { label: lane.label, status })
        const eventTitle = event === undefined ? undefined : `${tip} · ${t(EVENT_KEY[event.kind])}`
        const x = laneX(lane.slot)
        const bend = laneBend(state, x)
        const markerLeft = LANE_PIN - x - MARKER_PX / 2
        return (
          <Tooltip key={lane.id} label={tip} side="right" delayMs={150} portal>
            <span
              className={css.lane}
              data-state={state}
              data-status={lane.status}
              data-lane-row={lane.rowId}
              data-lane-id={lane.id}
              style={{
                '--lane': AGENT_LANE_COLORS[lane.slot],
                '--above': `${bend?.rise ?? 0}px`,
                '--below': `${bend === undefined ? 0 : bend.height - bend.rise}px`,
                left: x,
              } as CSSProperties}
              onMouseEnter={() => { onHover(lane.rowId) }}
              onMouseLeave={() => { onHover(null) }}
            >
              {state === 'pass' && <i className={css.line} data-part="whole" />}
              {(state === 'end' || state === 'event') && <i className={css.line} data-part="above" />}
              {(state === 'start' || state === 'event') && <i className={css.line} data-part="below" />}
              {bend !== undefined && (
                <svg
                  className={css.bend}
                  width={x + LANE_STROKE}
                  height={bend.height}
                  style={{ left: -x, top: `calc(var(--lane-y) - ${bend.rise}px)` }}
                  aria-hidden="true"
                >
                  <path d={bend.d} fill="none" strokeWidth={LANE_STROKE} />
                </svg>
              )}
              {state === 'event' && event !== undefined && (
                <Marker kind={event.kind} title={eventTitle ?? tip} left={markerLeft} onClick={() => { onSelect(event.index) }} />
              )}
              {state === 'end' && (
                <Marker kind={endMarker(lane)} title={tip} left={markerLeft} onClick={() => { onSelect(lane.endIndex) }} />
              )}
            </span>
          </Tooltip>
        )
      })}
      {hidden.length > 0 && edge && (
        <span
          className={css.more}
          role="img"
          aria-label={[t('lane.more', { count: hidden.length }), ...hidden.map(cell => cell.lane.label)].join(', ')}
          title={[t('lane.more', { count: hidden.length }), ...hidden.map(cell => cell.lane.label)].join('\n')}
          style={{ left: laneX(AGENT_LANE_MAX_VISIBLE - 1) + LANE_STROKE / 2 + 6 }}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  )
})
