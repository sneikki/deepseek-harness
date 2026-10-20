/** Subagent tree derivation and the wall-clock to domain mapping. */
import { describe, expect, it } from 'vitest'
import { deriveTrajectoryTimeline, type TrajectoryTimelineMode } from '../src/client/timeline.ts'
import { deriveAgentTree, type AgentTreeProjectionLike } from '../src/client/trajectory-agent-tree.ts'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import type { TrajectorySubagentLifecycle } from '../src/client/trajectory-subagent.ts'

type Entry = { id: string; createdAt: number; mode: string; label?: string }
const proj = (
  catalog?: Entry[],
  timing?: AgentTreeProjectionLike['values']['subagentTiming'],
): AgentTreeProjectionLike => ({ values: { subagentCatalog: catalog, subagentTiming: timing } })
const entry = (id: string, createdAt: number, label?: string, mode = 'continuable'): Entry =>
  ({ id, createdAt, mode, ...(label === undefined ? {} : { label }) })
const life = (id: string, startIndex: number, background: boolean): TrajectorySubagentLifecycle => ({
  id, shortId: id.slice(0, 8), description: '', background, status: 'finished', startIndex,
  endIndex: null, startedAt: null, endedAt: null, reportCount: 0, controlCount: 0,
})

describe('deriveAgentTree', () => {
  const projections = {
    root: proj([entry('aaaaaaaa1', 10, 'A'), entry('bbbbbbbb2', 20)]),
    aaaaaaaa1: proj([entry('cccccccc3', 15, 'C')], { settledMs: 100, lastTurnEnd: { at: 50, reason: 'completed' } }),
    cccccccc3: proj([], { settledMs: 5, active: { since: 40, through: 47 } }),
    bbbbbbbb2: proj([], { settledMs: 7, lastTurnEnd: { at: 90, reason: 'aborted' } }),
  }
  const byId = { cccccccc3: { running: true } }

  it('walks depth-first in catalog order with depth, status, timing and links', () => {
    const rows = deriveAgentTree('root', byId, projections, [life('aaaaaaaa1', 4, true)])
    expect(rows.map(row => [row.sessionId, row.depth])).toEqual([
      ['aaaaaaaa1', 1], ['cccccccc3', 2], ['bbbbbbbb2', 1],
    ])
    expect(rows.map(row => row.status)).toEqual(['done', 'running', 'interrupted'])
    expect(rows[0]).toMatchObject({ label: 'A', shortId: 'aaaaaaaa', startedAt: 10, endedAt: 50, activeMs: 100, hasChildren: true, startIndex: 4 })
    expect(rows[1]).toMatchObject({ endedAt: null, activeMs: 12, hasChildren: false, startIndex: null })
    expect(rows[2]).toMatchObject({ label: 'bbbbbbbb', startIndex: null })
  })

  it('maps non-completed non-abort reasons to failed', () => {
    const rows = deriveAgentTree('root', {}, {
      root: proj([entry('x1', 1)]),
      x1: proj([], { settledMs: 0, lastTurnEnd: { at: 2, reason: 'error' } }),
    }, [])
    expect(rows[0]?.status).toBe('failed')
  })

  it('falls back to lastTurnCompleted, then unknown, without lastTurnEnd', () => {
    const rows = deriveAgentTree('root', {}, {
      root: proj([entry('x1', 1), entry('x2', 2), entry('x3', 3)]),
      x1: proj([], { settledMs: 0, lastTurnCompleted: true }),
      x2: proj([], { settledMs: 0, lastTurnCompleted: false }),
      x3: proj([], { settledMs: 0 }),
    }, [])
    expect(rows.map(row => row.status)).toEqual(['done', 'failed', 'unknown'])
  })

  it('keeps a row with nulls when the projection is missing', () => {
    const rows = deriveAgentTree('root', { x1: { running: true } }, { root: proj([entry('x1', 1), entry('x2', 2)]) }, [])
    expect(rows[0]).toMatchObject({ status: 'running', endedAt: null, activeMs: null, hasChildren: false })
    expect(rows[1]).toMatchObject({ status: 'unknown', startedAt: 2, endedAt: null, activeMs: null })
  })

  it('stops at cycles and never lists the root', () => {
    const rows = deriveAgentTree('root', {}, {
      root: proj([entry('x1', 1)]),
      x1: proj([entry('x2', 2), entry('root', 3)]),
      x2: proj([entry('x1', 4)]),
    }, [])
    expect(rows.map(row => row.sessionId)).toEqual(['x1', 'x2'])
  })

  it('returns nothing for an unknown root', () => {
    expect(deriveAgentTree('nope', {}, {}, [])).toEqual([])
  })

  it('matches blocking one-shot calls to unmapped catalog entries in order', () => {
    const rows = deriveAgentTree('root', {}, {
      root: proj([entry('x1', 1, undefined, 'one-shot'), entry('x2', 2, undefined, 'continuable'), entry('x3', 3, undefined, 'one-shot')]),
    }, [life('call-1', 7, false), life('x2', 8, true), life('call-2', 9, false)])
    expect(rows.map(row => row.startIndex)).toEqual([7, 8, 9])
  })

  it('leaves surplus one-shot entries unlinked', () => {
    const rows = deriveAgentTree('root', {}, {
      root: proj([entry('x1', 1, undefined, 'one-shot'), entry('x2', 2, undefined, 'one-shot')]),
    }, [life('call-1', 7, false)])
    expect(rows.map(row => row.startIndex)).toEqual([7, null])
  })
})

