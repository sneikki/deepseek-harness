/** Per-tool card bodies shared by the chat tool row and the trajectory ledger. @module */
import { readCardModel, type ReadCardModel } from './read-card-model.ts'
import { diffCardModel, type DiffCardModel } from './diff-card-model.ts'
import { searchCardModel, type SearchCardModel } from './search-card-model.ts'
import type { ToolCallBlock } from './tool-call-model.ts'

/** The rich card bodies one tool call derives; each is null when the call takes another view. */
export interface ToolBodyModels {
  read: ReadCardModel | null
  diff: DiffCardModel | null
  search: SearchCardModel | null
}

/**
 * Derive the file-read, file-diff and search bodies of one tool call. Every
 * consumer that draws these bodies asks here, so the chat row and the
 * trajectory pick the same body for the same call.
 * @param block - running or settled Tool block.
 * @param cwd - session workspace root, forwarded to the read path label.
 * @param home - host account home, forwarded to the read path label.
 * @returns the three bodies, each null for the generic path.
 */
export function toolBodyModels(block: ToolCallBlock, cwd?: string, home?: string): ToolBodyModels {
  return {
    read: readCardModel(block, cwd, home),
    diff: diffCardModel(block),
    search: searchCardModel(block),
  }
}
