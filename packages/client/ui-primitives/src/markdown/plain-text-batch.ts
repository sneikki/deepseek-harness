/** Off-main-thread {@link extractMarkdownPlainText} for batches too large to parse inside a frame. */

import workerSource from './plain-text-worker.ts?raw'
import { extractMarkdownPlainText } from './plain-text.ts'

/** Worker request: complete-document sources, answered in the same order. */
export interface PlainTextRequest {
  readonly sources: readonly string[]
}

/** Worker response; `ok: false` sends the caller to the main-thread parser. */
export type PlainTextResponse =
  | { readonly ok: true; readonly texts: readonly string[] }
  | { readonly ok: false }

/** Below this a Worker's start-up and copy cost more than parsing in place. */
const WORKER_MIN_SOURCES = 64

function inline(sources: readonly string[]): string[] {
  return sources.map(source => extractMarkdownPlainText(source))
}

/**
 * Plain text of every Markdown source, parsed in a disposable Worker for large batches.
 * Falls back to the main thread, with the same result, when the batch is small, `Worker`
 * is unavailable, the Worker cannot start, or it answers with anything but a matching list.
 * @param sources - Markdown documents; callers bound their length.
 * @returns {@link extractMarkdownPlainText} of each source, in order.
 */
export function extractMarkdownPlainTextAll(sources: readonly string[]): Promise<string[]> {
  if (sources.length < WORKER_MIN_SOURCES || typeof Worker === 'undefined') return Promise.resolve(inline(sources))
  return new Promise((resolve) => {
    let url: string | undefined
    let worker: Worker | undefined
    const finish = (texts: readonly string[] | undefined): void => {
      if (worker !== undefined) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
      }
      if (url !== undefined) URL.revokeObjectURL(url)
      resolve(texts === undefined ? inline(sources) : [...texts])
    }
    try {
      url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
      worker = new Worker(url, { name: 'dsh-plain-text' })
      worker.onerror = () => { finish(undefined) }
      worker.onmessageerror = () => { finish(undefined) }
      worker.onmessage = (event: MessageEvent<PlainTextResponse>) => {
        const message = event.data
        finish(message.ok && message.texts.length === sources.length ? message.texts : undefined)
      }
      const request: PlainTextRequest = { sources }
      worker.postMessage(request)
    } catch {
      finish(undefined)
    }
  })
}