const cell = (index: number, startedAt: number, timeSeconds: number) => ({
  index, startedAt, timeSeconds, kind: 'tool', text: `c${index}`, toolName: 'bash',
})
const turnsOf = (...cells: ReturnType<typeof cell>[]) => [{
  turn: 1, groups: [{ cells }],
}] as unknown as readonly TrajectoryTurnModel[]

describe('wallToDomain', () => {
  const turns = turnsOf(cell(1, 1_000, 1), cell(2, 5_000, 1))

  it('interpolates, extrapolates with slope 1 and stays monotone in actual mode', () => {
    const map = deriveTrajectoryTimeline(turns, 'actual')!.wallToDomain
    expect(map(1_000)).toBe(1_000)
    expect(map(3_000)).toBe(3_000)
    expect(map(5_000)).toBe(5_000)
    expect(map(7_000)).toBe(7_000)
    expect(map(0)).toBe(0)
    const samples = [0, 500, 1_000, 2_000, 4_999, 5_000, 9_000].map(map)
    expect(samples).toEqual([...samples].sort((a, b) => a - b))
  })

  it('clamps in sequence mode', () => {
    const map = deriveTrajectoryTimeline(turns, 'sequence')!.wallToDomain
    expect([map(0), map(1_000), map(3_000), map(5_000), map(9_000)]).toEqual([0, 0, 0.5, 1, 1])
  })

  it('squeezes idle in duration mode unless descendants cover it', () => {
    const squeezed = deriveTrajectoryTimeline(turns, 'duration')!
    expect(squeezed.wallToDomain(5_000)).toBe(2_000)
    const covered = deriveTrajectoryTimeline(turns, 'duration' satisfies TrajectoryTimelineMode, [{ start: 2_000, end: 5_000 }])!
    expect(covered.wallToDomain(5_000)).toBe(5_000)
    expect(covered.wallToDomain(3_500)).toBe(3_500)
  })

  it('is identity (wall) or zero (sequence) without timed records', () => {
    const none = turnsOf({ index: 1, startedAt: null, timeSeconds: null, kind: 'tool', text: 'x', toolName: 'bash' } as never)
    expect(deriveTrajectoryTimeline(none, 'sequence')!.wallToDomain(42)).toBe(0)
  })
})
