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

/** `agents` background agents spawned on consecutive records from START, all settling from END. */
function ledger(agents = 1): TrajectoryTurnModel[] {
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
    // Gutter widened for one lane.
    expect(view.container.querySelector<HTMLElement>('col')?.style.width).toBe('49px')

    const pane = view.container.querySelector('table')!.parentElement as HTMLElement
    pane.scrollTop = 9_000
    fireEvent.scroll(pane)
    await waitFor(() => { expect(Math.min(...states().map(row => row.index))).toBeGreaterThan(START + 20) })
    const middle = states()
    expect(middle.length).toBeGreaterThan(5)
    expect(middle.filter(row => row.index < END).every(row => row.state === 'pass')).toBe(true)
    expect(middle.some(row => row.spawn)).toBe(false)
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
    // Six lanes plus the chip slot widen the gutter.
    expect(view.container.querySelector<HTMLElement>('col')?.style.width).toBe('109px')
  })
})
