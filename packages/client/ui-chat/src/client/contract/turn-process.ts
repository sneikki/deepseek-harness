import type { ChatNode } from './chat-nodes.ts'

/** Activity class of one Tool call; drives the turn row's activity strip. */
export type TurnActivity = 'code' | 'review' | 'deploy' | 'proof' | 'other' | 'error'

/** Read verbs whose MCP tool names classify as review (first word of the tool part). */
const MCP_READ_VERBS = new Set(['search', 'recall', 'expand', 'read', 'get', 'list', 'fetch', 'query', 'find', 'where', 'outline', 'show', 'view', 'status', 'whoami', 'describe'])

/**
 * Whether an MCP Tool name (`mcp__<server>__<tool>`) names a read-only tool by its verb.
 * Leading words that name the server (`mcp__codevec__codevec_search`, `mcp__claude_ai_Slack__slack_read`) are skipped.
 * @param name - durable Tool-call name.
 * @returns true when the tool part starts with a read verb.
 */
function isMcpReadTool(name: string): boolean {
  const [prefix, server = '', ...rest] = name.split('__')
  if (prefix !== 'mcp' || rest.length === 0) return false
  const serverWords = new Set(server.toLowerCase().split(/[_\-.]/))
  const words = rest.join('__').toLowerCase().split(/[_\-.]/)
  const start = words.findIndex(word => !serverWords.has(word))
  const verb = start === -1 ? undefined : words[start]
  return verb !== undefined && MCP_READ_VERBS.has(verb)
}

/**
 * Classify a Tool call name by what it does to the workspace.
 * @param name - durable Tool-call name.
 * @returns activity class; unknown tools are 'other'.
 */
export function turnActivityOf(name: string): TurnActivity {
  if (['write', 'edit', 'apply_patch'].includes(name)) return 'code'
  if (['read', 'read_image', 'grep', 'glob', 'web_search', 'web_fetch'].includes(name) || name.endsWith('_inspect')) return 'review'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin', 'run_code'].includes(name) || name.startsWith('terminal_')) return 'deploy'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'proof'
  if (isMcpReadTool(name)) return 'review'
  return 'other'
}

/** Current process range and finalized answer boundary derived from one Turn. */
export interface TurnProcessSpec {
  readonly turn: number
  /** Stable control-node anchor source, including currently ineligible evidence. */
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  /** Reply-bearing durable Assistant messages before the final answer. */
  readonly messageCount: number
  /** Durable non-subagent Tool calls recorded by this Turn. */
  readonly toolCallCount: number
  /** Tool calls whose configured name identifies a subagent delegation. */
  readonly subagentCount: number
  /** One class per Tool call in call order, delegations included; failed calls are 'error'. */
  readonly activity: readonly TurnActivity[]
}

/**
 * Compare immutable Turn-process specifications by their published fields.
 * @param left - previous specification.
 * @param right - next specification.
 * @returns whether both values describe the same process presentation.
 */
export function sameTurnProcessSpec(left: TurnProcessSpec, right: TurnProcessSpec): boolean {
  return left.turn === right.turn
    && left.controlAnchorSeq === right.controlAnchorSeq
    && left.processStartSeq === right.processStartSeq
    && left.answerAnchorSeq === right.answerAnchorSeq
    && left.answerStep === right.answerStep
    && left.inlineReasoning === right.inlineReasoning
    && left.messageCount === right.messageCount
    && left.toolCallCount === right.toolCallCount
    && left.subagentCount === right.subagentCount
    && left.activity.length === right.activity.length
    && left.activity.every((kind, index) => kind === right.activity[index])
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/**
 * Keep live, stopped, and failed Turns open.
 * @param node - Node carrying the owning Turn.
 * @returns whether whole-Turn collapse is unavailable.
 */
export function turnProcessAlwaysOpen(node: ChatNode | undefined): boolean {
  const location = node?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return false
  const reason = location.turn.end?.data.reason.kind
  return location.turn.status === 'open' || reason === 'aborted' || reason === 'interrupted' || reason === 'error'
}
