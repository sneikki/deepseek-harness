/**
 * Hand-bumped fingerprint of the historical-to-current migration output.
 * Persisted projections folded from an in-memory migration are keyed by it, so
 * ANY change to a migrator, a codec, or a migration stage that can alter the
 * migrated events MUST bump this number; otherwise a stale cache would be
 * served for the same unchanged stored log.
 */
export const MIGRATED_CACHE_VERSION = 1
