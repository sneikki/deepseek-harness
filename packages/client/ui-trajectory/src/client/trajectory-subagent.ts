/**
 * Subagent lifecycle correlation: one agent id ties the start call, the
 * agent-message reports, the control calls and the settled notice together.
 * Structured fields only: tool name + arguments, the `started subagent <id>`
 * result, and `messageSource` kinds `agent-message` / `subagent-settled`.
 */

import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'

/** Role of a record in its subagent's lifecycle. */
export type TrajectorySubagentPhase = 'start' | 'report' | 'control' | 'finish'

/** Lifecycle state after the last event seen for the agent. */
export type TrajectorySubagentStatus = 'running' | 'finished' | 'failed' | 'interrupted'

/** Subagent facts attached to every record that belongs to one lifecycle. */
export interface TrajectorySubagentInfo {
  id: string
  /** First 8 characters of the id, for badges. */
  shortId: string
  description: string
  phase: TrajectorySubagentPhase
  /** Final lifecycle status, identical on every record of the agent. */
  status: TrajectorySubagentStatus
}

/** One subagent from start to its last settle, derived from annotated records. */
export interface TrajectorySubagentLifecycle {
  id: string
  shortId: string
  description: string
  /** False when the `subagent` call blocked and returned the final text (no agent id). */
  background: boolean
  status: TrajectorySubagentStatus
  /** Record index of the start call. */
  startIndex: number
  /** Record index of the last finish record, null while running. */
  endIndex: number | null
  startedAt: number | null
  /** Epoch ms of the last finish; null while running or when untimed. */
  endedAt: number | null
  reportCount: number
  controlCount: number
}

const START_TOOLS = new Set(['subagent', 'subagent_fork'])
const CONTROL_TOOLS = new Set(['send_message', 'interrupt_agent'])
const STARTED = /^started subagent (\S+)/

function parseArgs(cell: TrajectoryCellProps): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(cell.inputDetail ?? '')
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sourceOf(cell: TrajectoryCellProps): { kind?: string; senderSessionId?: string; summary?: string } {
  const source = cell.messageSource
  return typeof source === 'object' && source !== null ? source : {}
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

interface Draft {
  id: string
  description: string
  background: boolean
  status: TrajectorySubagentStatus
  start: TrajectoryCellProps
  end: TrajectoryCellProps | null
  reports: number
  controls: number
}

interface Correlation {
  lifecycles: readonly TrajectorySubagentLifecycle[]
  phaseByIndex: ReadonlyMap<number, { draft: Draft; phase: TrajectorySubagentPhase }>
}

function correlate(turns: readonly TrajectoryTurnModel[]): Correlation {
  const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
    .sort((left, right) => left.index - right.index)
  const drafts = new Map<string, Draft>()
  const phaseByIndex = new Map<number, { draft: Draft; phase: TrajectorySubagentPhase }>()
  const link = (cell: TrajectoryCellProps, draft: Draft, phase: TrajectorySubagentPhase) => {
    phaseByIndex.set(cell.index, { draft, phase })
  }

  for (const cell of cells) {
    if (cell.kind === 'tool' && cell.toolName !== undefined && START_TOOLS.has(cell.toolName)) {
      const args = parseArgs(cell)
      const started = STARTED.exec(cell.outputDetail ?? '')
      const id = started?.[1] ?? cell.callId ?? `call-${cell.index}`
      const done = cell.timeSeconds !== null && cell.outputDetail !== undefined
      const draft: Draft = {
        id,
        description: stringArg(args, 'description') ?? cell.text,
        background: started !== null,
        status: started !== null || !done ? 'running' : cell.isError === true ? 'failed' : 'finished',
        start: cell,
        end: started !== null || !done ? null : cell,
        reports: 0,
        controls: 0,
      }
      drafts.set(id, draft)
      link(cell, draft, 'start')
      continue
    }
    if (cell.kind === 'tool' && cell.toolName !== undefined && CONTROL_TOOLS.has(cell.toolName)) {
      const draft = drafts.get(stringArg(parseArgs(cell), 'agent_id') ?? '')
      if (draft === undefined) continue
      draft.controls++
      link(cell, draft, 'control')
      if (cell.isError === true) continue
      // A message wakes a settled agent; an interrupt marks a still-running one.
      if (cell.toolName === 'send_message') draft.status = 'running'
      else if (draft.status === 'running') draft.status = 'interrupted'
      continue
    }
    const source = sourceOf(cell)
    const draft = drafts.get(source.senderSessionId ?? '')
    if (draft === undefined) continue
    if (source.kind === 'agent-message') {
      draft.reports++
      link(cell, draft, 'report')
    } else if (source.kind === 'subagent-settled') {
      draft.end = cell
      draft.status = /\bfailed\b/.test(source.summary ?? '')
        ? 'failed'
        : /\bstopped\b/.test(source.summary ?? '') ? 'interrupted' : 'finished'
      link(cell, draft, 'finish')
    }
  }

  const lifecycles = [...drafts.values()].map((draft): TrajectorySubagentLifecycle => {
    const { start, end } = draft
    const endedAt = end === null || draft.status === 'running'
      ? null
      : end !== start
        ? end.startedAt ?? null
        // A blocking call has no settle record: it ends when its result returned.
        : start.startedAt == null || start.timeSeconds === null
          ? null
          : start.startedAt + start.timeSeconds * 1000
    return {
      id: draft.id,
      shortId: draft.id.slice(0, 8),
      description: draft.description,
      background: draft.background,
      status: draft.status,
      startIndex: draft.start.index,
      endIndex: draft.status === 'running' ? null : draft.end?.index ?? null,
      startedAt: draft.start.startedAt ?? null,
      endedAt,
      reportCount: draft.reports,
      controlCount: draft.controls,
    }
  })
  return { lifecycles, phaseByIndex }
}

/**
 * Correlate every subagent event per agent id.
 * @param turns - Layout turns (annotated or not).
 * @returns Lifecycles in start order.
 */
export function trajectorySubagentLifecycles(
  turns: readonly TrajectoryTurnModel[],
): readonly TrajectorySubagentLifecycle[] {
  return correlate(turns).lifecycles
}

/**
 * Attach `subagent` info to every record of every lifecycle.
 * @param turns - Layout turns in record order.
 * @returns Turns with annotated records; unrelated records and turns are shared.
 */
export function correlateTrajectorySubagents(
  turns: readonly TrajectoryTurnModel[],
): readonly TrajectoryTurnModel[] {
  const { phaseByIndex } = correlate(turns)
  if (phaseByIndex.size === 0) return turns
  const annotate = (cell: TrajectoryCellProps): TrajectoryCellProps => {
    const entry = phaseByIndex.get(cell.index)
    if (entry === undefined) return cell
    const { draft, phase } = entry
    return {
      ...cell,
      subagent: {
        id: draft.id,
        shortId: draft.id.slice(0, 8),
        description: draft.description,
        phase,
        status: draft.status,
      },
    }
  }
  return turns.map(turn => ({
    ...turn,
    groups: turn.groups.map(group => ({ ...group, cells: group.cells.map(annotate) })),
  }))
}
