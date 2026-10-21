/** Activity bucket of a Tool call; mirrors ui-chat's TurnActivity so the strip and this view colour alike. */
export type TrajectoryActivity = 'code' | 'review' | 'deploy' | 'proof' | 'other' | 'error'

/** Read verbs whose MCP tool names classify as review (first word of the tool part). */
const MCP_READ_VERBS = new Set(['search', 'recall', 'expand', 'read', 'get', 'list', 'fetch', 'query', 'find', 'where', 'outline', 'show', 'view', 'status', 'whoami', 'describe'])

/**
 * Whether an MCP Tool name (`mcp__<server>__<tool>`) names a read-only tool by its verb.
 * A repeated server prefix (`mcp__codevec__codevec_search`) is skipped.
 * @param name - durable Tool-call name.
 * @returns true when the tool part starts with a read verb.
 */
function isMcpReadTool(name: string): boolean {
  const [prefix, server = '', ...rest] = name.split('__')
  if (prefix !== 'mcp' || rest.length === 0) return false
  const words = rest.join('__').toLowerCase().split(/[_\-.]/)
  const verb = words[0] === server.toLowerCase() ? words[1] : words[0]
  return verb !== undefined && MCP_READ_VERBS.has(verb)
}

/**
 * Bucket a Tool call by what it does to the workspace.
 * @param name - Tool-call name; undefined for non-Tool records.
 * @param isError - whether the call failed.
 * @returns the activity bucket, or undefined when the record is not a Tool call.
 */
export function trajectoryActivityOf(
  name: string | undefined,
  isError: boolean | undefined,
): TrajectoryActivity | undefined {
  if (name === undefined) return undefined
  if (isError === true) return 'error'
  if (['write', 'edit', 'apply_patch'].includes(name)) return 'code'
  if (['read', 'read_image', 'grep', 'glob', 'web_search', 'web_fetch'].includes(name) || name.endsWith('_inspect')) return 'review'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin', 'run_code'].includes(name) || name.startsWith('terminal_')) return 'deploy'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'proof'
  if (isMcpReadTool(name)) return 'review'
  return 'other'
}

/** Colour family of a ledger card; one hue per family so the kinds read apart. */
export type TrajectoryCardTone =
  | 'user' | 'assistant' | 'thinking' | 'context' | 'subagent'
  | 'shell' | 'read' | 'edit' | 'mcp' | 'tool' | 'error'

/**
 * Colour family of a ledger card, built on the activity buckets (shell = deploy,
 * read/search = review, edit/write = code, subagent = proof); MCP tools get their own.
 * @param kind - Record kind.
 * @param toolName - Tool-call name for Tool records.
 * @param isError - whether the call failed.
 * @returns the card's colour family.
 */
export function trajectoryCardToneOf(
  kind: string,
  toolName: string | undefined,
  isError: boolean | undefined,
): TrajectoryCardTone {
  if (kind === 'user') return 'user'
  if (kind === 'message') return 'assistant'
  if (kind === 'thinking') return 'thinking'
  if (kind !== 'tool' && kind !== 'subtool') return 'context'
  if (toolName?.startsWith('mcp__') === true && isError !== true) return 'mcp'
  switch (trajectoryActivityOf(toolName ?? '', isError)) {
    case 'error': return 'error'
    case 'deploy': return 'shell'
    case 'review': return 'read'
    case 'code': return 'edit'
    case 'proof': return 'subagent'
    default: return 'tool'
  }
}
