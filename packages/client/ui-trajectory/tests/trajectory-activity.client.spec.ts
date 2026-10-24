/** Activity bucket per Tool-call name; must mirror ui-chat's turnActivityOf. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { trajectoryActivityOf } from '../src/client/trajectory-activity.ts'

describe('trajectoryActivityOf', () => {
  it.each([
    ['write', 'code'],
    ['bash', 'deploy'],
    ['read', 'review'],
    ['subagent_fork', 'proof'],
    ['send_message', 'proof'],
    ['interrupt_agent', 'proof'],
    ['todo_write', 'other'],
    ['mcp__moonshine__search', 'review'],
    ['mcp__moonshine__recall', 'review'],
    ['mcp__moonshine__expand', 'review'],
    ['mcp__codevec__codevec_search', 'review'],
    ['mcp__codevec__codevec_where', 'review'],
    ['mcp__claude_ai_Slack__slack_read_channel', 'review'],
    ['mcp__claude_ai_Notion__notion-search', 'review'],
    ['mcp__linear-amv__linear_amv_get', 'review'],
    ['mcp__linear-amv__get-issue', 'review'],
    ['mcp__moonshine__store', 'other'],
    ['mcp__ledger__create_issue', 'other'],
    ['mcp__ledger__search_issues_v2', 'review'],
    ['mcp__searchbox__update', 'other'],
    ['mcp__codevec__codevec_update', 'other'],
    ['mcp__moonshine', 'other'],
    ['mcp__', 'other'],
  ] as const)('%s is %s', (name, activity) => {
    expect(trajectoryActivityOf(name, false)).toBe(activity)
  })

  it('marks failed calls as error', () => {
    expect(trajectoryActivityOf('mcp__moonshine__search', true)).toBe('error')
  })

  it('is undefined for records without a tool name', () => {
    expect(trajectoryActivityOf(undefined, undefined)).toBeUndefined()
  })
})

describe('MCP read verbs stay in sync with ui-chat', () => {
  const verbsIn = (path: string): string[] => {
    const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    const body = /const MCP_READ_VERBS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? ''
    return [...body.matchAll(/'([^']+)'/g)].map(match => match[1] ?? '').sort()
  }

  it('declares the same verb set in both classifiers', () => {
    const chat = verbsIn('../../ui-chat/src/client/contract/turn-process.ts')
    const trajectory = verbsIn('../src/client/trajectory-activity.ts')
    expect(chat.length).toBeGreaterThan(0)
    expect(trajectory).toEqual(chat)
  })
})
