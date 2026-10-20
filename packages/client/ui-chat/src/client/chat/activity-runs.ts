import type { TurnActivity } from '../contract/turn-process.ts'

/** Consecutive Tool calls of one activity class. */
export interface ActivityRun { readonly kind: TurnActivity; readonly count: number; readonly start: number }

/**
 * Collapse consecutive equal activity classes into counted runs, order kept.
 * 'error' is its own class, so it never merges with a non-error call.
 */
export function groupActivityRuns(activity: readonly TurnActivity[]): ActivityRun[] {
  const runs: { kind: TurnActivity; count: number; start: number }[] = []
  for (const [index, kind] of activity.entries()) {
    const last = runs.at(-1)
    if (last?.kind === kind) last.count++
    else runs.push({ kind, count: 1, start: index })
  }
  return runs
}
