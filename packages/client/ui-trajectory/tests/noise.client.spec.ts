/** Noise reduction: empty assistant rows, repeated context, tool args line, filter counts. */

import { describe, expect, it } from 'vitest'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import {
  analyzeTrajectoryNoise, summarizeToolArgs, trajectoryRowMatchesFilter,
} from '../src/client/trajectory-noise.ts'
import type { TrajectoryCellProps } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

const HOOK = 'moonshine: if this prompt starts or changes a task'

function cell(index: number, extra: Partial<TrajectoryCellProps>): TrajectoryCellProps {
  return { index, kind: 'message', text: '', timeSeconds: 0, sourceSeq: index, ...extra }
}

function turn(...cells: TrajectoryCellProps[]): TrajectoryTurnModel {
  return { turn: 1, groups: [{ title: 'Step 1', cells }] }
}

describe('analyzeTrajectoryNoise', () => {
  const none = new Set<number>()
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
  const hidden = (turns = layout, live = none) => [...analyzeTrajectoryNoise(turns, t, live).hidden]

  it('keeps the first repeated context, hides repeats, keeps different context', () => {
    expect(hidden()).toContain(6)
    expect(hidden()).not.toContain(2)
    expect(hidden()).not.toContain(7)
  })

  it('hides tool-call-only assistants but keeps ones with thinking or output', () => {
    expect(hidden()).toContain(3)
    expect(hidden()).not.toContain(8)
  })

  it('never hides a failed, still-running or live assistant', () => {
    const only = { text: t('layout.toolCallOnly') }
    const running = {
      timingRecorded: true, stepStartTime: 1, firstTokenTime: null,
      completedTime: null, usageProvided: false, outputTokens: 0,
    }
    const turns = [turn(
      cell(1, { ...only, isError: true }),
      cell(2, { ...only, assistantMetrics: running }),
      cell(3, only),
      cell(4, only),
    )]
    expect(hidden(turns, new Set([3]))).toEqual([4])
  })

  it('keeps context that differs only in source and tool-change notices', () => {
    const notice = { sourceBlocks: [{ type: 'tool-addition', content: 'x' }] } as const
    const turns = [turn(
      cell(1, { kind: 'context', previewMarkdown: HOOK, messageSource: { kind: 'a' } as never }),
      cell(2, { kind: 'context', previewMarkdown: HOOK, messageSource: { kind: 'b' } as never }),
      cell(3, { kind: 'context', text: 'Tool added: x', ...notice }),
      cell(4, { kind: 'context', text: 'Tool added: x', ...notice }),
    )]
    expect(hidden(turns)).toEqual([])
  })

  it('counts what remains, ignoring boundary markers', () => {
    expect(analyzeTrajectoryNoise(layout, t, none).counts).toEqual({ all: 6, messages: 5, tools: 1 })
  })

  it('matches chips by kind and shows boundary markers only under All', () => {
    const tool = cell(1, { kind: 'tool' })
    const message = cell(2, {})
    const marker = cell(3, { requestOnly: true })
    expect([tool, message, marker].map(c => trajectoryRowMatchesFilter(c, 'all'))).toEqual([true, true, true])
    expect([tool, message, marker].map(c => trajectoryRowMatchesFilter(c, 'tools'))).toEqual([true, false, false])
    expect([tool, message, marker].map(c => trajectoryRowMatchesFilter(c, 'messages'))).toEqual([false, true, false])
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
