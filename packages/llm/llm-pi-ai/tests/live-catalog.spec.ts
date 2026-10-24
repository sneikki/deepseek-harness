import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { catalogModels, resolveRouteModels } from '../src/catalog.ts'
import type { LiveModel, RouteCatalogRequest } from '../src/catalog.ts'
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

  it('skips ids on a mixed-protocol catalog unless the route names its protocol', () => {
    // OpenRouter ships both anthropic-messages and openai-completions entries,
    // so an uncatalogued id has no protocol to be served over.
    const live: LiveModel[] = [{ id: 'vendor/brand-new', contextWindow: 50_000 }]
    expect(resolve({ provider: 'openrouter', live }).models.some(model => model.id === 'vendor/brand-new')).toBe(false)
    const named = resolve({ provider: 'openrouter', api: 'openai-completions', live })
    expect(named.models.find(model => model.id === 'vendor/brand-new')).toMatchObject({
      api: 'openai-completions',
      contextWindow: 50_000,
    })
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

  it.each([
    ['no credential', 'zai', {}],
    ['an explicit models list', 'zai', { apiKeyEnv: 'K', models: [{ id: 'x' }] }],
    ['a protocol with no readable listing', 'google', { apiKeyEnv: 'K' }],
    ['a mixed-protocol catalog', 'openrouter', { apiKeyEnv: 'K' }],
    ['a route the catalog does not ship', 'acme', { apiKeyEnv: 'K', api: 'openai-completions', baseURL: 'https://a.example/v1' }],
  ] as const)('does not list a route with %s', (_label, provider, source) => {
    expect(liveTarget(provider, source as LlmPiAi.PiAiProviderProfile)).toBeUndefined()
  })

  it('keeps only fields the listing stated', () => {
    expect(liveModels([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'B', contextWindow: 10, maxTokens: 5, reasoning: true },
    ])).toEqual([{ id: 'a' }, { id: 'b', name: 'B', contextWindow: 10, maxTokens: 5, reasoning: true }])
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

  it('does not ask an endpoint for a route with an explicit list, no credential, or no readable listing', async () => {
    vi.stubEnv('LIVE_KEY', 'live-secret')
    Reflect.deleteProperty(process.env, 'LIVE_ABSENT')
    const { calls } = listingFetch()
    const ctx = await mount({
      zai: { apiKeyEnv: 'LIVE_KEY', models: [{ id: [...catalogModels('zai').keys()][0]! }] },
      'zai-coding-cn': { apiKeyEnv: 'LIVE_ABSENT' },
      google: { apiKeyEnv: 'LIVE_KEY' },
      openrouter: { apiKeyEnv: 'LIVE_KEY' },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls).toHaveLength(0)
    expect((await ctx.llm.listModels('zai')).map(model => model.id)).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
