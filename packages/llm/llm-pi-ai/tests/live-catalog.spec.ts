import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { catalogModels, resolveRouteModels } from '../src/catalog.ts'
import type { LiveModel, RouteCatalogRequest } from '../src/catalog.ts'
import { fetchListing } from '../src/discovery.ts'
import { liveModels, liveTarget } from '../src/live.ts'

const HOUR = 60 * 60 * 1000
const FALLBACKS = { defaultContextWindow: 262_144, defaultMaxTokens: 32_768, defaultInput: ['text'] } as const

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function resolve(request: Partial<RouteCatalogRequest> & { provider: string }) {
  return resolveRouteModels({ ...FALLBACKS, defaultInput: ['text'], ...request })
}

describe('merging a live listing into a catalog route', () => {
  const installed = [...catalogModels('zai').values()][0]!

  it('adds an unknown id with only what the listing states and the route fallbacks for the rest', () => {
    const before = resolve({ provider: 'zai' })
    const live: LiveModel[] = [{ id: 'glm-99', name: 'GLM 99', contextWindow: 123_456 }]
    const after = resolve({ provider: 'zai', live })

    const added = after.models.find(model => model.id === 'glm-99')!
    expect(added).toMatchObject({
      id: 'glm-99',
      name: 'GLM 99',
      provider: 'zai',
      api: installed.api,
      baseUrl: installed.baseUrl,
      contextWindow: 123_456,
      // Not stated by the listing: the route's fallback, never a sibling's capacity.
      maxTokens: FALLBACKS.defaultMaxTokens,
      input: ['text'],
      reasoning: false,
    })
    // A listing never becomes a per-request output cap.
    expect(after.configuredMaxTokens.has('glm-99')).toBe(false)
    // Installed entries are untouched and keep their order ahead of the new id.
    expect(after.models.slice(0, -1)).toEqual(before.models)
    expect(after.models.at(-1)).toBe(added)
  })

  it('never lets a listing change an installed entry or an override', () => {
    const live: LiveModel[] = [{ id: installed.id, name: 'renamed', contextWindow: 1, maxTokens: 1, reasoning: true }]
    const overrides = { [installed.id]: { maxTokens: 4096 } }
    const without = resolve({ provider: 'zai', modelOverrides: overrides })
    const withLive = resolve({ provider: 'zai', modelOverrides: overrides, live })
    expect(withLive.models).toEqual(without.models)
    expect(withLive.configuredMaxTokens).toEqual(without.configuredMaxTokens)
  })

  it('ignores a listing beside an explicit models list', () => {
    const models = [{ id: installed.id }]
    const without = resolve({ provider: 'zai', models })
    const withLive = resolve({ provider: 'zai', models, live: [{ id: 'glm-99' }] })
    expect(withLive.models.map(model => model.id)).toEqual([installed.id])
    expect(withLive.models).toEqual(without.models)
  })

  it('adds an id once even when the listing repeats it', () => {
    const after = resolve({ provider: 'zai', live: [{ id: 'glm-99' }, { id: 'glm-99' }, { id: '' }] })
    expect(after.models.filter(model => model.id === 'glm-99')).toHaveLength(1)
    expect(after.models.some(model => model.id === '')).toBe(false)
  })

  it('serves an id on a mixed-protocol catalog over the protocol of the listing that returned it', () => {
    // OpenRouter ships both anthropic-messages and openai-completions entries.
    const before = resolve({ provider: 'openrouter' })
    const after = resolve({
      provider: 'openrouter',
      live: [{ id: 'vendor/brand-new', api: 'openai-completions', contextWindow: 50_000 }],
    })
    expect(after.models.find(model => model.id === 'vendor/brand-new')).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      contextWindow: 50_000,
    })
    // Installed anthropic-messages entries keep their protocol and endpoint.
    expect(after.models.slice(0, -1)).toEqual(before.models)
    const installedAnthropic = before.models.filter(model => model.api === 'anthropic-messages')
    expect(installedAnthropic.length).toBeGreaterThan(0)
    expect(after.models.filter(model => model.api === 'anthropic-messages')).toEqual(installedAnthropic)
  })

  it('skips an id that no protocol serves', () => {
    const live: LiveModel[] = [{ id: 'vendor/brand-new' }]
    expect(resolve({ provider: 'openrouter', live }).models.some(model => model.id === 'vendor/brand-new')).toBe(false)
  })

  it('takes a stated reasoning flag without inventing level spellings', () => {
    const after = resolve({ provider: 'zai', live: [{ id: 'glm-think', reasoning: true }, { id: 'glm-plain' }] })
    const think = after.models.find(model => model.id === 'glm-think')!
    expect(think.reasoning).toBe(true)
    expect(think.thinkingLevelMap).toBeUndefined()
    expect(after.models.find(model => model.id === 'glm-plain')!.reasoning).toBe(false)
  })
})

