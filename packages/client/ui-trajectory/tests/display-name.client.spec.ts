/** Shared humanised names for ledger badges and summaries. */

import { describe, expect, it } from 'vitest'
import { displayToolName } from '../src/client/trajectory-record.ts'

describe('displayToolName', () => {
  it.each([
    ['list_subagent_models', 'List subagent models'],
    ['read_image', 'Read image'],
    ['subagent_fork', 'Subagent fork'],
    ['mcp__moonshine__store', 'Moonshine store'],
    ['mcp__nuutti-brain__brain_overview', 'Nuutti-brain brain overview'],
    ['bash', 'Bash'],
    ['assistant', 'Assistant'],
    ['thinking', 'Thinking'],
    ['context', 'Context'],
    ['__x__y', 'X y'],
    ['mcp__a__b__c', 'A b c'],
    ['', ''],
  ])('%s reads as %s', (raw, shown) => {
    expect(displayToolName(raw)).toBe(shown)
  })
})
