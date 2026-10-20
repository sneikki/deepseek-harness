import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '../src/index.ts'
import { SUBAGENT_DESCRIPTOR_VERSION } from '../src/descriptor.ts'
import { subagentIdentityProjectionDefinition, subagentTimingProjectionDefinition, type TimingState } from '../src/projection.ts'

function event(
  type: SessionEvent['type'],
  seq: number,
  time: number,
  reason: TurnEndReason = { kind: 'completed' },
): SessionEvent {
  return {
    type,
    seq,
    time,
    data: type === 'turn/end' ? { turn: 1, reason } : {},
  } as SessionEvent
}

function fold(events: SessionEvent[]) {
  let state: TimingState = subagentTimingProjectionDefinition.init()
  for (const item of events) state = subagentTimingProjectionDefinition.apply(state, item)
  return subagentTimingProjectionDefinition.wire.view(state)
}

describe('subagent timing projection', () => {
  it('preserves historical one-shot identity without inventing a label', () => {
    const descriptor = {
      ...event('subagent/descriptor', 1, 110),
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn' },
    } as SessionEvent
    const state = subagentIdentityProjectionDefinition.apply(subagentIdentityProjectionDefinition.init(), descriptor)
    expect(subagentIdentityProjectionDefinition.wire.view(state)).toEqual({ mode: 'one-shot', seq: 1 })
  })

  it('registers with the optional session projection registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await mountWorkingDirectoryFixture(ctx)
    const serviceFiber = await ctx.plugin(SubagentRuntime)

    const before = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(before.subagentTiming).toEqual({ settledMs: 0 })
    // The identity unit registers alongside timing; an empty log serves its
    // serializable null sentinel.
    expect(before.subagent).toBeNull()
    await serviceFiber.dispose()
    const after = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(after.subagentTiming).toBeUndefined()
    expect(after.subagent).toBeUndefined()
  })

  it('resets inherited seed timing at the child descriptor and sums later completed turns', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 300),
      event('turn/start', 3, 1_000),
      event('subagent/descriptor', 4, 1_100),
      event('turn/end', 5, 4_100),
      event('turn/start', 6, 10_000),
      event('turn/end', 7, 12_000),
    ])).toEqual({ settledMs: 5_100, lastTurnCompleted: true, lastTurnEnd: { at: 12_000, reason: 'completed' } })
  })

  it('exposes an open turn start and never subtracts time for reversed boundaries', () => {
    expect(fold([
      event('turn/start', 0, 1_000),
      event('subagent/descriptor', 1, 1_100),
      event('turn/end', 2, 900),
      event('turn/start', 3, 2_000),
      event('assistant/attempt', 4, 2_500),
    ])).toEqual({
      settledMs: 0,
      active: { since: 2_000, through: 2_500 },
      lastTurnEnd: { at: 900, reason: 'completed' },
    })
  })

  it('publishes the latest closed turn end and clears only the completion flag when another turn opens', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
      event('turn/end', 4, 400, { kind: 'interrupted' }),
    ])).toEqual({ settledMs: 200, lastTurnCompleted: false, lastTurnEnd: { at: 400, reason: 'interrupted' } })

    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
    ])).toEqual({
      settledMs: 100,
      active: { since: 300, through: 300 },
      lastTurnEnd: { at: 200, reason: 'completed' },
    })
  })

  it('ignores completed pre-descriptor turns and unrelated events', () => {
    const initial = subagentTimingProjectionDefinition.init()
    expect(subagentTimingProjectionDefinition.apply(
      initial,
      event('assistant/attempt', 0, 1),
    )).toBe(initial)
    expect(subagentTimingProjectionDefinition.apply(
      initial,
      event('turn/end', 1, 2),
    )).toBe(initial)
    const descriptor = subagentTimingProjectionDefinition.apply(
      initial,
      event('subagent/descriptor', 2, 3),
    )
    expect(subagentTimingProjectionDefinition.apply(
      descriptor,
      event('turn/end', 3, 4),
    )).toEqual({ ...descriptor, lastTurnCompleted: true, lastTurnEnd: { at: 4, reason: 'completed' } })
    expect(fold([
      event('turn/start', 0, 100),
      event('turn/end', 1, 200),
      event('subagent/descriptor', 2, 300),
    ])).toEqual({ settledMs: 0 })
  })

  it('records the wall-clock end and reason of the latest post-descriptor turn', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/start', 2, 150),
      event('turn/end', 3, 200),
    ])).toEqual({ settledMs: 50, lastTurnCompleted: true, lastTurnEnd: { at: 200, reason: 'completed' } })
  })

  it('overwrites the recorded end with the second turn', () => {
    expect(fold([
      event('subagent/descriptor', 0, 110),
      event('turn/start', 1, 150),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
      event('turn/end', 4, 500, { kind: 'blocked' }),
    ])).toEqual({ settledMs: 250, lastTurnCompleted: false, lastTurnEnd: { at: 500, reason: 'blocked' } })
  })

  it('resets the recorded end at a fork-seed descriptor', () => {
    const view = fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('subagent/descriptor', 3, 300),
    ])
    expect(view).toEqual({ settledMs: 0 })
    expect(view).not.toHaveProperty('lastTurnEnd')
  })

  it('is stateVersion 4 and its recorded end survives the state schema', () => {
    expect(subagentTimingProjectionDefinition.stateVersion).toBe(4)
    const state = subagentTimingProjectionDefinition.apply(
      subagentTimingProjectionDefinition.init(),
      event('subagent/descriptor', 0, 110),
    )
    const closed = subagentTimingProjectionDefinition.apply(state, event('turn/end', 1, 200, { kind: 'blocked' }))
    expect(subagentTimingProjectionDefinition.stateSchema.parse(closed)).toEqual(closed)
    expect(closed.lastTurnEnd).toEqual({ at: 200, reason: 'blocked' })
  })
})