describe('which routes list live', () => {
  it('lists a catalog route that names a credential and serves the whole catalog', () => {
    expect(liveTarget('zai', { apiKeyEnv: 'K' })).toMatchObject({
      api: 'openai-completions',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
    })
  })

  it('lists a mixed catalog at the endpoint its route addresses', () => {
    expect(liveTarget('openrouter', { apiKeyEnv: 'K' })).toMatchObject({
      api: 'openai-completions',
      baseURL: 'https://openrouter.ai/api/v1',
    })
  })

  it.each([
    ['no credential', 'zai', {}],
    ['an explicit models list', 'zai', { apiKeyEnv: 'K', models: [{ id: 'x' }] }],
    ['a protocol with no readable listing', 'mistral', { apiKeyEnv: 'K' }],
    ['a mixed catalog with no single protocol at its endpoint', 'github-copilot', { apiKeyEnv: 'K' }],
    ['a route the catalog does not ship', 'acme', { apiKeyEnv: 'K', api: 'openai-completions', baseURL: 'https://a.example/v1' }],
  ] as const)('does not list a route with %s', (_label, provider, source) => {
    expect(liveTarget(provider, source as LlmPiAi.PiAiProviderProfile)).toBeUndefined()
  })

  it('keeps only fields the listing stated', () => {
    expect(liveModels([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'B', contextWindow: 10, maxTokens: 5, reasoning: true },
    ], 'openai-completions')).toEqual([
      { id: 'a', api: 'openai-completions' },
      { id: 'b', api: 'openai-completions', name: 'B', contextWindow: 10, maxTokens: 5, reasoning: true },
    ])
  })
})

