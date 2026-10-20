/** Measurable virtual-row grouping and durable identity contracts. */

import { describe, expect, it } from 'vitest'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import { CARD_COMPACT_ROW_HEIGHT, CARD_ROW_HEIGHT } from '../src/client/trajectory-card.ts'
import {
  CONTENT_ROW_HEIGHT, groupTrajectoryVirtualRows, TURN_START_ROW_HEIGHT,
  trajectoryVirtualRecordKey,
  type VirtualizableTrajectoryRecord,
} from '../src/client/trajectory-virtual-rows.ts'

function record(
  index: number,
  cell: Partial<TrajectoryCellProps> = {},
  collapsedSummaryKind?: 'turn' | 'assistant',
): VirtualizableTrajectoryRecord {
  return {
    cell: {
      index,
      kind: 'message',
      text: `record ${index}`,
      timeSeconds: 0,
      ...cell,
    },
    ...(collapsedSummaryKind === undefined ? {} : { collapsedSummaryKind }),
  }
}

describe('trajectory virtual rows', () => {
  it('groups zero-height request boundaries with the following content row', () => {
    const first = record(1, { requestOnly: true, sourceSeq: 10 })
    const second = record(2, { requestOnly: true, sourceSeq: 11 })
    const content = record(3, { sourceSeq: 12 })

    expect(groupTrajectoryVirtualRows([first, second, content])).toEqual([{
      entries: [
        { logicalIndex: 0, record: first },
        { logicalIndex: 1, record: second },
        { logicalIndex: 2, record: content },
      ],
      height: CONTENT_ROW_HEIGHT,
      key: trajectoryVirtualRecordKey(content),
    }])
  })

  it('retains terminal request-boundary clearance as a measurable row', () => {
    const content = record(1, { sourceSeq: 10 })
    const boundary = record(2, { requestOnly: true, sourceSeq: 11 })
    const rows = groupTrajectoryVirtualRows([content, boundary])

    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({
      entries: [{ logicalIndex: 1, record: boundary }],
      height: 9,
      key: trajectoryVirtualRecordKey(boundary),
    })
  })

  it('gives a turn-start row the box height plus the turn header', () => {
    const first = { ...record(1, { sourceSeq: 10 }), turnStart: true }

    expect(groupTrajectoryVirtualRows([first])[0]?.height).toBe(TURN_START_ROW_HEIGHT)
  })

  it('keeps every collapsed box kind at one height except the calls-only assistant box', () => {
    const kinds = ['user', 'context', 'message', 'thinking', 'tool', 'subtool'] as const
    const heights = kinds.map((kind, index) =>
      groupTrajectoryVirtualRows([record(index + 1, { kind, text: 'x', sourceSeq: index })])[0]?.height)
    expect(new Set(heights)).toEqual(new Set([CARD_ROW_HEIGHT]))

    const calls = { callsBadge: '→ Bash', text: '' }
    const compact = record(1, { ...calls, sourceSeq: 1 })
    expect(groupTrajectoryVirtualRows([compact])[0]?.height).toBe(CARD_COMPACT_ROW_HEIGHT)
    expect(CARD_COMPACT_ROW_HEIGHT).toBeLessThan(CARD_ROW_HEIGHT)
    expect(groupTrajectoryVirtualRows([{ ...compact, turnStart: true }])[0]?.height)
      .toBe(TURN_START_ROW_HEIGHT - CONTENT_ROW_HEIGHT + CARD_COMPACT_ROW_HEIGHT)
    expect(groupTrajectoryVirtualRows([record(2, { ...calls, text: 'with text', sourceSeq: 2 })])[0]?.height)
      .toBe(CARD_ROW_HEIGHT)
    expect(groupTrajectoryVirtualRows([record(3, { ...calls, previewMarkdown: 'said', sourceSeq: 3 })])[0]?.height)
      .toBe(CARD_ROW_HEIGHT)
  })

  it('uses the rendered collapsed-summary height', () => {
    const summary = record(1, { sourceSeq: 10 }, 'turn')

    expect(groupTrajectoryVirtualRows([summary])[0]?.height).toBe(20)
  })

  it('keeps an existing row key stable when older history is prepended', () => {
    const existing = record(2, { sourceSeq: 100 })
    const prepended = record(1, { sourceSeq: 10 })

    const before = groupTrajectoryVirtualRows([existing])[0]?.key
    const after = groupTrajectoryVirtualRows([prepended, existing])[1]?.key

    expect(after).toBe(before)
  })

  it('keeps the content key when a request boundary joins its row', () => {
    const content = record(2, { sourceSeq: 100 })
    const boundary = record(1, { requestOnly: true, sourceSeq: 99 })

    expect(groupTrajectoryVirtualRows([boundary, content])[0]?.key)
      .toBe(groupTrajectoryVirtualRows([content])[0]?.key)
  })

  it('distinguishes a folded summary from its source record', () => {
    const source = record(1, { sourceSeq: 10 })
    const summary = record(1, { sourceSeq: 10 }, 'assistant')

    expect(trajectoryVirtualRecordKey(summary)).not.toBe(trajectoryVirtualRecordKey(source))
  })

  it('exposes a DOM-safe semantic key', () => {
    const source = record(1, { callId: 'call with spaces/and?punctuation' })

    expect(trajectoryVirtualRecordKey(source)).toBe(
      'message%00call%00call%20with%20spaces%2Fand%3Fpunctuation',
    )
  })
})
