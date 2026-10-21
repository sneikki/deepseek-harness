/** Search finds reasoning on its thinking row only, never on the assistant row. */

import { describe, expect, it } from 'vitest'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { TrajectorySearchIndex } from '../src/client/trajectory-search-index.ts'
import { trajectoryRecordId } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

describe('TrajectorySearchIndex', () => {
  it('matches reasoning on the thinking row and not on the assistant row', async () => {
    const nodes = [{
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
      blocks: [
        { kind: 'reasoning', text: 'zebra plan' },
        { kind: 'text', text: 'giraffe answer' },
      ],
    }] as unknown as Parameters<typeof deriveTrajectoryLayout>[0]['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] }, t)
    const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
    const thinking = cells.find(cell => cell.kind === 'thinking')!
    const message = cells.find(cell => cell.kind === 'message')!
    const index = new TrajectorySearchIndex()
    await index.update([turns])

    expect([...index.search('zebra')!]).toEqual([trajectoryRecordId(thinking)])
    expect([...index.search('giraffe')!]).toEqual([trajectoryRecordId(message)])
  })
})
