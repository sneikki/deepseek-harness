// @vitest-environment jsdom
/** `useClippedContent` reports content cut by fixed-height boxes, per clipping descendant. */
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useClippedContent } from '../src/useClippedContent.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Probe({ signal, selector }: { signal: string; selector?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const clipped = useClippedContent(ref, signal, selector)
  return (
    <div ref={ref} data-testid="root" data-clipped={clipped}>
      <p data-clip="a" />
      <p data-clip="b" />
    </div>
  )
}

/** jsdom has no layout: give each element a content and box height by attribute. */
function stubHeights(content: Record<string, number>): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return content[this.getAttribute('data-clip') ?? ''] ?? 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40)
}

describe('useClippedContent', () => {
  it('is false when every clipping element shows all of its content', () => {
    stubHeights({ a: 40, b: 20 })
    expect(render(<Probe signal="x" selector="[data-clip]" />).getByTestId('root').dataset.clipped).toBe('false')
  })

  it('is true when any clipping descendant holds more than its box', () => {
    stubHeights({ a: 20, b: 80 })
    expect(render(<Probe signal="x" selector="[data-clip]" />).getByTestId('root').dataset.clipped).toBe('true')
  })

  it('measures the root itself without a selector, and re-measures on a new signal', () => {
    stubHeights({ a: 80 })
    const view = render(<Probe signal="x" />)
    expect(view.getByTestId('root').dataset.clipped).toBe('false')
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(90)
    view.rerender(<Probe signal="y" />)
    expect(view.getByTestId('root').dataset.clipped).toBe('true')
  })

  it('re-measures when the observer reports a size change, and stops observing on unmount', () => {
    stubHeights({ a: 20, b: 20 })
    let notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe() {}
      disconnect() { disconnect() }
    })
    const view = render(<Probe signal="x" selector="[data-clip]" />)
    expect(view.getByTestId('root').dataset.clipped).toBe('false')
    stubHeights({ a: 120 })
    act(() => { notify() })
    expect(view.getByTestId('root').dataset.clipped).toBe('true')
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
