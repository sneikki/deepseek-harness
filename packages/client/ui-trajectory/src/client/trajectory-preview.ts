/** Bounded Markdown-to-text projection shared by trajectory consumers. */

import { extractMarkdownPlainText, extractMarkdownPlainTextAll } from '@deepseek-ai/dsh-client-ui-primitives'

const PREVIEW_SOURCE_CHARACTERS = 2_048
const PREVIEW_OUTPUT_CHARACTERS = 512

function previewSource(text: string): string {
  return text.slice(0, PREVIEW_SOURCE_CHARACTERS)
}

function finishPreview(text: string, source: string, plain: string): string {
  const compact = plain.replace(/\s+/g, ' ').trim()
  const preview = compact.slice(0, PREVIEW_OUTPUT_CHARACTERS).trimEnd()
  return source.length < text.length || preview.length < compact.length
    ? `${preview}…`
    : preview
}

/**
 * Build a bounded one-line preview without parsing the complete Markdown document.
 * @param text - Untrusted message, reasoning, payload, or result text.
 * @returns A compact preview capped independently from the retained source.
 */
export function trajectoryPreviewText(text: string): string {
  const source = previewSource(text)
  return finishPreview(text, source, extractMarkdownPlainText(source))
}

/**
 * {@link trajectoryPreviewText} of many texts, parsed off the main thread when the batch is large.
 * @param texts - Untrusted message, reasoning, payload, or result texts.
 * @returns One preview per text, in order.
 */
export async function trajectoryPreviewTexts(texts: readonly string[]): Promise<string[]> {
  const sources = texts.map(previewSource)
  const plain = await extractMarkdownPlainTextAll(sources)
  return texts.map((text, index) => finishPreview(text, previewSource(text), plain[index] ?? ''))
}
