/** Projection loader: dedupe, concurrency cap, single retry. */
import { describe, expect, it } from 'vitest'
import { createProjectionLoader } from '../src/client/projection-loader.ts'

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
