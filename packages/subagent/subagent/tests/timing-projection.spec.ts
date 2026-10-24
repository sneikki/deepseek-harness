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

  it('waits for the session projection registry and releases its projections on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await mountWorkingDirectoryFixture(ctx)
    const pending = ctx.plugin(SubagentRuntime)
    expect(ctx.get('subagents')).toBeUndefined()
    await ctx.plugin(SessionProjectionRegistry)
    const serviceFiber = await pending

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
    ])).toEqual({
      settledMs: 5_100,
      lastTurnCompleted: true,
      lastTurnEnd: { at: 12_000, reason: 'completed' },
      turns: [
        { start: 1_000, end: 4_100, reason: 'completed' },
        { start: 10_000, end: 12_000, reason: 'completed' },
      ],
    })
  })

  it('lists interrupted, resumed and running turns in order with the open one last', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 600, { kind: 'interrupted' }),
      event('turn/start', 3, 9_000),
      event('turn/end', 4, 9_500),
      event('turn/start', 5, 20_000),
      event('assistant/attempt', 6, 20_300),
    ])).toEqual({
      settledMs: 500 + 500,
      active: { since: 20_000, through: 20_300 },
      lastTurnEnd: { at: 9_500, reason: 'completed' },
      turns: [
        { start: 100, end: 600, reason: 'interrupted' },
        { start: 9_000, end: 9_500, reason: 'completed' },
        { start: 20_000, end: null, reason: null },
      ],
    })
  })

  it('clamps a reversed turn end to its start', () => {
    expect(fold([
      event('subagent/descriptor', 0, 1),
      event('turn/start', 1, 1_000),
      event('turn/end', 2, 900),
    ]).turns).toEqual([{ start: 1_000, end: 1_000, reason: 'completed' }])
  })

  it('closes an open turn at the next turn start with an unknown reason', () => {
    expect(fold([
      event('subagent/descriptor', 0, 1),
      event('turn/start', 1, 1_000),
      event('turn/start', 2, 3_000),
    ])).toMatchObject({
      settledMs: 2_000,
      active: { since: 3_000, through: 3_000 },
      turns: [{ start: 1_000, end: 3_000, reason: null }, { start: 3_000, end: null, reason: null }],
    })
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
      turns: [{ start: 1_000, end: 1_000, reason: 'completed' }, { start: 2_000, end: null, reason: null }],
    })
  })

  it('publishes the latest closed turn end and clears only the completion flag when another turn opens', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
      event('turn/end', 4, 400, { kind: 'interrupted' }),
    ])).toMatchObject({ settledMs: 200, lastTurnCompleted: false, lastTurnEnd: { at: 400, reason: 'interrupted' } })

    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
    ])).toMatchObject({
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
    // The unended turn opened at 100 is closed by the start at 150 (50 ms), then 150..200 completes.
    ])).toMatchObject({ settledMs: 100, lastTurnCompleted: true, lastTurnEnd: { at: 200, reason: 'completed' } })
  })

  it('overwrites the recorded end with the second turn', () => {
    expect(fold([
      event('subagent/descriptor', 0, 110),
      event('turn/start', 1, 150),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
      event('turn/end', 4, 500, { kind: 'blocked' }),
    ])).toMatchObject({ settledMs: 250, lastTurnCompleted: false, lastTurnEnd: { at: 500, reason: 'blocked' } })
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

  it('is stateVersion 5 and its recorded end survives the state schema', () => {
    expect(subagentTimingProjectionDefinition.stateVersion).toBe(5)
    const state = subagentTimingProjectionDefinition.apply(
      subagentTimingProjectionDefinition.init(),
      event('subagent/descriptor', 0, 110),
    )
    const closed = subagentTimingProjectionDefinition.apply(state, event('turn/end', 1, 200, { kind: 'blocked' }))
    expect(subagentTimingProjectionDefinition.stateSchema.parse(closed)).toEqual(closed)
    expect(closed.lastTurnEnd).toEqual({ at: 200, reason: 'blocked' })
  })

  it('round-trips a plugin-added turn end kind through the state and view schemas', () => {
    const state = {
      descriptorSeen: true,
      settledMs: 0,
      lastTurnEnd: { at: 5, reason: 'plugin-custom' },
      turns: [{ start: 1, end: 5, reason: 'plugin-custom' }],
    }
    expect(subagentTimingProjectionDefinition.stateSchema.parse(state)).toEqual(state)
    // A plugin-added kind is outside the built-in union; the schemas must still accept it.
    type ViewInput = Parameters<typeof subagentTimingProjectionDefinition.wire.view>[0]
    const view = subagentTimingProjectionDefinition.wire.view(state as unknown as ViewInput)
    expect(subagentTimingProjectionDefinition.wire.viewSchema.parse(view)).toEqual({
      settledMs: 0,
      lastTurnEnd: { at: 5, reason: 'plugin-custom' },
      turns: [{ start: 1, end: 5, reason: 'plugin-custom' }],
    })
  })
})
