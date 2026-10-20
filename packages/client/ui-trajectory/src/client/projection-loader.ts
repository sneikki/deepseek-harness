/** Bounded, deduplicated projection reads with one retry per id. */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface ProjectionLoader {
  /** Queue an id unless it is queued, in flight, or out of attempts. */
  request: (id: string) => void
}

/**
 * @param load - Reads one projection; resolves true when it is now present.
 * @param limit - Maximum reads in flight.
 * @param attempts - Reads per id (first try plus retries).
 */
export function createProjectionLoader(
  load: (id: string) => Promise<boolean>,
  limit = 4,
  attempts = 2,
): ProjectionLoader {
  const tries = new Map<string, number>()
  const queue: string[] = []
  const queued = new Set<string>()
  let running = 0
  const pump = () => {
    while (running < limit) {
      const id = queue.shift()
      if (id === undefined) return
      queued.delete(id)
      running++
      load(id).catch(() => false).then((ok) => {
        running--
        // A failed or empty read retries (once) by requeueing, never in a loop.
        if (!ok && (tries.get(id) ?? 0) < attempts) enqueue(id)
        pump()
      })
    }
  }
  const enqueue = (id: string) => {
    if (queued.has(id)) return
    tries.set(id, (tries.get(id) ?? 0) + 1)
    queued.add(id)
    queue.push(id)
    pump()
  }
  return {
    request: (id) => {
      if (queued.has(id) || tries.has(id)) return
      enqueue(id)
    },
  }
}

/** The `ctx.sessions` operations the child read needs. */
type ChildProjectionSessions = Pick<ISessions, 'refreshProjections' | 'subagentAddress' | 'using' | 'list'>

/**
 * Read one child's timing: the cheap projection read first, then its opened history.
 * A child still in a historical format only serves cache hints from the cheap read
 * (no timing, load state stays `migration-required`); the exact values arrive with
 * its opened history. The history is opened only through the child's subagent
 * address: a plain session target would promote the migrated log and publish it.
 * An external child has no address and is never opened.
 * @param sessions - `ctx.sessions`.
 * @returns a read of one child id; true once its timing is present.
 */
export function createChildProjectionReader(sessions: ChildProjectionSessions): (id: string) => Promise<boolean> {
  const timed = (id: SessionId) => sessions.list.getSnapshot().projectionsBySession[id]?.values.subagentTiming !== undefined
  return async (id) => {
    const sessionId = id as SessionId
    await sessions.refreshProjections(sessionId)
    if (timed(sessionId)) return true
    const address = sessions.subagentAddress(sessionId)
    if (address === undefined) return false
    await sessions.using(address, { source: 'trajectoryAgents' }, reference => reference.ready)
    return timed(sessionId)
  }
}
