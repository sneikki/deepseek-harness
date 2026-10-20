/** Pure noise reduction for the ledger: skipped rows, repeats, kind filter, tool-args line. */

import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'

/** Segmented ledger filter. */
export type TrajectoryRowFilter = 'all' | 'messages' | 'tools'

/** Row counts per filter chip, taken after noise is removed. */
export interface TrajectoryRowCounts {
  all: number
  messages: number
  tools: number
}

const VALUE_CHARACTERS = 80
const SHELL_TOOLS = new Set(['bash', 'shell'])

function isToolCell(cell: TrajectoryCellProps): boolean {
  return cell.kind === 'tool' || cell.kind === 'subtool'
}

function isToolCallOnlyCell(
  cell: TrajectoryCellProps,
  t: TrajectoryTranslate,
): boolean {
  return (
    cell.kind === 'message' &&
    !cell.outputDetail &&
    !cell.thinkingDetail &&
    cell.text === t('layout.toolCallOnly')
  )
}

function contextKey(cell: TrajectoryCellProps): string {
  const key = [
    cell.text,
    cell.previewMarkdown ?? '',
    cell.inputDetail ?? '',
  ].join('\u0000')
  return key === '\u0000\u0000' ? '' : key
}

function oneLine(value: string, limit = VALUE_CHARACTERS): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit).trimEnd()}…` : line
}

/**
 * Turn raw tool arguments into one human line: the command for shell tools,
 * `key: value` pairs otherwise. Text that is not a JSON object is returned as is.
 * @param name - Recorded tool name.
 * @param argsRaw - Recorded argument text.
 * @returns A short single-line summary, empty for no arguments.
 */
export function summarizeToolArgs(name: string, argsRaw: string): string {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return argsRaw
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args))
    return argsRaw
  const record = args as Record<string, unknown>
  const command = record['command']
  if (SHELL_TOOLS.has(name.toLowerCase()) && typeof command === 'string') {
    return command.replace(/\s+/g, ' ').trim()
  }
  return Object.entries(record)
    .map(
      ([key, value]) =>
        `${key}: ${oneLine(typeof value === 'string' ? value : (JSON.stringify(value) ?? ''))}`,
    )
    .join(', ')
}

/**
 * Drop empty tool-call-only assistant rows and repeated context rows, count
 * what is left, and apply the kind filter.
 * @param turns - Full layout.
 * @param filter - Selected chip.
 * @param t - Trajectory translator.
 * @returns The visible layout and counts that ignore the chip.
 */
export function reduceTrajectoryNoise(
  turns: readonly TrajectoryTurnModel[],
  filter: TrajectoryRowFilter,
  t: TrajectoryTranslate,
): { turns: readonly TrajectoryTurnModel[]; counts: TrajectoryRowCounts } {
  const counts: TrajectoryRowCounts = { all: 0, messages: 0, tools: 0 }
  const seenContext = new Set<string>()
  const visible = turns.flatMap((turn) => {
    const groups = turn.groups.flatMap((group) => {
      const cells = group.cells.filter((cell) => {
        if (isToolCallOnlyCell(cell, t)) return false
        if (cell.kind === 'context') {
          const key = contextKey(cell)
          if (key !== '') {
            if (seenContext.has(key)) return false
            seenContext.add(key)
          }
        }
        if (cell.requestOnly !== true) {
          counts.all++
          if (isToolCell(cell)) counts.tools++
          else counts.messages++
        }
        if (filter === 'all') return true
        if (cell.requestOnly === true) return false
        return isToolCell(cell) === (filter === 'tools')
      })
      return cells.length === 0 ? [] : [{ ...group, cells }]
    })
    return groups.length === 0 ? [] : [{ ...turn, groups }]
  })
  return { turns: visible, counts }
}
