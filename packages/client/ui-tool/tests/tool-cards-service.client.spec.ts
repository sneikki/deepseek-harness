import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { StartedToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ToolCards } from '../src/client/tool-cards-service.ts'
import { toolCardLabels } from '../src/client/tool/models/tool-card-labels.ts'

const t = makeTranslate(zh, commonZh)

const running = (name: string, argsRaw: string): StartedToolCall => ({
  phase: 'start' as const, args: PartialArguments.fromText(argsRaw), callId: 'c1', name, argsRaw,
  turn: 1, step: 1, time: 1_000, subCalls: [],
})

async function contextWithTools(home: string): Promise<Context> {
  const ctx = new Context()
  ctx.provide('remote', { $host: { home } } as never)
  await ctx.plugin(ToolCards).await()
  return ctx
}

describe('ToolCards service', () => {
  it('registers on ctx.toolCards as the ToolCards instance', async () => {
    const ctx = await contextWithTools('/home/u')
    expect(ctx.toolCards).toBeInstanceOf(ToolCards)
  })

  it('derives the shell command body of a bash call', async () => {
    const ctx = await contextWithTools('/home/u')
    expect(ctx.toolCards.cardBody('bash', running('bash', '{"command":"ls -la"}'))).toEqual({ kind: 'bash', command: 'ls -la' })
  })

  it('gives a call without a rich body no body', async () => {
    const ctx = await contextWithTools('/home/u')
    expect(ctx.toolCards.cardBody('edit', running('edit', '{"file_path":"a.ts"}'))).toBeUndefined()
  })

  it('serves the labels of the conversation locale', async () => {
    const ctx = await contextWithTools('/home/u')
    expect(ctx.toolCards.labels(t).copy).toBe(toolCardLabels(t).copy)
  })
})
