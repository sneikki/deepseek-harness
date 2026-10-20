// @vitest-environment jsdom
/** Hidden rows stay in the model: fold, request inspector and filter keep working. */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TrajectoryTable } from '../src/client/TrajectoryTable.tsx'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import { trajectoryRecordId } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

afterEach(cleanup)

const loadImage: MessageImageLoader = async () => 'blob:x'
const only = t('layout.toolCallOnly')

function turns(assistant: Partial<TrajectoryTurnModel['groups'][number]['cells'][number]> = {}): readonly TrajectoryTurnModel[] {
  return [{
    turn: 1,
    groups: [{
      title: 'Step 1',
      cells: [
        {
          index: 1, kind: 'message', text: only, timeSeconds: 1, sourceSeq: 1,
          input: 111, output: 222, ...assistant,
        },
        { index: 2, kind: 'tool', text: 'bash', previewMarkdown: 'ls', toolName: 'bash', timeSeconds: 0.1, sourceSeq: 2, outputDetail: 'a' },
        { index: 3, kind: 'tool', text: 'edit', previewMarkdown: 'path: x', toolName: 'edit', timeSeconds: 0.1, sourceSeq: 3, outputDetail: 'b' },
      ],
    }],
  }]
}

function ledger(props: Partial<Parameters<typeof TrajectoryTable>[0]> = {}, layout = turns()) {
  return (
    <TrajectoryTable
      t={t}
      renderSlot={() => null}
      loadImage={loadImage}
      turns={layout}
      requestNumbers={[{ turn: 1, step: 1, group: 'Step 1', number: 1 }]}
      collapsedTurns={new Set()}
      onToggleTurn={() => {}}
      collapsedAssistants={new Set()}
      onToggleAssistant={() => {}}
      hiddenIndexes={new Set([1])}
      {...props}
    />
  )
}

describe('TrajectoryTable with hidden rows', () => {
  it('renders no assistant row, tool rows stand alone', () => {
    render(ledger())
    expect(screen.queryByText('(tool call only)')).toBeNull()
    expect(screen.queryByRole('row', { name: /ASSISTANT/ })).toBeNull()
    expect(screen.getAllByRole('row', { name: /TOOL/ })).toHaveLength(2)
  })

  it('folds a hidden assistant step into a summary line', () => {
    const layout = turns()
    const id = trajectoryRecordId(layout[0]!.groups[0]!.cells[0]!)
    render(ledger({ collapsedAssistants: new Set([id]) }, layout))
    expect(screen.queryAllByRole('row', { name: /TOOL/ })).toHaveLength(0)
    expect(screen.getByText('2 tool calls · bash, edit')).toBeTruthy()
  })

  it('opens the request inspector with the hidden assistant usage', () => {
    render(ledger())
    fireEvent.click(screen.getByRole('button', { name: 'Request #1' }))
    const detail = within(screen.getByRole('complementary'))
    expect(detail.getByText('222 tok')).toBeTruthy()
  })

  it('selecting a tool row still resolves its parent step', () => {
    render(ledger())
    fireEvent.click(screen.getAllByRole('row', { name: /TOOL/ })[0]!)
    expect(screen.getByRole('complementary')).toBeTruthy()
  })

  it('keeps a failed tool-call-only assistant visible when it is not hidden', () => {
    render(ledger({ hiddenIndexes: new Set() }, turns({ isError: true })))
    expect(screen.getByRole('row', { name: /ASSISTANT/ })).toBeTruthy()
  })

  it('filters rows by chip without folding', () => {
    render(ledger({ rowFilter: 'tools' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    cleanup()
    render(ledger({ rowFilter: 'messages', hiddenIndexes: new Set() }))
    expect(screen.getAllByRole('row').every(row => row.getAttribute('data-kind') === 'message')).toBe(true)
  })
})
