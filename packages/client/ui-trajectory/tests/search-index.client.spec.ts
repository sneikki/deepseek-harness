/** Search finds reasoning on its thinking row only, never on the assistant row. */

import { describe, expect, it, vi } from 'vitest'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { trajectoryPreviewTexts } from '../src/client/trajectory-preview.ts'
import { TrajectorySearchIndex } from '../src/client/trajectory-search-index.ts'
import { trajectoryRecordId } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

vi.mock('../src/client/trajectory-preview.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/trajectory-preview.ts')>()
  return { ...actual, trajectoryPreviewTexts: vi.fn(actual.trajectoryPreviewTexts) }
})

type Turns = ReturnType<typeof deriveTrajectoryLayout>

/** One assistant turn with a single reasoning block; `seq` picks the record id. */
function reasoningTurns(seq: number, text: string): Turns {
  const nodes = [{
    kind: 'assistant', seq, time: seq * 1_000, turn: 1, step: 1,
    blocks: [{ kind: 'reasoning', text }],
  }] as unknown as Parameters<typeof deriveTrajectoryLayout>[0]['nodes']
  return deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] }, t)
}

function thinkingIdOf(turns: Turns): string {
  const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
  return trajectoryRecordId(cells.find(cell => cell.kind === 'thinking')!)
}

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

  it('drops a superseded update that resolves after a newer one', async () => {
    const real = await vi.importActual<typeof import('../src/client/trajectory-preview.ts')>(
      '../src/client/trajectory-preview.ts',
    )
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(trajectoryPreviewTexts).mockImplementationOnce(async (texts) => {
      await gate
      return real.trajectoryPreviewTexts(texts)
    })
    const index = new TrajectorySearchIndex()
    const stale = index.update([reasoningTurns(2, 'zebra plan')])
    const newer = reasoningTurns(4, 'giraffe plan')
    await expect(index.update([newer])).resolves.toBe(true)

    release()
    await expect(stale).resolves.toBe(false)
    expect([...(index.search('zebra') ?? [])]).toEqual([])
    expect([...index.search('giraffe')!]).toEqual([thinkingIdOf(newer)])
  })

  it('keeps the index usable after a rejected parse and retries on the next update', async () => {
    vi.mocked(trajectoryPreviewTexts).mockRejectedValueOnce(new Error('parse failed'))
    const index = new TrajectorySearchIndex()
    const turns = reasoningTurns(2, 'zebra plan')
    // The view passes one memoized array, so the retry hits the same reference.
    const layouts = [turns]
    await expect(index.update(layouts)).rejects.toThrow('parse failed')
    expect([...(index.search('zebra') ?? [])]).toEqual([])

    await expect(index.update(layouts)).resolves.toBe(true)
    expect([...index.search('zebra')!]).toEqual([thinkingIdOf(turns)])
  })
})
