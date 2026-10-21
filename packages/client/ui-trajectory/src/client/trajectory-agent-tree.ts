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
  readonly lastTurnEnd?: { readonly at: number; readonly reason: TurnEndKind } | undefined
}

/** Mirrors the `kind`s of `TurnEndReasonMap` (core/session types). */
export type TurnEndKind =
  | 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted' | 'forked'

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
  /** Settled time plus the open turn up to `active.through`; a live consumer extends it to now. Null when untimed. */
  activeMs: number | null
  hasChildren: boolean
  /** Ledger record index of the start call; depth-1 rows only. */
  startIndex: number | null
  /** Whether the child's projection is present; false rows show interim lifecycle data and are worth loading. */
  loaded: boolean
}

const LIFECYCLE_STATUS = {
  running: 'running', finished: 'done', failed: 'failed', interrupted: 'interrupted',
} as const

function endStatus(timing: TimingLike): AgentTreeStatus {
  const reason = timing.lastTurnEnd?.reason
  if (reason !== undefined) {
    switch (reason) {
      case 'completed':
      case 'forked': return 'done'
      case 'aborted':
      case 'interrupted':
      case 'blocked': return 'interrupted'
      default: return 'failed'
    }
  }
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
  // Heuristic: blocking calls carry no agent id, so pair by order, and only
  // when both sides have the same count (otherwise the pairing would guess).
  const blocking = lifecycles.filter(lifecycle => !lifecycle.background && !result.has(lifecycle.id))
  const unmapped = entries.filter(entry => !result.has(entry.id) && entry.mode === 'one-shot')
  if (unmapped.length === blocking.length) {
    unmapped.forEach((entry, position) => {
      const lifecycle = blocking[position]
      if (lifecycle !== undefined) result.set(entry.id, lifecycle.startIndex)
    })
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
  const lifecycleById = new Map(lifecycles.map(lifecycle => [lifecycle.id, lifecycle]))
  const walk = (parentId: string, depth: number, links: ReadonlyMap<string, number>) => {
    for (const entry of projectionsBySession[parentId]?.values.subagentCatalog ?? []) {
      if (visited.has(entry.id)) continue
      visited.add(entry.id)
      const projection = projectionsBySession[entry.id]
      const timing = projection?.values.subagentTiming
      // Unloaded child: fall back to the parent's start/settle records (depth 1 only).
      const fallback = timing === undefined && depth === 1 ? lifecycleById.get(entry.id) : undefined
      // An open turn in the projection counts as running even before byId says so.
      const running = byId[entry.id]?.running === true || timing?.active !== undefined
        || fallback?.status === 'running'
      const children = projection?.values.subagentCatalog ?? []
      rows.push({
        sessionId: entry.id,
        depth,
        label: entry.label ?? entry.id.slice(0, 8),
        shortId: entry.id.slice(0, 8),
        status: running
          ? 'running'
          : timing !== undefined ? endStatus(timing) : fallback === undefined ? 'unknown' : LIFECYCLE_STATUS[fallback.status],
        // One start source (never the lifecycle's) so the bar does not jump when the projection arrives.
        startedAt: entry.createdAt,
        endedAt: running ? null : timing?.lastTurnEnd?.at ?? fallback?.endedAt ?? null,
        activeMs: timing === undefined
          ? null
          : timing.settledMs + (timing.active === undefined ? 0 : Math.max(0, timing.active.through - timing.active.since)),
        hasChildren: children.length > 0,
        startIndex: links.get(entry.id) ?? null,
        loaded: projection !== undefined,
      })
      walk(entry.id, depth + 1, new Map())
    }
  }
  const catalog = projectionsBySession[rootId]?.values.subagentCatalog ?? []
  const links = startIndexes(catalog, lifecycles)
  // Blocking calls carry no agent id: with an unpaired one-shot catalog row they may be that row, so skip them.
  const ambiguous = catalog.some(entry => entry.mode === 'one-shot' && !links.has(entry.id))
  walk(rootId, 1, links)
  // The transcript proves these ran even when the catalog (unloaded or old-format root) lacks them.
  const linked = new Set(links.values())
  for (const lifecycle of lifecycles) {
    if (visited.has(lifecycle.id) || linked.has(lifecycle.startIndex)) continue
    if (ambiguous && !lifecycle.background) continue
    rows.push({
      sessionId: lifecycle.id,
      depth: 1,
      label: lifecycle.description === '' ? lifecycle.shortId : lifecycle.description,
      shortId: lifecycle.shortId,
      status: LIFECYCLE_STATUS[lifecycle.status],
      startedAt: lifecycle.startedAt,
      endedAt: lifecycle.status === 'running' ? null : lifecycle.endedAt,
      activeMs: null,
      hasChildren: false,
      startIndex: lifecycle.startIndex,
      loaded: false,
    })
  }
  return rows
}
