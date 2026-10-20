// @vitest-environment jsdom
/** Stacked-track packing for overlapping timeline records. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  layoutTimelineLanes, packTimelineTracks, TIMELINE_MAX_TRACKS,
  type TrajectoryTimelineModel, type TrajectoryTimelineSpan,
} from '../src/client/timeline.ts'
import { TrajectoryTimeline } from '../src/client/TrajectoryTimeline.tsx'
import { t } from './locale.client.ts'

afterEach(cleanup)

const span = (index: number, start: number, end: number, lane = 2): TrajectoryTimelineSpan => ({
  index, start, end, lane, kind: 'tool', isError: false, label: `s${index}`, toolName: 'bash',
})
const modelOf = (spans: TrajectoryTimelineSpan[]): TrajectoryTimelineModel => ({
  start: 0, end: Math.max(...spans.map(s => s.end)), spans, turnBoundaries: [], subagents: [], wallToDomain: t => t,
})

describe('packTimelineTracks', () => {
  it('lets disjoint and touching intervals share one track', () => {
    expect(packTimelineTracks([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 5, end: 6 }]))
      .toEqual({ tracks: [0, 0, 0], count: 1, overflow: 0 })
  })

  it('uses k tracks for k-way overlap and reuses a freed one', () => {
    const packed = packTimelineTracks([
      { start: 0, end: 10 }, { start: 1, end: 5 }, { start: 2, end: 4 }, { start: 6, end: 8 },
    ])
    expect(packed).toEqual({ tracks: [0, 1, 2, 1], count: 3, overflow: 0 })
  })

  it('packs by start time whatever the input order', () => {
    expect(packTimelineTracks([{ start: 5, end: 9 }, { start: 0, end: 6 }]).tracks).toEqual([1, 0])
  })

  it('caps the tracks and counts what spills onto the last one', () => {
    const items = Array.from({ length: TIMELINE_MAX_TRACKS + 3 }, () => ({ start: 0, end: 10 }))
    const packed = packTimelineTracks(items)
    expect(packed.count).toBe(TIMELINE_MAX_TRACKS)
    expect(packed.overflow).toBe(3)
    expect(Math.max(...packed.tracks)).toBe(TIMELINE_MAX_TRACKS - 1)
  })
})

describe('layoutTimelineLanes', () => {
  it('keeps the roomy single-track lane height and grows overlapping lanes compactly', () => {
    const single = layoutTimelineLanes(modelOf([span(1, 0, 1), span(2, 1, 2)]))
    expect(single.plotHeight).toBe(50)
    expect(single.lanes.map(l => l.tracks)).toEqual([1, 1, 1])
    const parallel = layoutTimelineLanes(modelOf([span(1, 0, 5), span(2, 1, 6), span(3, 2, 7)]))
    expect(parallel.lanes[2]).toMatchObject({ tracks: 3, pitch: 8, bar: 6, height: 28, top: 28 })
    expect(parallel.plotHeight).toBe(14 + 14 + 28 + 8)
    expect([...parallel.spanTrack.values()]).toEqual([0, 1, 2])
  })
})

describe('stacked rendering', () => {
  it('draws overlapping tools on separate tracks, each still selecting its own record', () => {
    const spans = [span(1, 0, 5), span(2, 1, 6)]
    const model = modelOf(spans)
    const turns = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: spans.map(s => ({
          index: s.index, kind: 'tool' as const, text: 'bash', toolName: 'bash',
          startedAt: s.start * 1000, timeSeconds: s.end - s.start,
        })),
      }],
    }]
    const onRecordSelect = vi.fn()
    const view = render(
      <TrajectoryTimeline t={t} turns={turns} mode="actual" range={null}
        onRangeChange={vi.fn()} onRecordSelect={onRecordSelect} />,
    )
    const bars = [...view.container.querySelectorAll<HTMLElement>('[data-timeline-record-index]')]
    expect(model.spans).toHaveLength(2)
    const tops = bars.map(bar => bar.style.getPropertyValue('--trajectory-span-top'))
    expect(new Set(tops).size).toBe(2)
    expect(bars.map(bar => bar.style.getPropertyValue('--trajectory-span-height'))).toEqual(['6px', '6px'])
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    fireEvent.pointerDown(bars[1]!, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(plot, { button: 0, clientX: 10, pointerId: 1 })
    expect(onRecordSelect).toHaveBeenCalledWith(2)
  })
})
