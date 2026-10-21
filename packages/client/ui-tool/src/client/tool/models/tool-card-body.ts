/** The rich body one tool call draws in a trajectory box, chosen as the chat tool row chooses it. @module */
import { classifyTool, type ToolCallBlock } from './tool-call-model.ts'
import { shellCommand } from './terminal-card-model.ts'
import { toolBodyModels } from './tool-body-model.ts'
import type { ReadCardModel } from './read-card-model.ts'
import type { DiffCardModel } from './diff-card-model.ts'
import type { SearchCardModel } from './search-card-model.ts'

/** A rich body: the shell command, a file view, a diff or search matches. */
export type ToolCardBody =
  | { kind: 'bash'; command: string }
  | { kind: 'read'; model: ReadCardModel }
  | { kind: 'diff'; model: DiffCardModel }
  | { kind: 'search'; model: SearchCardModel }

/**
 * The rich body of one tool call, in the chat row's order: shell command, diff,
 * file read, search. Every shell call is a command body, card or not.
 * @param toolName - recorded tool name.
 * @param block - running or settled Tool block.
 * @param cwd - session workspace root, for relative read paths.
 * @param home - host account home, for `~` read paths.
 * @returns the body, or undefined for a call that keeps the plain box.
 */
export function toolCardBody(
  toolName: string,
  block: ToolCallBlock,
  cwd?: string,
  home?: string,
): ToolCardBody | undefined {
  if (classifyTool(toolName) === 'bash') {
    const command = shellCommand(block)
    if (command !== undefined) return { kind: 'bash', command }
  }
  const { diff, read, search } = toolBodyModels(block, cwd, home)
  if (diff !== null) return { kind: 'diff', model: diff }
  if (read !== null) return { kind: 'read', model: read }
  if (search !== null) return { kind: 'search', model: search }
  return undefined
}
