/**
 * Which catalog routes ask their endpoint for a live model listing, and how a
 * listing becomes {@link LiveModel} rows. The installed pi-ai catalog is a
 * snapshot of release time; a provider's newest model is missing from it until
 * the dependency is upgraded, so a route that serves the whole catalog also
 * asks its endpoint what it serves now. Merging is `resolveRouteModels`' job.
 *
 * @module dsh-llm-pi-ai/live
 */

import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { catalogModels, catalogProvider, sharedCatalogApi } from './catalog.ts'
import type { LiveModel } from './catalog.ts'
import { fetchListing, isListableProtocol } from './discovery.ts'
import type { ListedModel } from './discovery.ts'

/** The fields of a raw (read-only) route profile that decide whether and where it lists. */
export interface RawRoute {
  readonly apiKeyEnv?: string | undefined
  readonly api?: string | undefined
  readonly baseURL?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly models?: readonly unknown[] | undefined
}

/** How often a live listing is refreshed. */
export const LIVE_REFRESH_MS = 60 * 60 * 1000

/** Where and how one route is listed. */
export interface LiveTarget {
  baseURL: string
  api: string
  /** Identity of everything a listing depends on; a listing fetched under another one is not applied. */
  fingerprint: string
}

/** A route's last good listing and the target it was fetched from. */
export interface LiveListing {
  fingerprint: string
  models: readonly LiveModel[]
}

/**
 * The listing target of one configured route, or `undefined` when the route
 * serves a fixed catalog or cannot be listed. A route qualifies when it
 * serves the installed catalog (no `models` list), names a credential (no
 * guessing at ambient keys), and speaks one protocol whose listing this build
 * reads. Google's and the other native protocols are not listable here.
 * @param provider - route key.
 * @param source - the route's raw profile.
 * @returns where and how to list the route, or `undefined` when it does not list.
 */
export function liveTarget(provider: string, source: RawRoute | undefined): LiveTarget | undefined {
  if (source?.apiKeyEnv === undefined || (source.models?.length ?? 0) > 0) return undefined
  const defaults = catalogModels(provider)
  if (defaults.size === 0) return undefined
  const api = source.api ?? sharedCatalogApi(defaults)
  const baseURL = source.baseURL ?? catalogProvider(provider)?.baseUrl
  if (api === undefined || !isListableProtocol(api) || baseURL === undefined || !/^https?:\/\//.test(baseURL)) {
    return undefined
  }
  return {
    baseURL,
    api,
    fingerprint: JSON.stringify([baseURL, api, source.apiKeyEnv, Object.entries(source.headers ?? {}).sort()]),
  }
}

/**
 * Keep only what the listing stated.
 * @param listed - parsed endpoint listing.
 * @returns one row per listed model, without fallbacks filled in.
 */
export function liveModels(listed: readonly ListedModel[]): LiveModel[] {
  return listed.map(({ id, name, contextWindow, maxTokens, reasoning }) => ({
    id,
    // The discovery parser falls back to the id for a missing name; that is no statement.
    ...name === undefined || name === id ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoning === undefined ? {} : { reasoning },
  }))
}

/** What the live catalog needs from the plugin. */
export interface LiveCatalogHost {
  /** The current raw `providers` settings. */
  providers: () => Readonly<Record<string, RawRoute>>
  /** The route's credential, or `undefined` when it cannot be resolved now. */
  apiKey: (provider: string) => Promise<string | undefined>
  /** A new listing was stored; the host swaps in a fresh snapshot. */
  changed: () => void
  /** Logged once per route per failure streak. */
  warn: (message: string, error: unknown) => void
}

/** The read side and refresh of the live catalog. */
export interface LiveCatalog {
  /** Replaced (never mutated) whenever a listing changes; the host memoizes on its identity. */
  readonly listings: ReadonlyMap<string, LiveListing>
  /**
   * Listings that still match their route's target, as the rows `resolveProfiles` takes.
   * @param providers - the current raw `providers` settings.
   */
  applicable: (providers: Readonly<Record<string, RawRoute>>) => Map<string, readonly LiveModel[]>
  /** Whether some listable route has no listing for its current target. */
  stale: () => boolean
  /** List every eligible route now; calls overlapping a running one share it. Never rejects. */
  refresh: (signal?: AbortSignal) => Promise<void>
}

/**
 * The last good listing per route and the refresh that renews it. A failed
 * refresh keeps the previous listing and never throws; a listing is applied
 * only while its route still lists from the same endpoint, protocol,
 * credential and headers it was fetched under.
 * @param host - what the plugin supplies: settings, credential, change and log hooks.
 * @returns the catalog's read side and its refresh.
 */
export function createLiveCatalog(host: LiveCatalogHost): LiveCatalog {
  let listings: ReadonlyMap<string, LiveListing> = new Map()
  const failing = new Set<string>()
  let running: Promise<void> | undefined

  const refreshRoute = async (
    provider: string,
    source: RawRoute,
    target: LiveTarget,
    signal: AbortSignal | undefined,
    next: Map<string, LiveListing>,
  ): Promise<void> => {
    try {
      const apiKey = await host.apiKey(provider)
      if (apiKey === undefined) return
      const listed = await fetchListing({ ...target, headers: source.headers, apiKey, signal })
      failing.delete(provider)
      const models = liveModels(listed)
      const previous = listings.get(provider)
      if (previous?.fingerprint !== target.fingerprint || !deepEqualJson(previous.models, models)) {
        next.set(provider, { fingerprint: target.fingerprint, models })
      }
    } catch (error) {
      if (signal?.aborted === true || failing.has(provider)) return
      failing.add(provider)
      host.warn(`llm-pi-ai: live model listing for route "${provider}" failed; keeping the last known models`, error)
    }
  }

  const run = async (signal: AbortSignal | undefined): Promise<void> => {
    const providers = host.providers()
    const next = new Map(listings)
    const before = next.size
    await Promise.all(Object.entries(providers).map(async ([provider, source]) => {
      const target = liveTarget(provider, source)
      if (target !== undefined) await refreshRoute(provider, source, target, signal, next)
    }))
    // A route that no longer lists drops its models with its eligibility.
    const now = host.providers()
    for (const provider of [...next.keys()]) if (liveTarget(provider, now[provider]) === undefined) next.delete(provider)
    const same = next.size === before && [...next].every(([provider, listing]) => listings.get(provider) === listing)
    if (same) return
    listings = next
    host.changed()
  }

  return {
    /** Replaced (never mutated) whenever a listing changes; the host memoizes on its identity. */
    get listings(): ReadonlyMap<string, LiveListing> { return listings },
    /** Listings that still match their route's target, as the rows `resolveProfiles` takes. */
    applicable(providers: Readonly<Record<string, RawRoute>>): Map<string, readonly LiveModel[]> {
      const rows = new Map<string, readonly LiveModel[]>()
      for (const [provider, listing] of listings) {
        if (liveTarget(provider, providers[provider])?.fingerprint === listing.fingerprint) rows.set(provider, listing.models)
      }
      return rows
    },
    /** Whether some listable route has no listing for its current target. */
    stale(): boolean {
      const providers = host.providers()
      return Object.entries(providers).some(([provider, source]) => {
        const target = liveTarget(provider, source)
        return target !== undefined && listings.get(provider)?.fingerprint !== target.fingerprint
      })
    },
    /** List every eligible route now; calls overlapping a running one share it. Never rejects. */
    refresh(signal?: AbortSignal): Promise<void> {
      running ??= run(signal).catch((error: unknown) => { host.warn('llm-pi-ai: live model refresh failed', error) })
        .finally(() => { running = undefined })
      return running
    },
  }
}
