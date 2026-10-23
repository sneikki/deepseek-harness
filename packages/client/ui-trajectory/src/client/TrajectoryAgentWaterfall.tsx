/** Waterfall of the whole subagent tree under the timeline overview. */

import { memo, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import { formatTurnDuration } from './trajectory-record.ts'
import type { AgentTreeRow } from './trajectory-agent-tree.ts'
import css from './TrajectoryAgentWaterfall.module.css'

const DEFAULT_EXPAND_ALL_LIMIT = 12
const TOOLTIP_DELAY_MS = 500
// Past this fraction of the track a label after the bar end would be clipped.
const LABEL_FLIP_AT = 0.85
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
  /** Colour of the transcript lane per row id (rows without a visible lane have none). */
  laneColors?: ReadonlyMap<string, string> | undefined
  /** Row lit by a hovered transcript lane; hovering a row reports it back. */
  onHover?: ((rowId: string | null) => void) | undefined
  /** Highlight states shared with the overview: selected record, search hits, brushed range (domain units). */
  selectedIndex?: number | null
  searchMatchIndexes?: ReadonlySet<number> | null
  activeRange?: { start: number; end: number } | null
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  )
}

function StatusIcon({ status }: { status: AgentTreeRow['status'] }) {
  return (
    <span className={css.icon} data-status={status} aria-hidden="true">
      {status === 'done' && <Svg><path d="M3.2 6.3 5.2 8.3 8.9 4" /></Svg>}
      {status === 'failed' && <Svg><path d="M4 4l4 4M8 4l-4 4" /></Svg>}
    </span>
  )
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Collapsible agent-tree waterfall, one 22px row per agent in depth-first order. */
export const TrajectoryAgentWaterfall = memo(function TrajectoryAgentWaterfall({
  t, rows: allRows, domainStart, domainDuration, domainEnd, toDomain, onRecordSelect, onOpenSession,
  laneColors, onHover, selectedIndex = null, searchMatchIndexes = null, activeRange = null,
}: TrajectoryAgentWaterfallProps) {
  // Rows with neither status nor interval would be empty lines: count them instead.
  const rows = useMemo(() => allRows.filter(row => row.status !== 'unknown'), [allRows])
  const untimed = allRows.length - rows.length
  const [open, setOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  // The default (all vs depth <= 1) is decided once, when rows first appear.
  const expandAll = useRef<boolean | null>(null)
  if (expandAll.current === null && rows.length > 0) expandAll.current = rows.length <= DEFAULT_EXPAND_ALL_LIMIT
  const [explicit, setExplicit] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [focusId, setFocusId] = useState<string | null>(null)
  const isExpanded = (row: AgentTreeRow): boolean =>
    explicit.get(row.sessionId) ?? (expandAll.current === true || row.depth <= 1)
  const visible = useMemo(() => {
    const result: { row: AgentTreeRow; ancestor: AgentTreeRow; parent: AgentTreeRow | null }[] = []
    const path: AgentTreeRow[] = []
    let top: AgentTreeRow | null = null
    let hideDepth = Number.POSITIVE_INFINITY
    for (const row of rows) {
      if (row.depth === 1) top = row
      path.length = row.depth - 1
      const parent = path[row.depth - 2] ?? null
      path[row.depth - 1] = row
      if (row.depth > hideDepth) continue
      hideDepth = Number.POSITIVE_INFINITY
      result.push({ row, ancestor: top ?? row, parent })
      if (row.hasChildren && !isExpanded(row)) hideDepth = row.depth
    }
    return result
  }, [rows, explicit])
  if (allRows.length === 0) return null

  const setExpanded = (id: string, value: boolean) => {
    setExplicit(previous => new Map(previous).set(id, value))
  }
  const focusRow = (id: string) => {
    setFocusId(id)
    rootRef.current?.querySelectorAll<HTMLElement>('[data-agent-id]').forEach((node) => {
      if (node.dataset.agentId === id) node.focus()
    })
  }
  const fraction = (domain: number) => (domain - domainStart) / domainDuration
  const activeId = visible.some(({ row }) => row.sessionId === focusId) ? focusId : visible[0]?.row.sessionId

  const onKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    { row, ancestor, parent }: (typeof visible)[number],
  ) => {
    if (event.target !== event.currentTarget) return
    const go = (position: number) => {
      const target = visible[Math.max(0, Math.min(visible.length - 1, position))]
      if (target !== undefined) focusRow(target.row.sessionId)
    }
    switch (event.key) {
      case 'Enter':
      case ' ':
        if (ancestor.startIndex != null) onRecordSelect?.(ancestor.startIndex)
        break
      case 'ArrowDown': go(index + 1); break
      case 'ArrowUp': go(index - 1); break
      case 'ArrowRight':
        if (row.hasChildren && !isExpanded(row)) setExpanded(row.sessionId, true)
        else go(index + 1)
        break
      case 'ArrowLeft':
        if (row.hasChildren && isExpanded(row)) setExpanded(row.sessionId, false)
        else if (parent !== null) focusRow(parent.sessionId)
        break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div ref={rootRef} className={css.root} data-testid="agent-waterfall">
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={t('timeline.agentsToggle')}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.headerChevron} data-open={open || undefined} aria-hidden="true" />
        {untimed === 0
          ? t('timeline.agentsSection', { count: rows.length })
          : t('timeline.agentsSectionUntimed', { count: rows.length, untimed })}
      </button>
      {open && (
        <div className={css.rows} data-agent-rows role="tree" aria-label={t('timeline.agentsSection', { count: allRows.length })}>
          {visible.map((entry, index) => {
            const { row, ancestor } = entry
            const startedAt = row.startedAt
            const timed = startedAt !== null
            // Running bars stay open-ended: their end is already in domain units.
            const startDomain = timed ? toDomain(startedAt) : 0
            const endDomain = row.endedAt !== null
              ? toDomain(row.endedAt)
              : row.status === 'running' ? domainEnd : null
            const rawLeft = fraction(startDomain)
            const rawRight = timed && endDomain !== null ? fraction(endDomain) : rawLeft
            // Entirely outside the visible window (earlier history or zoomed away): label only.
            const drawn = timed && endDomain !== null && rawRight > 0 && rawLeft < 1
            const left = clamp01(rawLeft)
            const right = clamp01(rawRight)
            const wallMs = timed && row.endedAt !== null ? row.endedAt - startedAt : null
            // Bar label is working time: a resumed agent's idle gap is no work.
            const labelMs = row.activeMs ?? wallMs
            const status = t(STATUS_KEY[row.status])
            const tip = [
              `${row.label} · ${row.shortId}`,
              [
                status,
                wallMs === null ? null : t('timeline.agentWall', { duration: formatTurnDuration(wallMs, t) }),
                row.activeMs === null ? null : t('timeline.agentActive', { duration: formatTurnDuration(row.activeMs, t) }),
              ].filter(part => part !== null).join(' · '),
            ].join('\n')
            const current = selectedIndex !== null
              && (row.startIndex === selectedIndex || ancestor.startIndex === selectedIndex)
            const match = searchMatchIndexes === null
              ? undefined
              : row.startIndex !== null && searchMatchIndexes.has(row.startIndex) ? 'true' : 'false'
            const inRange = activeRange === null || !timed
              ? undefined
              : startDomain <= activeRange.end && (endDomain ?? startDomain) >= activeRange.start
                ? 'true'
                : 'false'
            const selectable = ancestor.startIndex != null
            const expanded = isExpanded(row)
            return (
              <Tooltip key={row.sessionId} label={() => tip} side="bottom" delayMs={TOOLTIP_DELAY_MS}>
                <div
                  role="treeitem"
                  aria-level={row.depth}
                  aria-expanded={row.hasChildren ? expanded : undefined}
                  aria-selected={current}
                  tabIndex={row.sessionId === activeId ? 0 : -1}
                  className={css.row}
                  data-status={row.status}
                  data-agent-id={row.sessionId}
                  data-lane={laneColors?.has(row.sessionId) || undefined}
                  style={laneColors?.has(row.sessionId) ? { '--lane': laneColors.get(row.sessionId) } as CSSProperties : undefined}
                  onMouseEnter={onHover === undefined ? undefined : () => { onHover(row.sessionId) }}
                  onMouseLeave={onHover === undefined ? undefined : () => { onHover(null) }}
                  data-selectable={selectable || undefined}
                  data-current={current || undefined}
                  data-search-match={match}
                  data-selected={inRange}
                  onFocus={(event) => { if (event.target === event.currentTarget) setFocusId(row.sessionId) }}
                  onKeyDown={(event) => { onKeyDown(event, index, entry) }}
                  onClick={() => {
                    if (ancestor.startIndex != null) onRecordSelect?.(ancestor.startIndex)
                  }}
                >
                  <div className={css.name} style={{ paddingLeft: (row.depth - 1) * 12 }}>
                    {row.hasChildren
                      ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          className={css.chevron}
                          data-open={expanded || undefined}
                          aria-expanded={expanded}
                          aria-label={t(expanded ? 'timeline.agentCollapse' : 'timeline.agentExpand', { name: row.label })}
                          onClick={(event) => { event.stopPropagation(); setExpanded(row.sessionId, !expanded) }}
                        />
                      )
                      : <span className={css.chevronSpace} />}
                    <StatusIcon status={row.status} />
                    <span className={css.srOnly}>{status}</span>
                    <span className={css.label}>{row.label}</span>
                    <span className={css.id}>{row.shortId}</span>
                    {onOpenSession !== undefined && row.hasSession && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={css.openButton}
                        aria-label={t('timeline.agentOpen', { name: row.label })}
                        onClick={(event) => { event.stopPropagation(); onOpenSession(row.sessionId) }}
                      >
                        <Svg><path d="M4 8l4-4M4.5 4H8v3.5" /></Svg>
                      </button>
                    )}
                  </div>
                  <div className={css.track} aria-hidden="true">
                    {drawn && (
                      <>
                        <span
                          className={css.bar}
                          data-status={row.status}
                          style={{
                            '--agent-left': `${left * 100}%`,
                            '--agent-width': `${(right - left) * 100}%`,
                          } as CSSProperties}
                        />
                        {labelMs !== null && (
                          <span
                            className={css.duration}
                            data-flip={right > LABEL_FLIP_AT || undefined}
                            style={{ '--agent-left': `${right * 100}%` } as CSSProperties}
                          >
                            {formatTurnDuration(labelMs, t)}
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
