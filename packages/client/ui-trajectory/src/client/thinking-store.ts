import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'

/**
 * Create the browser-wide preference for showing thinking rows.
 * @returns a persisted source, shown by default, shared by every session view in one plugin lifecycle.
 */
export function createTrajectoryThinkingStore(): SnapshotStore<boolean> {
  return createSnapshotStore(true, {
    persist: { name: 'dsh.trajectory.thinking' },
  })
}
