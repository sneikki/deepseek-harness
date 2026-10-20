/** Noise reduction: empty assistant rows, repeated context, tool args line, filter counts. */

import { describe, expect, it } from 'vitest'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import { reduceTrajectoryNoise, summarizeToolArgs } from '../src/client/trajectory-noise.ts'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

const HOOK = 'moonshine: if this prompt starts or changes a task'

function cell(index: number, extra: Partial<TrajectoryCellProps>): TrajectoryCellProps {
  return { index, kind: 'message', text: '', timeSeconds: 0, sourceSeq: index, ...extra }
}

function turn(...cells: TrajectoryCellProps[]): TrajectoryTurnModel {
  return { turn: 1, groups: [{ title: 'Step 1', cells }] }
}

const ids = (turns: readonly TrajectoryTurnModel[]) =>
  turns.flatMap(item => item.groups.flatMap(group => group.cells.map(c => c.index)))

describe('reduceTrajectoryNoise', () => {
  const layout = [
    turn(
      cell(1, { kind: 'user', previewMarkdown: 'go' }),
      cell(2, { kind: 'context', previewMarkdown: HOOK }),
      cell(3, { text: t('layout.toolCallOnly') }),
      cell(4, { kind: 'tool', text: 'bash', previewMarkdown: 'ls' }),
      cell(5, { requestOnly: true }),
    ),
    turn(
      cell(6, { kind: 'context', previewMarkdown: HOOK }),
      cell(7, { kind: 'context', previewMarkdown: 'Agent a sent a message:' }),
      cell(8, { text: t('layout.toolCallOnly'), thinkingDetail: 'hm' }),
      cell(9, { previewMarkdown: 'done', outputDetail: 'done' }),
    ),
  ]

  it('keeps the first repeated context, hides repeats, keeps different context', () => {
    expect(ids(reduceTrajectoryNoise(layout, 'all', t).turns)).toEqual([1, 2, 4, 5, 7, 8, 9])
  })

  it('skips tool-call-only assistants but keeps ones with thinking or output', () => {
    const kept = ids(reduceTrajectoryNoise(layout, 'all', t).turns)
    expect(kept).not.toContain(3)
    expect(kept).toContain(8)
  })

  it('counts what remains, ignoring the chip', () => {
    for (const filter of ['all', 'messages', 'tools'] as const) {
      expect(reduceTrajectoryNoise(layout, filter, t).counts).toEqual({ all: 6, messages: 5, tools: 1 })
    }
  })

  it('filters by kind and drops emptied turns', () => {
    const tools = reduceTrajectoryNoise(layout, 'tools', t).turns
    expect(ids(tools)).toEqual([4])
    expect(tools).toHaveLength(1)
    expect(ids(reduceTrajectoryNoise(layout, 'messages', t).turns)).toEqual([1, 2, 7, 8, 9])
  })
})

describe('summarizeToolArgs', () => {
  it('uses the command string for shell tools', () => {
    expect(summarizeToolArgs('bash', '{"command":"cd ~/x &&\\n  ls"}')).toBe('cd ~/x && ls')
    expect(summarizeToolArgs('shell', '{"command":"pwd"}')).toBe('pwd')
  })

  it('renders other tools as key: value pairs without braces or quotes', () => {
    expect(summarizeToolArgs('send_message', '{"agent_id":"a1","count":2,"opts":{"x":1}}'))
      .toBe('agent_id: a1, count: 2, opts: {"x":1}')
  })

  it('shortens long values and returns empty for no arguments', () => {
    expect(summarizeToolArgs('read', `{"path":"${'p'.repeat(200)}"}`)).toBe(`path: ${'p'.repeat(80)}…`)
    expect(summarizeToolArgs('list_agents', '{}')).toBe('')
  })

  it('passes non-object text through', () => {
    expect(summarizeToolArgs('bash', '{"comm')).toBe('{"comm')
    expect(summarizeToolArgs('bash', '')).toBe('')
  })
})
