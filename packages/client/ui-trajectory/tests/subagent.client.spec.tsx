// @vitest-environment jsdom
/** Subagent lifecycle correlation on real-shaped nodes, and the timeline lane. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { deriveTrajectoryTimeline } from '../src/client/timeline.ts'
import { TrajectoryTimeline } from '../src/client/TrajectoryTimeline.tsx'
import { trajectorySubagentLifecycles } from '../src/client/trajectory-subagent.ts'
import { t } from './locale.client.ts'

afterEach(cleanup)

const A = '2c619f73-fff4-4203-95f6-ce61ca1f4359'
const B = '684509dd-6218-4da6-a36f-26e9f9b64626'
type Nodes = Parameters<typeof deriveTrajectoryLayout>[0]['nodes']

let seq = 0
function call(name: string, callId: string, args: object, result: string | null, isError = false) {
  const argsRaw = JSON.stringify(args)
  const callTime = ++seq * 1_000
  return [
    {
      kind: 'assistant', seq: ++seq, time: callTime, turn: 1, step: 1,
      blocks: [{ kind: 'tool-call', callId, name, argsRaw }],
    },
    ...(result === null ? [] : [{
      kind: 'tool-result', seq: ++seq, time: seq * 1_000, callId, name,
      args: PartialArguments.fromText(argsRaw), call: { name, argsRaw }, callTime,
      content: [{ type: 'text', text: result }], isError,
    }]),
  ]
}
const notice = (kind: 'agent-message' | 'subagent-settled', id: string, text: string) => ({
  kind: 'context', seq: ++seq, time: seq * 1_000,
  content: [{ type: 'text', text }],
  source: { kind, form: kind === 'agent-message' ? 'relay' : 'notice', senderSessionId: id, summary: text },
  producer: { role: 'inject', label: kind }, form: null,
})
const done = (id: string) => notice('subagent-settled', id, `Background subagent ${id} finished and will do no further work unless you send it more.`)

function lifecycles(nodes: unknown[]) {
  seq = 0
  const turns = deriveTrajectoryLayout({ nodes: nodes as Nodes, partial: null, runningCalls: [] }, t)
  const cells = turns.flatMap(x => x.groups.flatMap(g => g.cells)).sort((a, b) => a.index - b.index)
  return { turns, list: trajectorySubagentLifecycles(turns), cells }
}

describe('subagent correlation', () => {
  it('ties start, reports, control and finish by agent id', () => {
    seq = 0
    const { list, cells } = lifecycles([
      ...call('subagent', 'c1', { description: 'Finish lead', prompt: 'p' }, `started subagent ${A}`),
      notice('agent-message', A, `Agent ${A} sent a message:`),
      ...call('send_message', 'c2', { agent_id: A, message: 'hi' }, `message delivered to agent ${A}`),
      done(A),
    ])
    expect(list).toMatchObject([{
      id: A, shortId: '2c619f73', description: 'Finish lead', status: 'finished',
      background: true, reportCount: 1, controlCount: 1,
    }])
    expect(list[0]?.endedAt).toBeGreaterThan(list[0]!.startedAt!)
    expect(cells.flatMap(c => c.subagent === undefined ? [] : [c.subagent.phase]))
      .toEqual(['start', 'report', 'control', 'finish'])
    expect(cells.find(c => c.subagent?.phase === 'start')?.subagent).toMatchObject({
      id: A, shortId: '2c619f73', description: 'Finish lead', status: 'finished',
    })
  })

  it('keeps a start without finish running, and ignores unrelated senders', () => {
    const { list, cells } = lifecycles([
      ...call('subagent', 'c1', { description: 'Long job', prompt: 'p' }, `started subagent ${A}`),
      notice('agent-message', 'session-other', 'Agent session-other sent a message:'),
    ])
    expect(list).toMatchObject([{ id: A, status: 'running', endedAt: null, endIndex: null }])
    expect(cells.filter(c => c.subagent !== undefined)).toHaveLength(1)
  })

  it.each([
    ['ran out of room before it finished.', 'failed'],
    ['declined the task.', 'failed'],
    ['ended abnormally (weird) before it finished.', 'failed'],
    ['failed before it finished.', 'failed'],
    ['was stopped before it finished.', 'interrupted'],
    ['finished and will do no further work unless you send it more.', 'finished'],
    ['finished. It cannot receive follow-up messages.', 'finished'],
  ] as const)('maps the settle wording "%s" to %s', (wording, status) => {
    const { list } = lifecycles([
      ...call('subagent', 'c1', { description: 'Job', prompt: 'p' }, `started subagent ${A}`),
      notice('subagent-settled', A, `Background subagent ${A} ${wording}`),
    ])
    expect(list[0]?.status).toBe(status)
  })

  it('flips running to finished when the settle notice arrives live', () => {
    const start = call('subagent', 'c1', { description: 'Job', prompt: 'p' }, `started subagent ${A}`)
    expect(lifecycles(start).list[0]).toMatchObject({ status: 'running', endIndex: null })
    const settled = lifecycles([...call('subagent', 'c1', { description: 'Job', prompt: 'p' }, `started subagent ${A}`), done(A)])
    expect(settled.list[0]).toMatchObject({ status: 'finished' })
    expect(settled.cells.find(c => c.subagent?.phase === 'start')?.subagent?.status).toBe('finished')
  })

  it('ignores a settle or report whose start is not in the loaded history', () => {
    const { list, cells } = lifecycles([
      done(A),
      notice('agent-message', A, `Agent ${A} sent a message:`),
      ...call('subagent', 'c1', { description: 'Later', prompt: 'p' }, `started subagent ${A}`),
    ])
    expect(list).toMatchObject([{ id: A, status: 'running', reportCount: 0 }])
    expect(cells.filter(c => c.subagent !== undefined)).toHaveLength(1)
  })

  it('ignores a control call that has no result yet or failed', () => {
    const { list } = lifecycles([
      ...call('subagent', 'c1', { description: 'One', prompt: 'p' }, `started subagent ${A}`),
      done(A),
      ...call('send_message', 'c2', { agent_id: A, message: 'pending' }, null),
      ...call('send_message', 'c3', { agent_id: A, message: 'bad' }, 'Error: no such agent', true),
    ])
    expect(list[0]).toMatchObject({ status: 'finished', controlCount: 2 })
  })

  it('handles forks, failure and a stop notice per agent', () => {
    const { list } = lifecycles([
      ...call('subagent_fork', 'c1', { description: 'Fork', prompt: 'p' }, `started subagent ${A}`),
      ...call('subagent', 'c2', { description: 'Other', prompt: 'p' }, `started subagent ${B}`),
      notice('subagent-settled', A, `Background subagent ${A} failed before it finished.`),
      notice('subagent-settled', B, `Background subagent ${B} was stopped before it finished.`),
    ])
    expect(list.map(l => [l.description, l.status])).toEqual([['Fork', 'failed'], ['Other', 'interrupted']])
  })

  it('marks an interrupt without settle, and a message wakes a finished agent', () => {
    const { list } = lifecycles([
      ...call('subagent', 'c1', { description: 'One', prompt: 'p' }, `started subagent ${A}`),
      ...call('interrupt_agent', 'c2', { agent_id: A }, `interrupt requested for agent ${A}`),
      ...call('subagent', 'c3', { description: 'Two', prompt: 'p' }, `started subagent ${B}`),
      done(B),
      ...call('send_message', 'c4', { agent_id: B, message: 'more' }, `message delivered to agent ${B}`),
    ])
    expect(list.map(l => [l.description, l.status])).toEqual([['One', 'interrupted'], ['Two', 'running']])
  })

  it('treats a blocking subagent call as a finished lifecycle of its own', () => {
    const { list } = lifecycles([
      ...call('subagent', 'c1', { description: 'Review', prompt: 'p' }, 'verdict text'),
      ...call('subagent', 'c2', { description: 'Bad', prompt: 'p' }, 'Error: subagent run failed', true),
    ])
    expect(list).toMatchObject([
      { description: 'Review', status: 'finished', background: false, id: 'c1' },
      { description: 'Bad', status: 'failed', background: false },
    ])
    expect(list[0]?.endedAt).not.toBeNull()
  })
})

describe('subagent timeline lane', () => {
  const nodes = [
    { kind: 'user', seq: 0, time: 500, content: [{ type: 'text', text: 'go' }], source: null },
    ...call('subagent', 'c1', { description: 'Finish lead', prompt: 'p' }, `started subagent ${A}`),
    ...call('subagent', 'c2', { description: 'Open job', prompt: 'p' }, `started subagent ${B}`),
    done(A),
  ]

  it('projects one bar per subagent, open-ended while running', () => {
    seq = 0
    const turns = deriveTrajectoryLayout({ nodes: nodes as Nodes, partial: null, runningCalls: [] }, t)
    const model = deriveTrajectoryTimeline(turns, 'sequence')!
    expect(model.subagents.map(s => [s.lifecycle.description, s.lifecycle.status])).toEqual([
      ['Finish lead', 'finished'], ['Open job', 'running'],
    ])
    expect(model.subagents[1]?.end).toBe(model.end)
    expect(model.subagents[0]?.end).toBeLessThan(model.end + 1)
    expect(model.subagents[0]?.index).toBe(model.subagents[0]?.lifecycle.startIndex)
  })

  it('falls back to the recorded end when the settle record has no span', () => {
    seq = 0
    const turns = deriveTrajectoryLayout({ nodes: nodes as Nodes, partial: null, runningCalls: [] }, t)
    const cellsOf = (list: typeof turns) => list.flatMap(turn => turn.groups.flatMap(group => group.cells))
    const settle = cellsOf(turns).find(cell => cell.subagent?.phase === 'finish')!
    const hidden = turns.map(turn => ({
      ...turn,
      groups: turn.groups.map(group => ({
        ...group,
        cells: group.cells.map(cell => cell === settle ? { ...cell, requestOnly: true } : cell),
      })),
    }))
    const model = deriveTrajectoryTimeline(hidden, 'actual')!
    expect(model.spans.some(span => span.index === settle.index)).toBe(false)
    const bar = model.subagents.find(s => s.lifecycle.description === 'Finish lead')!
    const before = cellsOf(hidden).filter(cell => (cell.startedAt ?? Infinity) <= settle.startedAt! && cell !== settle)
    const lastEnd = Math.max(...model.spans.filter(span => before.some(cell => cell.index === span.index)).map(span => span.end))
    expect(bar.end).toBe(lastEnd)
  })

  it('renders the lane, titles bars and focuses the start row on click', () => {
    seq = 0
    const turns = deriveTrajectoryLayout({ nodes: nodes as Nodes, partial: null, runningCalls: [] }, t)
    const onRecordSelect = vi.fn()
    const view = render(
      <TrajectoryTimeline t={t} turns={turns} mode="sequence" range={null}
        onRangeChange={vi.fn()} onRecordSelect={onRecordSelect} />,
    )
    expect(screen.getByText('Agents')).toBeTruthy()
    const bars = view.container.querySelectorAll<HTMLElement>('[data-timeline-subagent]')
    expect([...bars].map(b => b.dataset.timelineSubagent)).toEqual(['finished', 'running'])
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    fireEvent.pointerDown(bars[1]!, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(plot, { button: 0, clientX: 10, pointerId: 1 })
    expect(onRecordSelect).toHaveBeenCalledWith(Number(bars[1]!.dataset.timelineRecordIndex))
  })

  it('shows no lane without subagents', () => {
    seq = 0
    const turns = deriveTrajectoryLayout({ nodes: nodes.slice(0, 1) as Nodes, partial: null, runningCalls: [] }, t)
    const view = render(<TrajectoryTimeline t={t} turns={turns} mode="sequence" range={null} onRangeChange={vi.fn()} />)
    expect(view.container.querySelector('[data-timeline-subagent]')).toBeNull()
  })
})