describe('efforts a live listing states', () => {
  /** Run a listing body through the real parser and the live row mapping. */
  async function listed(body: unknown, baseURL: string, api: string): Promise<LiveModel[]> {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body)))))
    return liveModels(await fetchListing({ baseURL, api, apiKey: 'k' }), api)
  }
  const levelOf = (model: { thinkingLevelMap?: Record<string, string | null> | undefined }) =>
    Object.entries(model.thinkingLevelMap ?? {}).filter(([, wire]) => wire !== null).map(([level]) => level)

  it('makes a kimi-coding id selectable low/high/max from reasoning.effort.valid', async () => {
    const live = await listed({
      data: [{
        id: 'k3.1-pro',
        display_name: 'K3.1 Pro',
        context_length: 262_144,
        supports_reasoning: true,
        reasoning: { type: 'only', effort: { valid: ['low', 'high', 'max'], default: 'high' } },
      }],
    }, 'https://api.kimi.com/coding', 'anthropic-messages')
    const model = resolve({ provider: 'kimi-coding', live }).models.find(entry => entry.id === 'k3.1-pro')!
    expect(model.reasoning).toBe(true)
    expect(model.thinkingLevelMap).toMatchObject({ low: 'low', high: 'high', max: 'max', off: null, medium: null })
    expect(model.compat).toEqual({ allowEmptySignature: true, forceAdaptiveThinking: true })
  })

  it('makes an OpenRouter id selectable with off from supported_efforts', async () => {
    const live = await listed({
      data: [{
        id: 'vendor/new',
        supported_parameters: ['reasoning', 'reasoning_effort'],
        reasoning: { mandatory: false, default_enabled: true, supported_efforts: ['max', 'high', 'low', 'none'], default_effort: 'max' },
      }],
    }, 'https://openrouter.ai/api/v1', 'openai-completions')
    const model = resolve({ provider: 'openrouter', live }).models.find(entry => entry.id === 'vendor/new')!
    expect(model.reasoning).toBe(true)
    expect(model.thinkingLevelMap).toMatchObject({ off: 'none', low: 'low', high: 'high', max: 'max', medium: null })
    expect(levelOf(model)).toEqual(['off', 'low', 'high', 'max'])
    expect(model.compat).toEqual({ thinkingFormat: 'openrouter' })
  })

  it('gives zai and minimax ids that list only ids no effort', async () => {
    const body = { data: [{ id: 'glm-99', object: 'model', created: 1, owned_by: 'z' }] }
    const zai = await listed(body, 'https://api.z.ai/api/coding/paas/v4', 'openai-completions')
    const minimax = await listed(body, 'https://api.minimax.io/anthropic', 'anthropic-messages')
    for (const [provider, live] of [['zai', zai], ['minimax', minimax]] as const) {
      const model = resolve({ provider, live }).models.find(entry => entry.id === 'glm-99')!
      expect(model.reasoning).toBe(false)
      expect(model.thinkingLevelMap).toBeUndefined()
    }
  })

  it('gives a listing without reasoning fields no effort', () => {
    expect(liveModels([{ id: 'plain' }], 'openai-completions')).toEqual([{ id: 'plain', api: 'openai-completions' }])
  })

  it('drops names that are no level and offers nothing when only off or unknown names remain', () => {
    expect(liveModels([
      { id: 'a', efforts: ['none'] },
      { id: 'b', efforts: ['turbo'] },
      { id: 'c', efforts: ['turbo', 'medium'] },
    ], 'openai-completions')).toEqual([
      { id: 'a', api: 'openai-completions' },
      { id: 'b', api: 'openai-completions' },
      { id: 'c', api: 'openai-completions', efforts: { medium: 'medium' } },
    ])
  })

  it('adds no compat on a route with no declared thinking compat, nor without stated efforts', () => {
    const efforts = { high: 'high' }
    const undeclared = resolve({ provider: 'groq', live: [{ id: 'g-new', api: 'openai-completions', efforts }] })
      .models.find(entry => entry.id === 'g-new')!
    expect(undeclared.thinkingLevelMap).toMatchObject({ high: 'high' })
    expect(undeclared.compat).toBeUndefined()
    // A declared route borrows nothing for a model whose listing states no effort.
    const plain = resolve({ provider: 'kimi-coding', live: [{ id: 'k-plain', api: 'anthropic-messages' }] })
      .models.find(entry => entry.id === 'k-plain')!
    expect(plain.compat).toBeUndefined()
  })

  it('applies the declared endpoint compat only for the declared protocol', () => {
    const efforts = { high: 'high' }
    expect(resolve({ provider: 'openrouter', live: [{ id: 'v/a', api: 'openai-completions', efforts }] })
      .models.find(entry => entry.id === 'v/a')!.compat).toEqual({ thinkingFormat: 'openrouter' })
    expect(resolve({ provider: 'openrouter', live: [{ id: 'v/b', api: 'anthropic-messages', efforts }] })
      .models.find(entry => entry.id === 'v/b')!.compat).toBeUndefined()
  })
})

/** A fetch stand-in answering the model listing from a mutable script. */
function listingFetch() {
  const script: { fail: boolean; ids: string[] } = { fail: false, ids: ['glm-99'] }
  const calls: { url: string; headers: Headers }[] = []
  const fetchStub = vi.fn((url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: url.toString(), headers: new Headers(init?.headers) })
    if (script.fail) return Promise.reject(new TypeError('network down'))
    return Promise.resolve(new Response(JSON.stringify({ data: script.ids.map(id => ({ id })) })))
  })
  vi.stubGlobal('fetch', fetchStub)
  return { script, calls }
}

async function mount(providers: Record<string, LlmPiAi.PiAiProviderProfile>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers })
  return ctx
}

