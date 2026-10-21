/** The rich body one tool call draws in a trajectory box, chosen as the chat tool row chooses it. @module */
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import { classifyTool, type ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'
import { shellCommand } from './terminal-card-model.ts'
import { toolBodyModels } from './tool-body-model.ts'
import type { ReadCardModel } from './read-card-model.ts'
import type { DiffCardModel } from './diff-card-model.ts'
import type { SearchCardModel } from './search-card-model.ts'

/**
 * A rich body: the shell command, a file view, a diff or search matches. `label` is the
 * subject the box header names: the file path (relative, `~` at home) or the search pattern.
 */
export type ToolCardBody =
  | { kind: 'bash'; command: string }
  | { kind: 'read'; model: ReadCardModel; label: string }
  | { kind: 'diff'; model: DiffCardModel; label: string }
  | { kind: 'search'; model: SearchCardModel; label: string }

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
  if (diff !== null) {
    const path = diff.card.diffs[0]?.path ?? ''
    return { kind: 'diff', model: diff, label: abbreviateHomePath(relativizeToCwd(path, cwd), home) }
  }
  if (read !== null) return { kind: 'read', model: read, label: read.label ?? '' }
  if (search !== null) {
    return { kind: 'search', model: search, label: String(parsedToolCall(block)?.args.pattern ?? '') }
  }
  return undefined
}
