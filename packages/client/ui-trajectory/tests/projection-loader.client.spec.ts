/** Projection loader: dedupe, concurrency cap, single retry. */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createChildProjectionReader, createProjectionLoader } from '../src/client/projection-loader.ts'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createProjectionLoader', () => {
  it('requests each id once and respects the in-flight cap', async () => {
    const started: string[] = []
    const gates: (() => void)[] = []
    const loader = createProjectionLoader((id) => {
      started.push(id)
      return new Promise<boolean>((resolve) => { gates.push(() => { resolve(true) }) })
    }, 2)
    for (const id of ['a', 'b', 'c', 'd', 'a', 'b']) loader.request(id)
    expect(started).toEqual(['a', 'b'])
    gates[0]!()
    await flush()
    expect(started).toEqual(['a', 'b', 'c'])
    loader.request('a') // re-derive: no refetch
    loader.request('c')
    gates[1]!(); gates[2]!()
    await flush()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('requests a nested id that appears after its parent loaded', async () => {
    const started: string[] = []
    const loader = createProjectionLoader((id) => { started.push(id); return Promise.resolve(true) })
    loader.request('parent')
    await flush()
    loader.request('child')
    await flush()
    expect(started).toEqual(['parent', 'child'])
  })

  it('retries a failed or empty read once, then stops', async () => {
    let calls = 0
    const loader = createProjectionLoader(() => { calls++; return calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve(false) })
    loader.request('a')
    await flush(); await flush()
    expect(calls).toBe(2)
    loader.request('a')
    await flush()
    expect(calls).toBe(2)
  })
})

describe('createChildProjectionReader', () => {
  type SubagentAddress = NonNullable<ReturnType<ISessions['subagentAddress']>>
  const child = 'child' as SessionId
  const parent = 'parent' as SessionId
  /** Load state stays `migration-required` like a real historical-format child: only the values change. */
  function fake(address: SubagentAddress | undefined) {
    let values: Record<string, unknown> = {}
    const using = vi.fn((_target: unknown, _options: unknown, operation: (reference: { ready: Promise<void> }) => unknown) => {
      values = { subagentTiming: { settledMs: 1 } }
      return Promise.resolve(operation({ ready: Promise.resolve() }))
    })
    const sessions = {
      refreshProjections: vi.fn(() => Promise.resolve()),
      subagentAddress: vi.fn(() => address),
      list: { getSnapshot: () => ({ projectionsBySession: { [child]: { state: 'migration-required', values } } }) },
      using,
    }
    return { sessions: sessions as unknown as Parameters<typeof createChildProjectionReader>[0], using }
  }

  it('opens a hints-only child once through its subagent address and reads timing without a ready state', async () => {
    const address: SubagentAddress = { parentSessionId: parent, childSessionId: child, mode: 'continuable' }
    const { sessions, using } = fake(address)
    expect(await createChildProjectionReader(sessions)(child)).toBe(true)
    expect(using).toHaveBeenCalledExactlyOnceWith(address, { source: 'trajectoryAgents' }, expect.any(Function))
  })

  it('never opens a child without a subagent address (a plain target would publish the migrated log)', async () => {
    const { sessions, using } = fake(undefined)
    expect(await createChildProjectionReader(sessions)(child)).toBe(false)
    expect(using).not.toHaveBeenCalled()
  })
})
