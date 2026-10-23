/** Agent bar geometry, duration label and tooltip text for turn segments. */
import { describe, expect, it } from 'vitest'
import { agentBarParts, agentDurationsByStart, agentDurationText, agentTooltip } from '../src/client/trajectory-agent-bar.ts'
import { formatBoxDuration } from '../src/client/trajectory-record.ts'
import { deriveAgentTree, type AgentTreeRow } from '../src/client/trajectory-agent-tree.ts'
import { t } from './locale.client.ts'

const MIN = 60_000
const HOUR = 60 * MIN

// Handoff-erp-app shape: 36 min interrupted, 21 h idle, then 19 min.
const turns = [
  { start: 0, end: 36 * MIN, reason: 'interrupted' as const },
  { start: 36 * MIN + 21 * HOUR, end: 55 * MIN + 21 * HOUR, reason: 'completed' as const },
]
const row = (extra: Partial<AgentTreeRow> = {}): AgentTreeRow => ({
  sessionId: 'e4d94b34', depth: 1, label: 'Handoff', shortId: 'e4d94b34', status: 'done',
  startedAt: 0, endedAt: 55 * MIN + 21 * HOUR, activeMs: 55 * MIN, turns, hasChildren: false,
  startIndex: 1, loaded: true, hasSession: true, ...extra,
})

describe('agentBarParts', () => {
  it('lays out one segment per turn and a gap between them', () => {
    expect(agentBarParts(row(), x => x, 0)).toEqual({
      segments: [{ start: 0, end: 36 * MIN }, { start: 36 * MIN + 21 * HOUR, end: 55 * MIN + 21 * HOUR }],
      gaps: [{ start: 36 * MIN, end: 36 * MIN + 21 * HOUR }],
    })
  })

  it('maps through the domain, so compressed idle gives a short gap, and keeps the running turn open to the domain end', () => {
    const compress = (wall: number) => wall < 36 * MIN ? wall : wall > 21 * HOUR ? wall - 21 * HOUR + MIN : 36 * MIN
    const running = row({ turns: [turns[0]!, { start: turns[1]!.start, end: null, reason: null }] })
    const parts = agentBarParts(running, compress, 99 * MIN)!
    expect(parts.gaps).toEqual([{ start: 36 * MIN, end: 37 * MIN }])
    expect(parts.segments[1]).toEqual({ start: 37 * MIN, end: 99 * MIN })
  })

  it('has no parts without turns', () => {
    expect(agentBarParts(row({ turns: [] }), x => x, 0)).toBeNull()
    const { turns: _omit, ...bare } = row()
    expect(agentBarParts(bare, x => x, 0)).toBeNull()
  })
})

describe('agentDurationText', () => {
  it('says work and wall when the agent idled', () => {
    expect(agentDurationText(row(), t)).toBe('55 min 0 s work · 21 h 55 min')
  })

  it('shows one duration without a notable idle, or without activity', () => {
    expect(agentDurationText(row({ endedAt: 55 * MIN + 10_000 }), t)).toBe('55 min 0 s')
    expect(agentDurationText(row({ activeMs: null, endedAt: 90_000 }), t)).toBe('1 min 30 s')
    expect(agentDurationText(row({ activeMs: null, endedAt: null }), t)).toBeNull()
  })

  it('shows work only while running', () => {
    expect(agentDurationText(row({ status: 'running', endedAt: null }), t)).toBe('55 min 0 s')
  })
})

describe('agentDurationsByStart', () => {
  const life = (startIndex: number, startedAt: number | null, endedAt: number | null) => ({
    id: `c${startIndex}`, shortId: `c${startIndex}`, description: '', background: false, status: 'finished' as const,
    startIndex, endIndex: null, startedAt, endedAt, reportCount: 0, controlCount: 0,
  })

  it('falls back to lifecycle wall time without a row or row text, and prefers the row text', () => {
    const unloaded = row({ startIndex: 1, activeMs: null, startedAt: null, endedAt: null, loaded: false })
    const lives = [life(1, 0, 90_000), life(2, 0, 30_000), life(3, 0, 5_000), life(4, null, null)]
    const result = agentDurationsByStart([unloaded, row({ startIndex: 3 })], lives, t)
    expect(result.get(1)).toBe(formatBoxDuration(90_000, t))
    expect(result.get(2)).toBe(formatBoxDuration(30_000, t))
    expect(result.get(3)).toBe('55 min 0 s work · 21 h 55 min')
    expect(result.has(4)).toBe(false)
  })
})

describe('agentTooltip', () => {
  it('lists the turns with reasons and the idle between them', () => {
    expect(agentTooltip(row(), t).split('\n')).toEqual([
      'Handoff · e4d94b34',
      'Finished · Wall 21 h 55 min · Active 55 min 0 s',
      'Turn 1 · 36 min 0 s · Interrupted',
      'Idle 21 h 0 min',
      'Turn 2 · 19 min 0 s · Finished',
    ])
  })

  it('marks the running turn', () => {
    const running = row({ status: 'running', endedAt: null, turns: [{ start: 0, end: null, reason: null }] })
    expect(agentTooltip(running, t).split('\n').at(-1)).toBe('Turn 1 · Running')
  })
})

describe('deriveAgentTree turns', () => {
  it('carries the projection turns onto the row, none when absent', () => {
    const entry = { id: 'e4d94b34-aaaa', createdAt: 0, mode: 'continuable', label: 'Handoff' }
    const timing = (extra: object) => ({ values: { subagentTiming: { settledMs: 1, ...extra } } })
    const rows = deriveAgentTree('root', {}, {
      root: { values: { subagentCatalog: [entry, { ...entry, id: 'f0000000-aaaa' }] } },
      'e4d94b34-aaaa': timing({ turns }),
      'f0000000-aaaa': timing({}),
    }, [])
    expect(rows[0]!.turns).toEqual(turns)
    expect(rows[1]!.turns).toBeUndefined()
  })
})
