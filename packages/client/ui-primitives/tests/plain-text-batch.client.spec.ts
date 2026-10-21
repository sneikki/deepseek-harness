/** The plain-text Worker's message contract and its main-thread fallbacks. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractMarkdownPlainText } from '../src/markdown/plain-text.ts'
import { extractMarkdownPlainTextAll } from '../src/markdown/plain-text-batch.ts'
import type { PlainTextRequest, PlainTextResponse } from '../src/markdown/plain-text-batch.ts'

const sources = Array.from({ length: 80 }, (_, index) => `# Heading ${index}\n\n**bold** [link](https://x.test) \`code\``)
const expected = sources.map(source => extractMarkdownPlainText(source))

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: PlainTextResponse }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminated = false
  requests: PlainTextRequest[] = []
  constructor(readonly url: string, readonly options?: { name?: string }) { FakeWorker.instances.push(this) }
  postMessage(request: PlainTextRequest): void { this.requests.push(request) }
  terminate(): void { this.terminated = true }
}

function stubWorker(): void {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:plain-text'), revokeObjectURL: vi.fn() }))
  vi.stubGlobal('Blob', vi.fn(function Blob() { /* opaque to the fake Worker */ }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('extractMarkdownPlainTextAll', () => {
  it('posts the sources to one Worker and resolves with its texts, then terminates it', async () => {
    stubWorker()
    const result = extractMarkdownPlainTextAll(sources)
    const worker = FakeWorker.instances[0]!
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.requests).toEqual([{ sources }])
    worker.onmessage?.({ data: { ok: true, texts: expected } })
    await expect(result).resolves.toEqual(expected)
    expect(worker.terminated).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:plain-text')
  })

  it('parses on the main thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(extractMarkdownPlainTextAll(sources)).resolves.toEqual(expected)
  })

  it('parses a small batch in place without starting a Worker', async () => {
    stubWorker()
    await expect(extractMarkdownPlainTextAll(sources.slice(0, 3))).resolves.toEqual(expected.slice(0, 3))
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it.each([
    ['a start-up error', (worker: FakeWorker) => worker.onerror?.()],
    ['a message error', (worker: FakeWorker) => worker.onmessageerror?.()],
    ['a failure reply', (worker: FakeWorker) => worker.onmessage?.({ data: { ok: false } })],
    ['a reply of the wrong length', (worker: FakeWorker) => worker.onmessage?.({ data: { ok: true, texts: ['x'] } })],
  ])('falls back to the main thread after %s', async (_name, fail) => {
    stubWorker()
    const result = extractMarkdownPlainTextAll(sources)
    fail(FakeWorker.instances[0]!)
    await expect(result).resolves.toEqual(expected)
    expect(FakeWorker.instances[0]!.terminated).toBe(true)
  })

  it('falls back when the Worker cannot be constructed', async () => {
    stubWorker()
    vi.stubGlobal('Worker', vi.fn(function Worker() { throw new Error('blocked by CSP') }))
    await expect(extractMarkdownPlainTextAll(sources)).resolves.toEqual(expected)
  })
})

describe('plain-text Worker script', () => {
  it('answers a request with the plain text of each source, in order', async () => {
    const post = vi.fn()
    vi.stubGlobal('postMessage', post)
    await import('../src/markdown/plain-text-worker.ts')
    const onmessage = (globalThis as { onmessage?: (event: { data: PlainTextRequest }) => void }).onmessage!
    onmessage({ data: { sources } })
    expect(post).toHaveBeenCalledWith({ ok: true, texts: expected })
  })
})
