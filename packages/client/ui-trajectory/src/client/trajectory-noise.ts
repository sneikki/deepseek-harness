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

/** 53-bit string hash (cyrb53): keeps the dedupe set small without storing full text. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`
}

function contextKey(cell: TrajectoryCellProps): string {
  if (cell.sourceBlocks?.some(block =>
    block.type === 'tool-addition' || block.type === 'tool-removal')) return ''
  const body = [
    cell.text,
    cell.previewMarkdown ?? '',
    cell.inputDetail ?? '',
    JSON.stringify(cell.messageSource ?? null),
  ].join('\u0000')
  return body === '\u0000\u0000\u0000null' ? '' : hashText(body)
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
 * Whether a row belongs to a chip. Request boundary markers show only under All.
 * @param cell - Ledger cell.
 * @param filter - Selected chip.
 * @returns true when the row is part of the filtered ledger.
 */
export function trajectoryRowMatchesFilter(
  cell: TrajectoryCellProps,
  filter: TrajectoryRowFilter,
): boolean {
  if (filter === 'all') return true
  if (cell.requestOnly === true) return false
  return isToolCell(cell) === (filter === 'tools')
}

/**
 * Find rows whose own line is noise: tool-call-only assistants and repeated
 * context. The cells stay in the layout (fold anchor, step metrics, inspector);
 * only their rendered row is skipped.
 * @param turns - Full layout.
 * @param t - Trajectory translator.
 * @param liveIndexes - Cells of the live partial: never hidden, their text is still arriving.
 * @returns Hidden cell indexes and per-chip counts of what remains.
 */
export function analyzeTrajectoryNoise(
  turns: readonly TrajectoryTurnModel[],
  t: TrajectoryTranslate,
  liveIndexes: ReadonlySet<number>,
): { hidden: ReadonlySet<number>; counts: TrajectoryRowCounts } {
  const counts: TrajectoryRowCounts = { all: 0, messages: 0, tools: 0 }
  const hidden = new Set<number>()
  const seenContext = new Set<string>()
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        if (
          isToolCallOnlyCell(cell, t)
          && cell.isError !== true
          && cell.assistantMetrics?.completedTime !== null
          && !liveIndexes.has(cell.index)
        ) {
          hidden.add(cell.index)
          continue
        }
        if (cell.kind === 'context') {
          const key = contextKey(cell)
          if (key !== '') {
            if (seenContext.has(key)) {
              hidden.add(cell.index)
              continue
            }
            seenContext.add(key)
          }
        }
        if (cell.requestOnly === true) continue
        counts.all++
        if (isToolCell(cell)) counts.tools++
        else counts.messages++
      }
    }
  }
  return { hidden, counts }
}
