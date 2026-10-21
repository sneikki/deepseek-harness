/**
 * Clipping measurement for fixed-height text boxes: reports whether any
 * clipping element inside the root holds more content than it shows.
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Whether content is cut by an `overflow: hidden` box. Layout is the only
 * place that knows (line wrapping depends on width and font), so this is a
 * pixel measurement re-run on size changes, font loading, and `signal` changes.
 * @param ref - Root element; a null current skips measuring.
 * @param signal - Re-measure trigger: everything that changes the text (a changed string, not an object).
 * @param selector - Clipping descendants to check (e.g. each section of a box); omit to check the root itself.
 * @returns true while any clipping element's content is taller than its box.
 */
export function useClippedContent(
  ref: RefObject<HTMLElement | null>,
  signal: string,
  selector?: string,
): boolean {
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const root = ref.current
    if (root === null) {
      setClipped(false)
      return undefined
    }
    const boxesOf = () => selector === undefined ? [root] : [...root.querySelectorAll<HTMLElement>(selector)]
    const measure = () => {
      setClipped(boxesOf().some(box => box.scrollHeight - box.clientHeight > 1))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(root)
    // The root is a fixed-size box: growth inside it (a highlighter arriving, a wrap toggle) resizes the boxes, not the root.
    for (const box of boxesOf()) observer?.observe(box)
    const fonts = 'fonts' in root.ownerDocument ? root.ownerDocument.fonts : undefined
    fonts?.addEventListener('loadingdone', measure)
    return () => {
      observer?.disconnect()
      fonts?.removeEventListener('loadingdone', measure)
    }
  }, [ref, signal, selector])
  return clipped
}
