/**
 * Disposable Worker entry, bundled to text by `tsdown.config.ts` and started from a Blob URL.
 * It has no loader-module table, so it imports nothing but the Markdown parser's own graph.
 */
import { extractMarkdownPlainText } from './plain-text.ts'
import type { PlainTextRequest, PlainTextResponse } from './plain-text-batch.ts'

globalThis.onmessage = (event: MessageEvent<PlainTextRequest>) => {
  let response: PlainTextResponse
  try {
    response = { ok: true, texts: event.data.sources.map(source => extractMarkdownPlainText(source)) }
  } catch {
    response = { ok: false }
  }
  globalThis.postMessage(response)
}
