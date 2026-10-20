/** Activity bucket of a Tool call; mirrors ui-chat's TurnActivity so the strip and this view colour alike. */
export type TrajectoryActivity = 'code' | 'review' | 'deploy' | 'proof' | 'other' | 'error'

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
  return 'other'
}
