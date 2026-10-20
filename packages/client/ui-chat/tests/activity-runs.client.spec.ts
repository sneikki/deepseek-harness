import { describe, expect, it } from 'vitest'
import { groupActivityRuns } from '../src/client/chat/activity-runs.ts'

describe('groupActivityRuns', () => {
  it('empty', () => expect(groupActivityRuns([])).toEqual([]))
  it('single', () => expect(groupActivityRuns(['code'])).toEqual([{ kind: 'code', count: 1, start: 0 }]))
  it('collapses runs in order', () => {
    expect(groupActivityRuns(['deploy', 'deploy', 'code', 'deploy'])).toEqual([
      { kind: 'deploy', count: 2, start: 0 }, { kind: 'code', count: 1, start: 2 }, { kind: 'deploy', count: 1, start: 3 },
    ])
  })
  it('error splits a run', () => {
    expect(groupActivityRuns(['code', 'code', 'error', 'code']).map(r => r.count)).toEqual([2, 1, 1])
  })
  it('keeps a trailing run whole', () => {
    expect(groupActivityRuns(['review', 'code', 'code', 'code']).at(-1)).toEqual({ kind: 'code', count: 3, start: 1 })
  })
})
