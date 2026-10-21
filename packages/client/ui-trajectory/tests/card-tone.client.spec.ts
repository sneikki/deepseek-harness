/** Card colour family per record kind and tool. */

import { describe, expect, it } from 'vitest'
import { trajectoryCardToneOf } from '../src/client/trajectory-activity.ts'

describe('trajectoryCardToneOf', () => {
  it.each([
    ['user', undefined, undefined, 'user'],
    ['message', undefined, undefined, 'assistant'],
    ['thinking', undefined, undefined, 'thinking'],
    ['context', undefined, undefined, 'context'],
    ['system', undefined, undefined, 'context'],
    ['compacted', undefined, undefined, 'context'],
    ['tool', 'bash', false, 'shell'],
    ['tool', 'exec_command', false, 'shell'],
    ['subtool', 'read', false, 'read'],
    ['tool', 'grep', false, 'read'],
    ['tool', 'web_fetch', false, 'read'],
    ['tool', 'edit', false, 'edit'],
    ['tool', 'write', false, 'edit'],
    ['tool', 'mcp__moonshine__store', false, 'mcp'],
    ['tool', 'subagent_fork', false, 'subagent'],
    ['tool', 'todo_write', false, 'tool'],
    ['tool', 'bash', true, 'error'],
    ['tool', 'mcp__a__b', true, 'error'],
  ] as const)('%s %s error=%s is %s', (kind, name, isError, tone) => {
    expect(trajectoryCardToneOf(kind, name, isError)).toBe(tone)
  })
})
