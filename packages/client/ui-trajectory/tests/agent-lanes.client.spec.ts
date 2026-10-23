/** Subagent lane derivation: spans, events, resumes and per-row states. */
import { describe, expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { agentLaneCells, deriveAgentLanes, laneBend, laneX } from '../src/client/trajectory-agent-lanes.ts'
import type { AgentTreeRow } from '../src/client/trajectory-agent-tree.ts'
import { trajectorySubagentLifecycles } from '../src/client/trajectory-subagent.ts'
import { t } from './locale.client.ts'

const A = '2c619f73-fff4-4203-95f6-ce61ca1f4359'
const B = '684509dd-6218-4da6-a36f-26e9f9b64626'
const C = 'c0ffee00-0000-4000-8000-000000000003'
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
const failed = (id: string) => notice('subagent-settled', id, `Background subagent ${id} ran out of room before it finished.`)
const start = (id: string, description: string) =>
  call('subagent', `s-${id}`, { description, prompt: 'p' }, `started subagent ${id}`)
const send = (id: string) => call('send_message', `m-${id}-${seq}`, { agent_id: id, message: 'hi' }, `message delivered to agent ${id}`)

function lanes(nodes: unknown[], rows: AgentTreeRow[] = []) {
  seq = 0
  const turns = deriveTrajectoryLayout({ nodes: nodes as Nodes, partial: null, runningCalls: [] }, t)
  const cells = turns.flatMap(x => x.groups.flatMap(g => g.cells)).sort((a, b) => a.index - b.index)
  const model = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns), rows)
  const indexOf = (id: string, phase: string) =>
    cells.find(c => c.subagent?.id === id && c.subagent.phase === phase)!.index
  return { model, cells, indexOf }
}
const row = (id: string, over: Partial<AgentTreeRow>): AgentTreeRow => ({
  sessionId: id, depth: 1, label: id, shortId: id.slice(0, 8), status: 'done', startedAt: null, endedAt: null,
  activeMs: null, hasChildren: false, startIndex: null, loaded: true, hasSession: true, ...over,
})

describe('deriveAgentLanes', () => {
  it('spans from the spawn card to the settle record with status and ordered events', () => {
    seq = 0
    const { model, indexOf } = lanes([
      ...start(A, 'Alpha'),
      ...start(B, 'Beta'),
      notice('agent-message', A, `Agent ${A} sent a message:`),
      ...send(B),
      failed(B),
      done(A),
    ])
    const [a, b] = model.lanes
    expect(a).toMatchObject({ id: A, label: 'Alpha', status: 'done', startIndex: indexOf(A, 'start'), endIndex: indexOf(A, 'finish') })
    expect(b).toMatchObject({ id: B, status: 'failed', endIndex: indexOf(B, 'finish') })
    expect(a?.events).toEqual([{ index: indexOf(A, 'report'), kind: 'report' }])
    expect(b?.events).toEqual([{ index: indexOf(B, 'control'), kind: 'send' }])
    // Overlapping lanes sit side by side; a later lane reuses a freed slot.
    expect([a?.slot, b?.slot]).toEqual([0, 1])
    expect(model.slots).toBe(2)
  })

  it('keeps a running agent open to the last record', () => {
    const { model } = lanes([...start(A, 'Long'), notice('agent-message', B, 'other')])
    expect(model.lanes[0]).toMatchObject({ status: 'running', endIndex: Number.POSITIVE_INFINITY })
  })

  it('marks a resumed turn and the earlier settle, and ends on the last settle', () => {
    const { model, indexOf, cells } = lanes([
      ...start(A, 'Alpha'), done(A), ...send(A), done(A),
    ])
    const lane = model.lanes[0]!
    const finishes = cells.filter(c => c.subagent?.phase === 'finish').map(c => c.index)
    expect(lane.endIndex).toBe(finishes[1])
    expect(lane.events).toEqual([
      { index: finishes[0], kind: 'settle' },
      { index: indexOf(A, 'control'), kind: 'resume' },
    ])
  })

  it('marks an interrupt call', () => {
    const { model, indexOf } = lanes([
      ...start(A, 'Alpha'),
      ...call('interrupt_agent', 'i1', { agent_id: A }, `interrupted agent ${A}`),
    ])
    expect(model.lanes[0]).toMatchObject({
      status: 'interrupted', endIndex: indexOf(A, 'control'), events: [{ index: indexOf(A, 'control'), kind: 'interrupt' }],
    })
  })

  it('ends an unsettled agent at the first record after its row end time', () => {
    seq = 0
    const turns = deriveTrajectoryLayout({
      nodes: [...start(A, 'Alpha'), notice('agent-message', B, 'x'), notice('agent-message', B, 'y')] as unknown as Nodes,
      partial: null, runningCalls: [],
    }, t)
    const cells = turns.flatMap(x => x.groups.flatMap(g => g.cells)).sort((a, b) => a.index - b.index)
    const target = cells.at(-2)!
    const model = deriveAgentLanes(turns, trajectorySubagentLifecycles(turns), [
      row(A, { startIndex: cells[0]!.index, status: 'failed', endedAt: target.startedAt! - 1 }),
    ])
    expect(model.lanes[0]).toMatchObject({ status: 'failed', endIndex: target.index, rowId: A })
  })

  it('reuses a slot once a lane ended', () => {
    const { model } = lanes([...start(A, 'a'), done(A), ...start(B, 'b'), done(B), ...start(C, 'c')])
    expect(model.lanes.map(l => l.slot)).toEqual([0, 0, 0])
  })
})

