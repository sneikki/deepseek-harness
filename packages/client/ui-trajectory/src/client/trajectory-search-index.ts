/** Incremental full-text index for the trajectory ledger. */

import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { trajectoryPreviewTexts } from './trajectory-preview.ts'

interface SearchEntry {
  readonly sources: readonly string[]
  readonly text: string
}

function searchableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function sameSources(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function markdownPreview(cell: TrajectoryCellProps, preview: string | undefined): string {
  if (preview === undefined) return ''
  if (cell.text === '') return preview
  return preview === '' ? cell.text : `${cell.text} · ${preview}`
}

function resultPreview(cell: TrajectoryCellProps, preview: string | undefined): string {
  return preview === undefined ? cell.result ?? '' : preview
}

function recordSources(
  turn: number | null,
  group: string,
  cell: TrajectoryCellProps,
): readonly string[] {
  // Reasoning is indexed on its own thinking row, not again on the assistant row.
  const blocks = [
    ...(cell.sourceBlocks ?? []).filter(block => cell.kind !== 'message' || block.type !== 'thinking'),
    ...(cell.outputBlocks ?? []),
  ]
  return [
    turn === null ? 'between turns' : `turn ${turn}`,
    group,
    cell.kind,
    cell.kind === 'message' ? 'assistant' : '',
    cell.text,
    cell.previewMarkdown ?? '',
    cell.inputDetail ?? '',
    cell.outputDetail ?? '',
    cell.kind === 'message' ? '' : cell.thinkingDetail ?? '',
    cell.schemaDetail ?? '',
    cell.result ?? '',
    cell.resultPreviewMarkdown ?? '',
    cell.callId ?? '',
    ...blocks.flatMap(block => [
      block.type,
      block.content,
      block.callId ?? '',
      block.toolName ?? '',
      block.attachment?.name ?? '',
    ]),
    searchableJson(cell.messageSource),
    searchableJson(cell.promptDetail),
    searchableJson(cell.previousPromptDetail),
  ]
}

/** Session-view-local index that reparses Markdown only when one record's source changes. */
export class TrajectorySearchIndex {
  private readonly entries = new Map<string, SearchEntry>()
  private layouts: readonly (readonly TrajectoryTurnModel[])[] | undefined
  private generation = 0

  /**
   * Incrementally synchronize one or more current trajectory layout slices. Changed records'
   * Markdown is parsed off the main thread when many changed at once, so the entries commit
   * when that resolves; a newer call supersedes an unfinished one.
   * @param layouts - Finalized and optional streaming layouts from the same view.
   * @returns Whether the indexed layout version changed.
   */
  async update(layouts: readonly (readonly TrajectoryTurnModel[])[]): Promise<boolean> {
    if (this.layouts === layouts) return false
    this.layouts = layouts
    const generation = ++this.generation
    const seen = new Set<string>()
    // Markdown of the changed records, in one batch; each record keeps its slot (-1: none).
    const markdown: string[] = []
    const changed: { id: string; sources: readonly string[]; cell: TrajectoryCellProps; preview: number; result: number }[] = []
    for (const turns of layouts) {
      for (const turn of turns) {
        for (const group of turn.groups) {
          for (const cell of group.cells) {
            if (cell.requestOnly === true) continue
            const id = trajectoryRecordId(cell)
            const sources = recordSources(turn.turn, group.title, cell)
            const previous = this.entries.get(id)
            seen.add(id)
            if (previous !== undefined && sameSources(previous.sources, sources)) continue
            changed.push({
              id,
              sources,
              cell,
              preview: cell.previewMarkdown === undefined ? -1 : markdown.push(cell.previewMarkdown) - 1,
              result: cell.resultPreviewMarkdown === undefined ? -1 : markdown.push(cell.resultPreviewMarkdown) - 1,
            })
          }
        }
      }
    }
    const previews = await trajectoryPreviewTexts(markdown)
    if (generation !== this.generation) return false
    for (const { id, sources, cell, preview, result } of changed) {
      this.entries.set(id, {
        sources,
        text: [
          ...sources,
          markdownPreview(cell, previews[preview]),
          resultPreview(cell, previews[result]),
        ].join('\n').toLocaleLowerCase(),
      })
    }
    for (const id of this.entries.keys()) {
      if (!seen.has(id)) this.entries.delete(id)
    }
    return true
  }

  /**
   * Match a query against the latest committed index version.
   * @param query - Space-separated case-insensitive search terms.
   * @returns Matching stable record identities, or `null` without a query.
   */
  search(query: string): ReadonlySet<string> | null {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return null
    const matches = new Set<string>()
    for (const [id, entry] of this.entries) {
      if (terms.every(term => entry.text.includes(term))) matches.add(id)
    }
    return matches
  }
}
