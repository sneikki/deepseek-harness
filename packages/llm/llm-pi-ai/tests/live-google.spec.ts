import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { catalogModels } from '../src/catalog.ts'
import { fetchListing } from '../src/discovery.ts'
import { liveTarget } from '../src/live.ts'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY = 'GOOG-SECRET-KEY-456'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const chat = ['generateContent', 'countTokens']

/** Two pages: the second is reached only through `nextPageToken`. */
function pages(): Record<string, unknown> {
  return {
    first: {
      models: [
        { name: 'models/gemini-9-pro', displayName: 'Gemini 9 Pro', inputTokenLimit: 2_000_000, outputTokenLimit: 65_536, supportedGenerationMethods: chat },
        { name: 'models/text-embedding-9', displayName: 'Embedding 9', inputTokenLimit: 2048, supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-9-bare', supportedGenerationMethods: ['generateContent'] },
      ],
      nextPageToken: 'tok/2',
    },
    second: {
      models: [
        { name: 'models/gemini-9-flash', displayName: 'Gemini 9 Flash', inputTokenLimit: 1_000_000, outputTokenLimit: 0, supportedGenerationMethods: chat },
        { displayName: 'no name', supportedGenerationMethods: chat },
      ],
    },
  }
}

function stubGoogle() {
  const calls: { url: string; headers: Headers }[] = []
  const answers = pages()
  vi.stubGlobal('fetch', (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: new Headers(init?.headers) })
    const token = new URL(url).searchParams.get('pageToken')
    return Promise.resolve(new Response(JSON.stringify(token === null ? answers['first'] : answers['second'])))
  })
  return calls
}

describe('Google model listing', () => {
  it('maps chat models, filters, follows pages and sends the key only as a header', async () => {
    const calls = stubGoogle()
    const listed = await fetchListing({ baseURL: BASE, api: 'google-generative-ai', apiKey: KEY })

    expect(listed).toEqual([
      { id: 'gemini-9-pro', name: 'Gemini 9 Pro', contextWindow: 2_000_000, maxTokens: 65_536 },
      // Nothing invented: no name, limits or reasoning the entry does not state.
      { id: 'gemini-9-bare' },
      // A zero limit is not a statement.
      { id: 'gemini-9-flash', name: 'Gemini 9 Flash', contextWindow: 1_000_000 },
    ])
    expect(calls.map(call => new URL(call.url).pathname)).toEqual(['/v1beta/models', '/v1beta/models'])
    expect(new URL(calls[1]!.url).searchParams.get('pageToken')).toBe('tok/2')
    for (const call of calls) {
      expect(call.headers.get('x-goog-api-key')).toBe(KEY)
      expect(call.headers.get('authorization')).toBeNull()
      expect(call.url).not.toContain(KEY)
      expect(call.url).not.toContain('key=')
    }
  })

  it('stops following a looping page token', async () => {
    let requests = 0
    vi.stubGlobal('fetch', () => {
      requests += 1
      return Promise.resolve(new Response(JSON.stringify({ models: [], nextPageToken: 'again' })))
    })
    await expect(fetchListing({ baseURL: BASE, api: 'google-generative-ai', apiKey: KEY })).resolves.toEqual([])
    expect(requests).toBe(20)
  })

  it('is a live-listed route', () => {
    expect(liveTarget('google', { apiKeyEnv: 'K' })).toMatchObject({ api: 'google-generative-ai', baseURL: BASE })
  })

  it('adds a listed model to the route through the plugin, and never logs the key', async () => {
    vi.stubEnv('GOOG_KEY', KEY)
    stubGoogle()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { google: { apiKeyEnv: 'GOOG_KEY' } } })
    const installedIds = [...catalogModels('google').keys()]

    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('google')).map(model => model.id)).toEqual([
        ...installedIds,
        ...['gemini-9-pro', 'gemini-9-bare', 'gemini-9-flash'].filter(id => !installedIds.includes(id)),
      ])
    })
    await expect(ctx.llm.resolveModelInfo('google', 'gemini-9-pro')).resolves.toMatchObject({ id: 'gemini-9-pro' })
    await ctx.fiber.dispose()
  })

  it('never logs the key when the listing fails', async () => {
    vi.stubEnv('GOOG_KEY', KEY)
    vi.stubGlobal('fetch', (url: string) => Promise.reject(
      new TypeError(`fetch failed for ${url}?key=${KEY}`, { cause: new Error(`ECONNREFUSED ${KEY}`) }),
    ))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const logged: string[] = []
    for (const level of ['warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(ctx.logger, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')) })
    }
    await ctx.plugin(LlmPiAi, { providers: { google: { apiKeyEnv: 'GOOG_KEY' } } })
    await vi.waitFor(() => { expect(logged.some(line => line.includes('live model listing'))).toBe(true) })
    expect(logged.join('\n')).not.toContain(KEY)
    expect(logged.join('\n')).toContain('https://generativelanguage.googleapis.com')
    await ctx.fiber.dispose()
  })
})
