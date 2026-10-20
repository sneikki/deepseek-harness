// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TurnProcessNodeView } from '../src/client/chat/TurnProcessNodeView.tsx'

const t = (key: string, vars?: Record<string, unknown>) =>
  key === 'message.turnProcess.activity.run' ? `${vars?.count} × ${vars?.label}` : key.split('.').at(-1)!

describe('turn process activity strip', () => {
  it('collapses a run, keeps the error cell apart', () => {
    const props = {
      node: {
        location: { kind: 'turn', turn: { status: 'closed', start: { time: 0 }, end: { time: 5000, data: { reason: { kind: 'done' } } } } },
        data: { turn: 1, messageCount: 0, toolCallCount: 3, subagentCount: 0, activity: ['code', 'code', 'error'] },
      },
      turnProcess: { foldable: false, open: true, hasContent: false, setOpen: () => {} },
      t,
    } as never
    const { container } = render(<TurnProcessNodeView {...props} />)
    const cells = [...container.querySelectorAll<HTMLElement>('[data-activity]')]
    expect(cells.map(c => c.dataset.activity)).toEqual(['code', 'error'])
    expect(cells[0]!.textContent).toBe('2×')
    expect(cells[0]!.title).toBe('2 × code')
    expect(cells[0]!.hasAttribute('data-run')).toBe(true)
    expect(cells[1]!.hasAttribute('data-run')).toBe(false)
    expect(cells[1]!.textContent).toBe('')
  })
})
