// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TrajectoryCard } from '../src/client/TrajectoryCard.tsx'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import { conversationT, t } from './locale.client.ts'
import { toolCardLabels } from '@deepseek-ai/dsh-client-ui-tool/client'

// No primitive mocks here: the rich bodies are the real CodeBlock and ReadBlock, so See all is measured on real DOM.
// jsdom has no layout; a [data-clip] section reports itself as overflowing while `overflow` is on.
let overflow = false
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) { return overflow && this.hasAttribute('data-clip') ? 400 : 0 },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return overflow && this.hasAttribute('data-clip') ? 100 : 0 },
  })
})

afterEach(() => {
  cleanup()
  overflow = false
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
})

const labels = toolCardLabels(conversationT)
const LONG_COMMAND = Array.from({ length: 40 }, (_, i) => `echo line ${i}`).join('\n')

function bashCell(command: string): TrajectoryCellProps {
  return { index: 1, kind: 'tool', text: '', timeSeconds: 1, toolName: 'bash', toolBody: { kind: 'bash', command } }
}

function readCell(): TrajectoryCellProps {
  const model = { label: 'a.ts', lines: [{ number: 1, text: 'const a = 1' }], totalLines: 1, lang: 'typescript' }
  return { index: 1, kind: 'tool', text: '', timeSeconds: 1, toolName: 'read', toolBody: { kind: 'read', model } }
}

function card(cell: TrajectoryCellProps, onToggle: () => void) {
  return (
    <TrajectoryCard
      cell={cell}
      content={{
        displayText: cell.toolName ?? '',
        // A result is what opens the OUTPUT section that holds the read view.
        resultText: cell.toolBody?.kind === 'read' ? '1\tconst a = 1' : undefined,
        callsBadge: undefined,
        toolCallText: { name: cell.toolName ?? '', program: false, args: '{}' },
      }}
      badge={cell.toolName ?? ''}
      badgeTitle={cell.toolName ?? ''}
      expanded={false}
      onToggle={onToggle}
      t={t}
      toolLabels={labels}
    />
  )
}

describe('See all on a real rich body', () => {
  it('shows See all when the real highlighted command overflows, and asks the row to expand', () => {
    overflow = true
    const onToggle = vi.fn()
    const { container } = render(card(bashCell(LONG_COMMAND), onToggle))
    expect(container.textContent).toContain('echo line 39')
    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows no See all when the real body fits the box', () => {
    overflow = false
    render(card(bashCell('ls'), () => {}))
    expect(screen.queryByRole('button', { name: 'See all' })).toBeNull()
  })
})

describe('rich body buttons', () => {
  it('keeps a copy click inside the real read body from reaching the row', () => {
    const onRowClick = vi.fn()
    const onToggle = vi.fn()
    render(<div onClick={onRowClick}>{card(readCell(), onToggle)}</div>)
    fireEvent.click(screen.getByRole('button', { name: labels.copy }))
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
  })
})
