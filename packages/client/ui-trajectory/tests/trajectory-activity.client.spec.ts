/** Activity bucket per Tool-call name; must mirror ui-chat's turnActivityOf. */

import { describe, expect, it } from 'vitest'
import { trajectoryActivityOf } from '../src/client/trajectory-activity.ts'

describe('trajectoryActivityOf', () => {
  it.each([
    ['write', 'code'],
    ['bash', 'deploy'],
    ['read', 'review'],
    ['subagent_fork', 'proof'],
    ['todo_write', 'other'],
    ['mcp__moonshine__search', 'review'],
    ['mcp__moonshine__recall', 'review'],
    ['mcp__moonshine__expand', 'review'],
    ['mcp__codevec__codevec_search', 'review'],
    ['mcp__codevec__codevec_where', 'review'],
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
