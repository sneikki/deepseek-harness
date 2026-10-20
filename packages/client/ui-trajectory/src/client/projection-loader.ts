/** Bounded, deduplicated projection reads with one retry per id. */

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