describe('agentLaneCells', () => {
  const build = () => {
    seq = 0
    const out = lanes([
      ...start(A, 'Alpha'),
      ...start(B, 'Beta'),
      notice('agent-message', A, `Agent ${A} sent a message:`),
      ...send(B),
      failed(B),
      done(A),
    ])
    const at = (previous: number | null, index: number) =>
      agentLaneCells(out.model, previous, index).map(cell => `${cell.lane.shortId.slice(0, 1)}:${cell.state}${cell.event === undefined ? '' : `/${cell.event.kind}`}`)
    return { ...out, at }
  }

  it('walks none, start, pass, event, end per row', () => {
    const { cells, at, indexOf } = build()
    const idx = cells.map(c => c.index)
    const rows = idx.map((index, position) => at(idx[position - 1] ?? null, index))
    expect(rows[0]).toEqual([])
    expect(rows[idx.indexOf(indexOf(A, 'start'))]).toEqual(['2:start'])
    expect(rows[idx.indexOf(indexOf(B, 'start'))]).toEqual(['2:pass', '6:start'])
    expect(rows).toContainEqual(['2:event/report', '6:pass'])
    expect(rows).toContainEqual(['2:pass', '6:event/send'])
    expect(rows.at(-2)).toEqual(['2:pass', '6:end'])
    expect(rows.at(-1)).toEqual(['2:end'])
  })

  it('folds events and ends of hidden rows into the next shown row', () => {
    const { indexOf, cells, at } = build()
    // Rows between are filtered out: the shown row inherits the spans it skipped over.
    expect(at(indexOf(A, 'start'), indexOf(B, 'finish'))).toEqual(['2:event/report', '6:end'])
    expect(at(cells[0]!.index, indexOf(B, 'finish'))).toEqual(['2:start', '6:end'])
  })

  it('keeps open lanes through a row older than the rows above it', () => {
    const { indexOf, cells, at } = build()
    const inside = indexOf(B, 'start')
    // Index 1 shown after a row inside both spans: lanes still open there continue as pass, ended ones stay gone.
    expect(at(inside + 1, 1)).toEqual(['2:pass', '6:pass'])
    expect(at(cells.at(-1)!.index, 1)).toEqual([])
  })

  it('shows nothing outside every span', () => {
    const { cells, at } = build()
    expect(at(cells.at(-1)!.index, cells.at(-1)!.index + 5)).toEqual([])
  })
})

describe('lane bends', () => {
  const x = laneX(2)
  it('leaves a spawn card to the right and turns down', () => {
    const bend = laneBend('start', x)!
    expect(bend.d.startsWith('M0 0H')).toBe(true)
    expect(bend.d.endsWith(`${x} ${bend.height}`)).toBe(true)
    expect(bend.rise).toBe(0)
  })
  it('comes down, turns left and stops at the end card', () => {
    const bend = laneBend('end', x)!
    expect(bend.d.startsWith(`M${x} 0`)).toBe(true)
    expect(bend.d.endsWith('H3')).toBe(true)
    expect(bend.rise).toBe(bend.height)
  })
  it('dents into the card at an event and resumes on the same line', () => {
    const bend = laneBend('event', x)!
    expect(bend.d.startsWith(`M${x} 0`)).toBe(true)
    expect(bend.d.endsWith(`${x} ${bend.height}`)).toBe(true)
    expect(bend.rise * 2).toBe(bend.height)
  })
  it('keeps a pass straight', () => {
    expect(laneBend('pass', x)).toBeUndefined()
  })
})

describe('agentLaneCells idle', () => {
  const lane = (turns?: { start: number; end: number | null; reason: null }[]) => ({
    id: 'a', rowId: 'a', label: 'a', shortId: 'a', status: 'running' as const, startIndex: 0,
    endIndex: Number.POSITIVE_INFINITY, slot: 0, events: [], ...(turns === undefined ? {} : { turns }),
  })
  const turns = [{ start: 0, end: 100, reason: null }, { start: 1000, end: null, reason: null }]
  const idleAt = (l: ReturnType<typeof lane>, at: number) =>
    agentLaneCells({ lanes: [l], slots: 1, overflow: 0 }, at - 1, at + 1, at)[0]?.idle === true
  it('marks rows inside the gap, not inside turns', () => {
    const l = lane(turns)
    expect([50, 500, 999, 1500].map(at => idleAt(l, at))).toEqual([false, true, true, false])
  })
  it('marks rows after the last closed turn: the agent waits', () => {
    const l = lane([{ start: 0, end: 100, reason: null }])
    expect([50, 500].map(at => idleAt(l, at))).toEqual([false, true])
  })
  it('stays solid without turns', () => {
    expect(idleAt(lane(), 500)).toBe(false)
  })
})
