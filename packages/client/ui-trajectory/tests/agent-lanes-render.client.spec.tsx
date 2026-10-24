// @vitest-environment jsdom
/** Subagent lanes stay continuous across the virtualized rows of the transcript. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { TrajectoryTable } from '../src/client/TrajectoryTable.tsx'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import { deriveAgentLanes } from '../src/client/trajectory-agent-lanes.ts'
import { correlateTrajectorySubagents, trajectorySubagentLifecycles } from '../src/client/trajectory-subagent.ts'
import { t, toolLabels } from './locale.client.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

const COUNT = 500
const START = 5
const END = 400
const agentId = (n: number) => `2c619f7${n}-fff4-4203-95f6-ce61ca1f4359`

/** `agents` background agents spawned on consecutive records from START, all settling from END.
 *  `report` makes that record a report from agent 0. */
function ledger(agents = 1, report?: number): TrajectoryTurnModel[] {
  const cells: TrajectoryCellProps[] = Array.from({ length: COUNT }, (_, position) => {
    const index = position + 1
    if (index >= START && index < START + agents) {
      const id = agentId(index - START)
      return {
        index, kind: 'tool', text: 'Spawn', toolName: 'subagent', callId: `c${index}`, timeSeconds: 0.1, startedAt: 1_000,
        inputDetail: JSON.stringify({ description: `Lane agent ${index - START}` }), outputDetail: `started subagent ${id}`,
      }
    }
    if (index >= END && index < END + agents) {
      const id = agentId(index - END)
      return {
        index, kind: 'context', text: 'Settled', timeSeconds: 0, startedAt: 9_000,
        messageSource: {
          kind: 'subagent-settled', senderSessionId: id,
          summary: `Background subagent ${id} finished and will do no further work unless you send it more.`,
        },
      }
    }
    if (index === report) {
      return {
        index, kind: 'context', text: 'Report', timeSeconds: 0, startedAt: 1_000 + index,
        messageSource: { kind: 'agent-message', senderSessionId: agentId(0), summary: 'report' },
      }
    }
    return { index, kind: 'context', text: `Context ${index}`, timeSeconds: 0, startedAt: 1_000 + index }
  })
  return correlateTrajectorySubagents([{ turn: 1, groups: [{ title: 'Context', cells }] }]) as TrajectoryTurnModel[]
}