describe('live listing in a mounted plugin', () => {
  it('serves a newly listed model through the directory the UI reads, and renews it hourly', async () => {
    vi.stubEnv('LIVE_KEY', 'live-secret')
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { script, calls } = listingFetch()
    const ctx = await mount({ zai: { apiKeyEnv: 'LIVE_KEY' } })
    const warn = vi.spyOn(ctx.logger, 'warn')
    let announced = 0
    ctx.on('llm/adapters-updated', () => { announced += 1 })
    const installedIds = [...catalogModels('zai').keys()]

    // Start: the listing is fetched without blocking, then the new id shows up
    // beside the installed ones in the very listing selectors read.
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('zai')).map(model => model.id)).toEqual([...installedIds, 'glm-99'])
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.z.ai/api/coding/paas/v4/models')
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer live-secret')
    expect(announced).toBeGreaterThan(0)
    // Servable, not only listed: it resolves with the route's own fallbacks.
    await expect(ctx.llm.resolveModelInfo('zai', 'glm-99')).resolves.toMatchObject({ id: 'glm-99' })

    // Nothing happens before the hour is up.
    await vi.advanceTimersByTimeAsync(HOUR / 2)
    expect(calls).toHaveLength(1)

    // A failing refresh keeps the last good listing and logs once for the streak.
    script.fail = true
    announced = 0
    await vi.advanceTimersByTimeAsync(HOUR / 2 + 1000)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(calls).toHaveLength(3)
    expect((await ctx.llm.listModels('zai')).map(model => model.id)).toContain('glm-99')
    expect(warn.mock.calls.filter(([message]) => String(message).includes('live model listing'))).toHaveLength(1)
    expect(announced).toBe(0)

    // Recovery picks up the next release and announces the new snapshot.
    script.fail = false
    script.ids = ['glm-99', 'glm-100']
    await vi.advanceTimersByTimeAsync(HOUR)
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('zai')).map(model => model.id)).toEqual([...installedIds, 'glm-99', 'glm-100'])
    })
    expect(announced).toBeGreaterThan(0)

    // An unchanged listing is not a new snapshot.
    announced = 0
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(calls).toHaveLength(5)
    expect(announced).toBe(0)
    await ctx.fiber.dispose()
  })

  it('lists once the credentials service arrives after start, and again when a stored key changes', async () => {
    Reflect.deleteProperty(process.env, 'LIVE_STORED')
    const { script, calls } = listingFetch()
    const ctx = await mount({ zai: { apiKeyEnv: 'LIVE_STORED' } })
    // Start: no service and no environment key, so nothing is asked.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls).toHaveLength(0)

    // The key lives only in the store, which comes up after the plugin.
    ctx.provide('credentials')
    ctx.set('credentials', {
      resolve: (ref: string) => Promise.resolve(ref === 'LIVE_STORED' ? { value: 'stored-key', source: 'file' } : undefined),
    } as never)
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('zai')).map(model => model.id)).toContain('glm-99')
    })
    expect(calls.at(-1)!.headers.get('authorization')).toBe('Bearer stored-key')

    // A key stored through the UI lists again without waiting for the hour.
    script.ids = ['glm-99', 'glm-100']
    const before = calls.length
    ctx.emit('credentials/reference-updated', credentialRef('LIVE_STORED'))
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('zai')).map(model => model.id)).toContain('glm-100')
    })
    expect(calls.length).toBeGreaterThan(before)
    await ctx.fiber.dispose()
  })

  it('does not ask an endpoint for a route with an explicit list, no credential, or no readable listing', async () => {
    vi.stubEnv('LIVE_KEY', 'live-secret')
    Reflect.deleteProperty(process.env, 'LIVE_ABSENT')
    const { calls } = listingFetch()
    const ctx = await mount({
      zai: { apiKeyEnv: 'LIVE_KEY', models: [{ id: [...catalogModels('zai').keys()][0]! }] },
      'zai-coding-cn': { apiKeyEnv: 'LIVE_ABSENT' },
      mistral: { apiKeyEnv: 'LIVE_KEY' },
      'github-copilot': { apiKeyEnv: 'LIVE_KEY' },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls).toHaveLength(0)
    expect((await ctx.llm.listModels('zai')).map(model => model.id)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it.each([
    ['a network error carrying the URL and a cause', () => {
      vi.stubGlobal('fetch', (url: string) => Promise.reject(
        new TypeError(`fetch failed for ${url}`, { cause: new Error(`connect ECONNREFUSED ${url}`) }),
      ))
    }, 'LlmError|DISCOVERY_FAILED'],
    ['an HTTP failure whose body echoes the key', () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('bad key SECRET-KEY-123', { status: 403 })))
    }, '403'],
  ])('never logs a key from %s', async (_label, stub, expected) => {
    vi.stubEnv('LIVE_KEY', 'SECRET-KEY-123')
    stub()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const logged: string[] = []
    for (const level of ['warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(ctx.logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => (arg instanceof Error ? `${arg.message} ${String(arg.cause)}` : String(arg))).join(' '))
      })
    }
    await ctx.plugin(LlmPiAi, { providers: { zai: {
      apiKeyEnv: 'LIVE_KEY',
      baseURL: 'https://user:SECRET-KEY-123@gateway.example/v1?key=SECRET-KEY-123',
    } } })
    await vi.waitFor(() => { expect(logged.some(line => line.includes('live model listing'))).toBe(true) })

    const text = logged.join('\n')
    expect(text).not.toContain('SECRET-KEY-123')
    expect(text).not.toContain('user:')
    expect(text).toContain('zai')
    expect(text).toContain('https://gateway.example')
    expect(new RegExp(expected).test(text)).toBe(true)
    await ctx.fiber.dispose()
  })
})
