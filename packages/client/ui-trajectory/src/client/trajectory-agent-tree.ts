/** Whole subagent tree (subagents spawning subagents) derived from session projections. */

import type { TrajectorySubagentLifecycle } from './trajectory-subagent.ts'

/** Structural subset of a catalog row (`subagentCatalog`). */
interface CatalogEntryLike {
  readonly id: string
  readonly createdAt: number
  readonly mode: string
  readonly label?: string | undefined
}

/** Structural subset of `subagentTiming`; `lastTurnEnd` may not exist upstream yet. */
interface TimingLike {
  readonly settledMs: number
  readonly active?: { readonly since: number; readonly through: number } | undefined
  readonly lastTurnCompleted?: boolean | undefined
  readonly lastTurnEnd?: { readonly at: number; readonly reason: string } | undefined
}

/** Structural subset of a session projection snapshot. */
export interface AgentTreeProjectionLike {
  readonly values: {
    readonly subagentCatalog?: readonly CatalogEntryLike[] | undefined
    readonly subagentTiming?: TimingLike | undefined
  }
}

export type AgentTreeStatus = 'running' | 'done' | 'failed' | 'interrupted' | 'unknown'

/** One subagent in depth-first catalog order. */
export interface AgentTreeRow {
  sessionId: string
  /** 1 for direct children of the root. */
  depth: number
  label: string
  shortId: string
  status: AgentTreeStatus
  startedAt: number | null
  /** Null while running or untimed. */
  endedAt: number | null
  /** Accumulated active turn time, including the open turn; null when untimed. */
  activeMs: number | null
  hasChildren: boolean
  /** Ledger record index of the start call; depth-1 rows only. */
  startIndex: number | null
}

function endStatus(timing: TimingLike): AgentTreeStatus {
  const reason = timing.lastTurnEnd?.reason
  if (reason !== undefined) return reason === 'completed' ? 'done' : reason === 'aborted' ? 'interrupted' : 'failed'
  if (timing.lastTurnCompleted === undefined) return 'unknown'
  return timing.lastTurnCompleted ? 'done' : 'failed'
}

/** Start-call index per depth-1 catalog id: by id, else blocking one-shot calls in order. */
function startIndexes(
  entries: readonly CatalogEntryLike[],
  lifecycles: readonly TrajectorySubagentLifecycle[],
): Map<string, number> {
  const result = new Map<string, number>()
  const byId = new Map(lifecycles.map(lifecycle => [lifecycle.id, lifecycle]))
  for (const entry of entries) {
    const found = byId.get(entry.id)
    if (found !== undefined) result.set(entry.id, found.startIndex)
  }
  const blocking = lifecycles.filter(lifecycle => !lifecycle.background && !result.has(lifecycle.id))
  let next = 0
  for (const entry of entries) {
    if (result.has(entry.id) || entry.mode !== 'one-shot') continue
    const lifecycle = blocking[next++]
    if (lifecycle === undefined) break
    result.set(entry.id, lifecycle.startIndex)
  }
  return result
}

/**
 * Flatten the subagent tree below `rootId`.
 * @param rootId - Session whose descendants are listed (the root itself is not a row).
 * @param byId - Session summaries; only `running` is read.
 * @param projectionsBySession - Projection snapshots per session.
 * @param lifecycles - Ledger lifecycles linking depth-1 rows to their start call.
 * @returns Rows in depth-first catalog order.
 */
export function deriveAgentTree(
  rootId: string,
  byId: Readonly<Record<string, { readonly running: boolean } | undefined>>,
  projectionsBySession: Readonly<Record<string, AgentTreeProjectionLike | undefined>>,
  lifecycles: readonly TrajectorySubagentLifecycle[],
): readonly AgentTreeRow[] {
  const rows: AgentTreeRow[] = []
  const visited = new Set<string>([rootId])
  const walk = (parentId: string, depth: number, links: ReadonlyMap<string, number>) => {
    for (const entry of projectionsBySession[parentId]?.values.subagentCatalog ?? []) {
      if (visited.has(entry.id)) continue
      visited.add(entry.id)
      const projection = projectionsBySession[entry.id]
      const timing = projection?.values.subagentTiming
      const running = byId[entry.id]?.running === true
      const children = projection?.values.subagentCatalog ?? []
      rows.push({
        sessionId: entry.id,
        depth,
        label: entry.label ?? entry.id.slice(0, 8),
        shortId: entry.id.slice(0, 8),
        status: running ? 'running' : timing === undefined ? 'unknown' : endStatus(timing),
        startedAt: entry.createdAt,
        endedAt: running ? null : timing?.lastTurnEnd?.at ?? null,
        activeMs: timing === undefined
          ? null
          : timing.settledMs + (timing.active === undefined ? 0 : Math.max(0, timing.active.through - timing.active.since)),
        hasChildren: children.length > 0,
        startIndex: links.get(entry.id) ?? null,
      })
      walk(entry.id, depth + 1, new Map())
    }
  }
  walk(rootId, 1, startIndexes(projectionsBySession[rootId]?.values.subagentCatalog ?? [], lifecycles))
  return rows
}
