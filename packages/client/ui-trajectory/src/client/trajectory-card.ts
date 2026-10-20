/** Ledger box geometry shared by CSS and the virtualizer, plus the complete text behind each box. */

import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import { measureElement } from '@tanstack/react-virtual'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'

/** Line height of box text. */
export const CARD_LINE_HEIGHT = 20
/** Body lines every collapsed box shows; the rest is cut. */
export const CARD_BODY_LINES = 3
/** Header line: sans badge on the left, mono meta on the right. */
export const CARD_HEAD_HEIGHT = 20
export const CARD_HEAD_GAP = 4
export const CARD_PADDING_Y = 10
export const CARD_BORDER = 1
/** Air between two boxes. */
export const CARD_GAP = 8
/** Height of every collapsed box, border included. */
export const CARD_HEIGHT = 2 * (CARD_PADDING_Y + CARD_BORDER)
  + CARD_HEAD_HEIGHT + CARD_HEAD_GAP + CARD_BODY_LINES * CARD_LINE_HEIGHT
/** An assistant step that only chose tools has no body: header line only. */
export const CARD_COMPACT_HEIGHT = 2 * (CARD_PADDING_Y + CARD_BORDER) + CARD_HEAD_HEIGHT
/** Virtual-row height of a calls-only box. */
export const CARD_COMPACT_ROW_HEIGHT = CARD_COMPACT_HEIGHT + CARD_GAP
/** Virtual-row height of a collapsed box: the box plus the gap below it. */
export const CARD_ROW_HEIGHT = CARD_HEIGHT + CARD_GAP
/** Indent of a tool box under its assistant step; a sub-call adds one more. */
export const CARD_INDENT = 28
/** Text column width, like a book page. */
export const CARD_MAX_WIDTH = 760
/**
 * Whether a box is the low calls-only form: an assistant step with a tool-calls pill and no text.
 * @param cell - Record behind the box.
 * @returns true when the box has a header line and no body.
 */
export function cardIsCompact(cell: TrajectoryCellProps): boolean {
  return cell.kind === 'message'
    && cell.callsBadge !== undefined
    && cell.text === ''
    && (cell.previewMarkdown ?? cell.outputDetail ?? '').trim() === ''
}

/**
 * Indent level of a box: step records (user, assistant, thinking, context) sit at the
 * rail, the tool calls of a step one level in, a tool's own sub-calls one more.
 * @param kind - Record kind.
 * @returns 0, 1 or 2.
 */
export function cardLevel(kind: TrajectoryCellKind): 0 | 1 | 2 {
  return kind === 'tool' ? 1 : kind === 'subtool' ? 2 : 0
}

/**
 * Virtualizer measurement for a ledger row. Collapsed boxes all have the constant
 * estimated height and are never read from the DOM; only an expanded box is measured.
 * @param element - Rendered row carrying `data-index` and `data-card-expanded`.
 * @param entry - Resize observation, when the call comes from the observer.
 * @param instance - The row virtualizer.
 * @returns Row height in pixels.
 */
export function measureCardRow(
  element: HTMLTableRowElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, HTMLTableRowElement>,
): number {
  return element.dataset['cardExpanded'] === 'true'
    ? measureElement(element, entry, instance)
    : instance.options.estimateSize(Number(element.dataset['index']))
}

/** Expanded text is capped so one huge result cannot stall the page; the inspector has the rest. */
const FULL_TEXT_CHARACTERS = 20_000

function capped(text: string): string {
  return text.length > FULL_TEXT_CHARACTERS ? `${text.slice(0, FULL_TEXT_CHARACTERS)}…` : text
}

/**
 * Complete tool arguments: the command of a shell tool as written, other
 * object arguments one `key: value` per line with values untouched.
 * @param name - Recorded tool name.
 * @param argsRaw - Recorded argument text.
 * @returns Readable full arguments, empty when the call has none.
 */
export function expandToolArgs(name: string, argsRaw: string): string {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return capped(argsRaw)
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return capped(argsRaw)
  const record = args as Record<string, unknown>
  const command = record['command']
  if (['bash', 'shell'].includes(name.toLowerCase()) && typeof command === 'string') {
    return capped(command.trim())
  }
  return capped(Object.entries(record)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : (JSON.stringify(value) ?? '')}`)
    .join('\n'))
}

/**
 * Complete text of a non-tool record.
 * @param cell - Record behind the box.
 * @returns Plain text with paragraph breaks kept.
 */
export function cardFullText(cell: TrajectoryCellProps): string {
  const source = cell.kind === 'thinking'
    ? cell.thinkingDetail ?? cell.previewMarkdown
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.previewMarkdown
      : cell.inputDetail ?? cell.previewMarkdown
  return source === undefined || source === ''
    ? cell.text
    : capped(extractMarkdownPlainText(source))
}

/**
 * Complete tool input.
 * @param cell - Tool record.
 * @returns Full arguments, or an empty string when the call has none.
 */
export function cardFullInput(cell: TrajectoryCellProps): string {
  return cell.inputDetail === undefined
    ? ''
    : expandToolArgs(cell.toolName ?? '', cell.inputDetail)
}

/**
 * Complete tool output.
 * @param cell - Tool record.
 * @returns Full result text, or an empty string when the call has no result yet.
 */
export function cardFullOutput(cell: TrajectoryCellProps): string {
  return capped(cell.outputDetail ?? cell.result ?? '')
}
