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
  startedAt: 0, endedAt: 500, activeMs: 300, hasChildren: false, startIndex: null, loaded: true, hasSession: true, ...extra,
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

  it('counts rows without status instead of drawing them', () => {
    const view = render(
      <TrajectoryAgentWaterfall t={t} domainStart={0} domainDuration={1000} domainEnd={1000} toDomain={x => x}
        rows={[row('a', 1), row('u1', 1, { status: 'unknown', endedAt: null }), row('u2', 1, { status: 'unknown', endedAt: null })]} />,
    )
    expect(screen.getByText('Agents · 1 · 2 without timing')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-agent-id]')).toHaveLength(1)
  })

  it('offers no open button for a row without a session', () => {
    const view = render(
      <TrajectoryAgentWaterfall t={t} domainStart={0} domainDuration={1000} domainEnd={1000} toDomain={x => x}
        onOpenSession={vi.fn()} rows={[row('a', 1), row('call-1', 1, { hasSession: false })]} />,
    )
    const buttons = (id: string) => view.container.querySelector(`[data-agent-id="${id}"]`)!.querySelectorAll('button')
    expect(buttons('a')).toHaveLength(1)
    expect(buttons('call-1')).toHaveLength(0)
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
    fireEvent.click(item('b').querySelector('button[aria-label="Open agent-b"]')!)
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

  it('keeps a running bar open-ended in domain units under a non-identity toDomain', () => {
    const view = render(
      <TrajectoryAgentWaterfall t={t} rows={[row('r', 1, { status: 'running', startedAt: 1000, endedAt: null })]}
        domainStart={0} domainDuration={100} domainEnd={100} toDomain={x => x / 10} />,
    )
    // Starts at the window's right edge: nothing to draw.
    expect(view.container.querySelector('[class*="bar"]')).toBeNull()
    const grow = render(
      <TrajectoryAgentWaterfall t={t} rows={[row('r', 1, { status: 'running', startedAt: 200, endedAt: null })]}
        domainStart={0} domainDuration={100} domainEnd={100} toDomain={x => x / 10} />,
    )
    const open = grow.container.querySelector<HTMLElement>('[class*="bar"]')!
    expect(open.style.getPropertyValue('--agent-left')).toBe('20%')
    expect(open.style.getPropertyValue('--agent-width')).toBe('80%')
  })

  it('expands only depth <= 1 by default beyond 12 rows', () => {
    const many = [
      row('p', 1, { hasChildren: true }), row('q', 2, { hasChildren: true }), row('deep', 3),
      ...Array.from({ length: 11 }, (_, index) => row(`s${index}`, 1)),
    ]
    const view = render(
      <TrajectoryAgentWaterfall t={t} rows={many} domainStart={0} domainDuration={1000} domainEnd={1000} toDomain={x => x} />,
    )
    expect(view.container.querySelector('[data-agent-id="q"]')).not.toBeNull()
    expect(view.container.querySelector('[data-agent-id="deep"]')).toBeNull()
  })

  it('supports keyboard select and arrow collapse', () => {
    const { item, onRecordSelect } = mount()
    item('a').focus()
    fireEvent.keyDown(item('a'), { key: 'Enter' })
    expect(onRecordSelect).toHaveBeenCalledWith(7)
    fireEvent.keyDown(item('a'), { key: 'ArrowLeft' })
    expect(item('b')).toBeNull()
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' })
    expect(item('b')).not.toBeNull()
    fireEvent.keyDown(item('a'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('b'))
  })
})
