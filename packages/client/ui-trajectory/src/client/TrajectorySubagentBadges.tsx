/** Subagent lifecycle texts and the header badges of a ledger box. */

import type { ReactNode } from 'react'
import type { TrajectoryTranslate } from './locales.ts'
import { formatBoxDuration } from './trajectory-record.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type { TrajectorySubagentLifecycle, TrajectorySubagentStatus } from './trajectory-subagent.ts'
import css from './TrajectoryTable.module.css'

const STATUS_KEY = {
  running: 'card.agentRunning',
  finished: 'card.agentFinished',
  failed: 'card.agentFailed',
  interrupted: 'card.agentInterrupted',
} as const satisfies Record<TrajectorySubagentStatus, string>

const SETTLED_KEY = {
  running: 'card.subagentReportFrom',
  finished: 'card.subagentFinished',
  failed: 'card.subagentFailed',
  interrupted: 'card.subagentStopped',
} as const satisfies Record<TrajectorySubagentStatus, string>

/**
 * Text of a subagent report or settle notice, replacing the generic context text.
 * @param cell - Context record carrying `subagent` info.
 * @param t - Trajectory locale translator.
 * @returns `Report from 2c619f73` or `2c619f73 finished`; undefined for any other record.
 */
export function subagentNoticeText(
  cell: TrajectoryCellProps,
  t: TrajectoryTranslate,
): string | undefined {
  const { subagent } = cell
  if (cell.kind !== 'context' || subagent === undefined) return undefined
  if (subagent.phase === 'report') return t('card.subagentReportFrom', { id: subagent.shortId })
  if (subagent.phase === 'finish') return t(SETTLED_KEY[subagent.status], { id: subagent.shortId })
  return undefined
}

/**
 * Header badges of a box that belongs to a subagent lifecycle: the start call
 * shows status, duration and report count; every other record shows the agent id.
 * @param cell - Record carrying `subagent` info.
 * @param lifecycle - The agent's lifecycle when `cell` is its start call.
 * @param t - Trajectory locale translator.
 * @returns Badge elements, or undefined when the record has no lifecycle.
 */
export function subagentBadges(
  cell: TrajectoryCellProps,
  lifecycle: TrajectorySubagentLifecycle | undefined,
  t: TrajectoryTranslate,
): ReactNode {
  const { subagent } = cell
  if (subagent === undefined) return undefined
  const chip = <span className={css.subagentChip}>{subagent.shortId}</span>
  if (subagent.phase !== 'start' || lifecycle === undefined) return chip
  const duration = lifecycle.startedAt !== null && lifecycle.endedAt !== null
    ? formatBoxDuration(lifecycle.endedAt - lifecycle.startedAt, t)
    : undefined
  return (
    <>
      <span className={css.subagentPill} data-status={lifecycle.status}>
        <span className={css.subagentDot} aria-hidden="true" />
        {t(STATUS_KEY[lifecycle.status])}
      </span>
      {duration !== undefined && <span className={css.subagentChip}>{duration}</span>}
      {lifecycle.reportCount > 0 && (
        <span className={css.subagentChip}>
          {lifecycle.reportCount === 1
            ? t('timeline.subagentReport')
            : t('timeline.subagentReports', { count: lifecycle.reportCount })}
        </span>
      )}
      {chip}
    </>
  )
}