describe('subagent lanes in the virtual ledger', () => {
  it('draws a lane on every mounted row between spawn and end, through scrolling', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const turns = ledger()
    const agentLanes = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns))
    const view = render(
      <TrajectoryTable
        t={t} toolLabels={toolLabels} turns={turns} agentLanes={agentLanes}
        renderSlot={() => null} loadImage={async () => 'blob:x'}
        collapsedTurns={new Set()} onToggleTurn={() => {}} collapsedAssistants={new Set()} onToggleAssistant={() => {}}
      />,
    )
    const states = () => [...view.container.querySelectorAll<HTMLElement>('tr[data-record-index]')].map(row => ({
      index: Number(row.dataset.recordIndex),
      state: row.querySelector<HTMLElement>('[data-lane-id]')?.dataset.state,
      spawn: row.querySelector('[data-lane-spawn]') !== null,
    }))
    await waitFor(() => { expect(states().length).toBeGreaterThan(0) })
    expect(states().length).toBeLessThan(COUNT)
    expect(states().find(row => row.index === START)).toEqual({ index: START, state: 'start', spawn: true })
    expect(states().filter(row => row.index < START).every(row => row.state === undefined)).toBe(true)
    // The card column is padded for one lane; the rail column keeps its width.
    expect(view.container.querySelector<HTMLElement>('table')?.style.getPropertyValue('--trajectory-lane-zone')).toBe('31px')
    expect(view.container.querySelector<HTMLElement>('col')?.style.width).toBe('')
    // The lane is drawn in the card cell (right of the cards), bending out of the spawn card.
    const spawnRow = view.container.querySelector(`tr[data-record-index="${START}"]`)!
    expect(spawnRow.querySelector('td:last-child [data-lane-id] svg path')).not.toBeNull()

    const pane = view.container.querySelector('table')!.parentElement as HTMLElement
    pane.scrollTop = 9_000
    fireEvent.scroll(pane)
    await waitFor(() => { expect(Math.min(...states().map(row => row.index))).toBeGreaterThan(START + 20) })
    const middle = states()
    expect(middle.length).toBeGreaterThan(5)
    expect(middle.filter(row => row.index < END).every(row => row.state === 'pass')).toBe(true)
    expect(middle.some(row => row.spawn)).toBe(false)
  })

  it('handles a click on a lane itself: the spawn record, never the card underneath', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const turns = ledger()
    const agentLanes = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns))
    const onRecordSelect = vi.fn()
    const view = render(
      <TrajectoryTable
        t={t} toolLabels={toolLabels} turns={turns} agentLanes={agentLanes} onRecordSelect={onRecordSelect}
        renderSlot={() => null} loadImage={async () => 'blob:x'}
        collapsedTurns={new Set()} onToggleTurn={() => {}} collapsedAssistants={new Set()} onToggleAssistant={() => {}}
      />,
    )
    await waitFor(() => { expect(view.container.querySelector(`tr[data-record-index="${START + 3}"]`)).toBeTruthy() })
    const unrelated = view.container.querySelector(`tr[data-record-index="${START + 3}"]`)!
    fireEvent.click(unrelated.querySelector('[data-lane-id] i')!)
    expect(onRecordSelect).toHaveBeenCalledTimes(1)
    expect(onRecordSelect).toHaveBeenCalledWith(START)
    expect(unrelated.getAttribute('aria-selected')).toBe('false')
  })

  it('selects the record each lane part belongs to: the bend and body the spawn, a marker its own event, the end marker the end', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const turns = ledger(1, START + 10)
    const agentLanes = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns))
    const onRecordSelect = vi.fn()
    const view = render(
      <TrajectoryTable
        t={t} toolLabels={toolLabels} turns={turns} agentLanes={agentLanes} onRecordSelect={onRecordSelect}
        renderSlot={() => null} loadImage={async () => 'blob:x'}
        collapsedTurns={new Set()} onToggleTurn={() => {}} collapsedAssistants={new Set()} onToggleAssistant={() => {}}
      />,
    )
    const row = (index: number) => view.container.querySelector<HTMLElement>(`tr[data-record-index="${index}"]`)
    await waitFor(() => { expect(row(START)).toBeTruthy() })
    // The bend out of the spawn card belongs to the spawn record.
    fireEvent.click(row(START)!.querySelector('[data-lane-id] svg path')!)
    expect(onRecordSelect).toHaveBeenLastCalledWith(START)
    // The report marker is its own event: it selects that record, not the spawn.
    fireEvent.click(row(START + 10)!.querySelector('[data-marker="report"]')!)
    expect(onRecordSelect).toHaveBeenLastCalledWith(START + 10)
    expect(onRecordSelect).not.toHaveBeenLastCalledWith(START)
    // The end marker selects the lane's end record, reached by scrolling down.
    const pane = view.container.querySelector('table')!.parentElement as HTMLElement
    for (let top = 9_000; row(END) === null && top < 200_000; top += 3_000) {
      pane.scrollTop = top
      fireEvent.scroll(pane)
    }
    await waitFor(() => { expect(row(END)).toBeTruthy() })
    fireEvent.click(row(END)!.querySelector('[data-marker="done"]')!)
    expect(onRecordSelect).toHaveBeenLastCalledWith(END)
    expect(onRecordSelect).toHaveBeenCalledTimes(3)
  })

  it('marks the whole agent when its lane is selected: the other cards and the lane, not unrelated rows', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const turns = ledger(1, START + 10)
    const agentLanes = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns))
    const view = render(
      <TrajectoryTable
        t={t} toolLabels={toolLabels} turns={turns} agentLanes={agentLanes}
        renderSlot={() => null} loadImage={async () => 'blob:x'}
        collapsedTurns={new Set()} onToggleTurn={() => {}} collapsedAssistants={new Set()} onToggleAssistant={() => {}}
      />,
    )
    const row = (index: number) => view.container.querySelector<HTMLElement>(`tr[data-record-index="${index}"]`)
    await waitFor(() => { expect(row(START + 10)).toBeTruthy() })
    expect(row(START + 10)!.dataset.agentSelected).toBeUndefined()
    fireEvent.click(row(START + 5)!.querySelector('[data-lane-id] i')!)
    await waitFor(() => { expect(row(START)!.dataset.selected).toBe('true') })
    expect(row(START + 10)!.dataset.agentSelected).toBe('true')
    expect(row(START + 5)!.dataset.agentSelected).toBeUndefined()
    expect(row(START + 5)!.querySelector('[data-lane-id]')!.hasAttribute('data-lane-selected')).toBe(true)
  })

  it('folds lanes beyond the cap into one +N chip at the row where they start', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const turns = ledger(8)
    const agentLanes = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns))
    expect(agentLanes).toMatchObject({ slots: 6, overflow: 2 })
    const view = render(
      <TrajectoryTable
        t={t} toolLabels={toolLabels} turns={turns} agentLanes={agentLanes}
        renderSlot={() => null} loadImage={async () => 'blob:x'}
        collapsedTurns={new Set()} onToggleTurn={() => {}} collapsedAssistants={new Set()} onToggleAssistant={() => {}}
      />,
    )
    await waitFor(() => { expect(view.container.querySelector('tr[data-record-index="11"]')).toBeTruthy() })
    const row = (index: number) => view.container.querySelector(`tr[data-record-index="${index}"]`)!
    expect(row(10).querySelectorAll('[data-lane-id]')).toHaveLength(6)
    expect(row(10).textContent).not.toContain('+')
    expect(row(11).textContent).toContain('+1')
    expect(row(12).textContent).toContain('+2')
    // Six lanes plus the chip slot widen the zone.
    expect(view.container.querySelector<HTMLElement>('table')?.style.getPropertyValue('--trajectory-lane-zone')).toBe('145px')
  })
})
