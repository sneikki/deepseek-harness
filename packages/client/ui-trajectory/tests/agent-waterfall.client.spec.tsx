// @vitest-environment jsdom
/** Agent waterfall: indent, status, collapse, row click and open-session. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TrajectoryAgentWaterfall } from '../src/client/TrajectoryAgentWaterfall.tsx'
import type { AgentTreeRow } from '../src/client/trajectory-agent-tree.ts'
import { t } from './locale.client.ts'

afterEach(cleanup)

const row = (sessionId: string, depth: number, extra: Partial<AgentTreeRow> = {}): AgentTreeRow => ({
  sessionId, depth, label: `agent-${sessionId}`, shortId: sessionId.padEnd(8, '0'), status: 'done',
  startedAt: 0, endedAt: 500, activeMs: 300, hasChildren: false, startIndex: null, ...extra,
})
const rows = [
  row('a', 1, { hasChildren: true, startIndex: 7 }),
  row('b', 2, { hasChildren: true, status: 'failed' }),
  row('c', 3, { status: 'running', endedAt: null }),
  row('d', 1, { startIndex: 20, status: 'interrupted', startedAt: null, endedAt: null }),
]

function mount(onRecordSelect = vi.fn(), onOpenSession = vi.fn()) {
  const view = render(
    <TrajectoryAgentWaterfall t={t} rows={rows} domainStart={0} domainDuration={1000} domainEnd={1000}
      toDomain={x => x} onRecordSelect={onRecordSelect} onOpenSession={onOpenSession} />,
  )
  const item = (id: string) => view.container.querySelector<HTMLElement>(`[data-agent-id="${id}"]`)!
  return { item, onRecordSelect, onOpenSession }
}

describe('TrajectoryAgentWaterfall', () => {
  it('indents 12px per depth and carries the status', () => {
    const { item } = mount()
    expect(screen.getByText('Agents · 4')).toBeTruthy()
    expect((item('a').firstElementChild as HTMLElement).style.paddingLeft).toBe('0px')
    expect((item('c').firstElementChild as HTMLElement).style.paddingLeft).toBe('24px')
    expect(item('b').dataset.status).toBe('failed')
    expect(item('c').dataset.status).toBe('running')
    expect(item('d').querySelector('[class*="bar"]')).toBeNull() // untimed: label only
  })

  it('collapses a subtree with its chevron', () => {
    const { item } = mount()
    fireEvent.click(item('a').querySelector('button')!)
    expect(item('b')).toBeNull()
    expect(item('c')).toBeNull()
    expect(item('d')).not.toBeNull()
  })

  it('selects the depth-1 ancestor start on row click', () => {
    const { item, onRecordSelect } = mount()
    fireEvent.click(item('c'))
    expect(onRecordSelect).toHaveBeenCalledWith(7)
    fireEvent.click(item('d'))
    expect(onRecordSelect).toHaveBeenLastCalledWith(20)
  })

  it('opens the child session without selecting the row', () => {
    const { item, onRecordSelect, onOpenSession } = mount()
    fireEvent.click(item('b').querySelector('button[aria-label="Open agent session"]')!)
    expect(onOpenSession).toHaveBeenCalledWith('b')
    expect(onRecordSelect).not.toHaveBeenCalled()
  })

  it('marks current, search-matched and out-of-range rows', () => {
    const view = render(
      <TrajectoryAgentWaterfall t={t} rows={rows} domainStart={0} domainDuration={1000} domainEnd={1000}
        toDomain={x => x} selectedIndex={7} searchMatchIndexes={new Set([20])} activeRange={{ start: 600, end: 900 }} />,
    )
    const at = (id: string) => view.container.querySelector<HTMLElement>(`[data-agent-id="${id}"]`)!
    expect(at('a').dataset.current).toBe('true')
    expect(at('c').dataset.current).toBe('true') // depth-1 ancestor start selected
    expect(at('d').dataset.current).toBeUndefined()
    expect(at('a').dataset.searchMatch).toBe('false')
    expect(at('d').dataset.searchMatch).toBe('true')
    expect(at('b').dataset.selected).toBe('false') // ends at 500, before the brush
    expect(at('c').dataset.selected).toBe('true') // running: open-ended
  })
})
