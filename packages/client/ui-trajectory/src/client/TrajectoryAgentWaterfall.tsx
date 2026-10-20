/** Waterfall of the whole subagent tree under the timeline overview. */

import { memo, useMemo, useState, type CSSProperties } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import { formatTimelineOffset } from './timeline.ts'
import type { AgentTreeRow } from './trajectory-agent-tree.ts'
import css from './TrajectoryAgentWaterfall.module.css'

const DEFAULT_EXPAND_ALL_LIMIT = 12
const TOOLTIP_DELAY_MS = 500
const STATUS_KEY = {
  running: 'timeline.subagentRunning',
  done: 'timeline.subagentFinished',
  failed: 'timeline.subagentFailed',
  interrupted: 'timeline.subagentInterrupted',
  unknown: 'timeline.agentUnknown',
} as const

/** Props of the waterfall; the x scale is the overview's own domain and zoom. */
export interface TrajectoryAgentWaterfallProps {
  t: TrajectoryTranslate
  rows: readonly AgentTreeRow[]
  /** Visible domain start/length and the full-domain end (open-ended bars stop there). */
  domainStart: number
  domainDuration: number
  domainEnd: number
  /** Wall-clock ms to the overview's domain units. */
  toDomain: (wall: number) => number
  onRecordSelect?: ((index: number) => void) | undefined
  onOpenSession?: ((sessionId: string) => void) | undefined
  /** Highlight states shared with the overview: selected record, search hits, brushed range (domain units). */
  selectedIndex?: number | null
  searchMatchIndexes?: ReadonlySet<number> | null
  activeRange?: { start: number; end: number } | null
}

function StatusIcon({ status }: { status: AgentTreeRow['status'] }) {
  return (
    <span className={css.icon} data-status={status} aria-hidden="true">
      {status === 'done' ? '✓' : status === 'failed' ? '×' : null}
    </span>
  )
}

/** Collapsible agent-tree waterfall, one 22px row per agent in depth-first order. */
export const TrajectoryAgentWaterfall = memo(function TrajectoryAgentWaterfall({
  t, rows, domainStart, domainDuration, domainEnd, toDomain, onRecordSelect, onOpenSession,
  selectedIndex = null, searchMatchIndexes = null, activeRange = null,
}: TrajectoryAgentWaterfallProps) {
  const [open, setOpen] = useState(true)
  // Ids whose expansion differs from the default.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const expandAll = rows.length <= DEFAULT_EXPAND_ALL_LIMIT
  const isExpanded = (row: AgentTreeRow): boolean =>
    (expandAll || row.depth <= 1) !== flipped.has(row.sessionId)
  const visible = useMemo(() => {
    const result: { row: AgentTreeRow; ancestor: AgentTreeRow }[] = []
    let top: AgentTreeRow | null = null
    let hideDepth = Number.POSITIVE_INFINITY
    for (const row of rows) {
      if (row.depth === 1) top = row
      if (row.depth > hideDepth) continue
      hideDepth = Number.POSITIVE_INFINITY
      result.push({ row, ancestor: top ?? row })
      if (row.hasChildren && !isExpanded(row)) hideDepth = row.depth
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, flipped, expandAll])
  if (rows.length === 0) return null

  const toggle = (id: string) => {
    setFlipped((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const fraction = (wall: number) => (toDomain(wall) - domainStart) / domainDuration

  return (
    <div className={css.root} data-testid="agent-waterfall">
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={t('timeline.agentsToggle')}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.headerChevron} data-open={open || undefined} aria-hidden="true" />
        {t('timeline.agentsSection', { count: rows.length })}
      </button>
      {open && (
        <div className={css.rows} role="tree">
          {visible.map(({ row, ancestor }) => {
            const startedAt = row.startedAt
            const timed = startedAt !== null
            const end = row.endedAt ?? (row.status === 'running' ? domainEnd : null)
            const left = timed ? fraction(startedAt) : 0
            const right = timed && end !== null ? fraction(end) : left
            const wallMs = timed && row.endedAt !== null ? row.endedAt - startedAt : null
            const status = t(STATUS_KEY[row.status])
            const tip = [
              `${row.label} · ${row.shortId}`,
              [
                status,
                wallMs === null ? null : t('timeline.agentWall', { duration: formatTimelineOffset(wallMs, t) }),
                row.activeMs === null ? null : t('timeline.agentActive', { duration: formatTimelineOffset(row.activeMs, t) }),
              ].filter(part => part !== null).join(' · '),
            ].join('\n')
            const current = selectedIndex !== null
              && (row.startIndex === selectedIndex || ancestor.startIndex === selectedIndex)
            const match = searchMatchIndexes === null
              ? undefined
              : row.startIndex !== null && searchMatchIndexes.has(row.startIndex) ? 'true' : 'false'
            const inRange = activeRange === null || !timed
              ? undefined
              : toDomain(startedAt) <= activeRange.end && toDomain(end ?? startedAt) >= activeRange.start
                ? 'true'
                : 'false'
            const selectable = ancestor.startIndex != null
            return (
              <Tooltip key={row.sessionId} label={() => tip} side="bottom" delayMs={TOOLTIP_DELAY_MS}>
                <div
                  role="treeitem"
                  aria-level={row.depth}
                  aria-expanded={row.hasChildren ? isExpanded(row) : undefined}
                  className={css.row}
                  data-status={row.status}
                  data-agent-id={row.sessionId}
                  data-selectable={selectable || undefined}
                  data-current={current || undefined}
                  data-search-match={match}
                  data-selected={inRange}
                  onClick={() => {
                    if (ancestor.startIndex != null) onRecordSelect?.(ancestor.startIndex)
                  }}
                >
                  <div className={css.name} style={{ paddingLeft: (row.depth - 1) * 12 }}>
                    {row.hasChildren
                      ? (
                        <button
                          type="button"
                          className={css.chevron}
                          data-open={isExpanded(row) || undefined}
                          aria-label={t('timeline.agentsToggle')}
                          onClick={(event) => { event.stopPropagation(); toggle(row.sessionId) }}
                        />
                      )
                      : <span className={css.chevronSpace} />}
                    <StatusIcon status={row.status} />
                    <span className={css.label}>{row.label}</span>
                    <span className={css.id}>{row.shortId}</span>
                    {onOpenSession !== undefined && (
                      <button
                        type="button"
                        className={css.openButton}
                        aria-label={t('timeline.agentOpen')}
                        onClick={(event) => { event.stopPropagation(); onOpenSession(row.sessionId) }}
                      >
                        ↗
                      </button>
                    )}
                  </div>
                  <div className={css.track}>
                    {timed && (
                      <>
                        <span
                          className={css.bar}
                          data-status={row.status}
                          aria-hidden="true"
                          style={{
                            '--agent-left': `${Math.max(0, Math.min(1, left)) * 100}%`,
                            '--agent-width': `${Math.max(0, Math.min(1, right) - Math.max(0, Math.min(1, left))) * 100}%`,
                          } as CSSProperties}
                        />
                        {wallMs !== null && (
                          <span
                            className={css.duration}
                            style={{ '--agent-left': `${Math.max(0, Math.min(1, right)) * 100}%` } as CSSProperties}
                          >
                            {formatTimelineOffset(wallMs, t)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Tooltip>
            )
          })}
        </div>
      )}
    </div>
  )
})
