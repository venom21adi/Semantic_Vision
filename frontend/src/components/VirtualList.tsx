import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Below this many rows, windowing overhead (scroll listeners, absolute
 * positioning, a resize observer) costs more than it saves -- every list
 * this component renders is already cheap to mount in full. Above it (a
 * FastAPI-sized repo's Complexity/Hotspots tab can be thousands of rows --
 * see `CodeHealthDetail.tsx`'s own `MAX_NEIGHBORHOOD_NODES` comment for a
 * real example of that scale), mounting every `RankedFunctionRow` at once
 * on every tab switch is the actual cost this component exists to cut. */
const VIRTUALIZE_THRESHOLD = 60

interface VirtualListProps<T> {
  items: readonly T[]
  /** Fixed row height in px -- every row is wrapped at exactly this height
   * (see the per-row wrapper below), which is what makes windowing math
   * possible without measuring each row's real, content-dependent height. */
  itemHeight: number
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  /** Extra rows kept mounted just outside the visible viewport, so a fast
   * scroll or a keyboard PageDown doesn't flash empty space before the
   * next render catches up. */
  overscan?: number
}

/** A fixed-height-row virtualized list -- renders only the rows near the
 * current scroll position instead of the full array, so a large ranked
 * list (Complexity/Hotspots tabs on a big repo) stays fast to mount on
 * every tab switch rather than laying out thousands of DOM nodes each
 * time. Falls back to a plain, unvirtualized render under
 * `VIRTUALIZE_THRESHOLD` -- most repos, and every test fixture in this
 * app, never exceed it, so the common case pays none of this component's
 * complexity. Owns its own scroll container (`flex: 1, overflowY: auto`)
 * rather than participating in a parent's scroll region, so its viewport
 * height is always exactly what it can measure from its own element. */
export function VirtualList<T>({ items, itemHeight, getKey, renderItem, overscan = 6 }: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (el) setViewportHeight(el.clientHeight)
  }, [])

  useEffect(() => {
    measure()
    // A no-op in this app's test environment (jsdom's `ResizeObserver` is
    // stubbed -- see `test/setup.ts`) -- `measure()` above already covers
    // that case by falling back to rendering every item below, since
    // `viewportHeight` then stays 0.
    const observer = new ResizeObserver(measure)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [measure])

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop)
  }, [])

  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div ref={containerRef} role="list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {items.map((item) => (
          <div key={getKey(item)} role="listitem">
            {renderItem(item)}
          </div>
        ))}
      </div>
    )
  }

  // `viewportHeight` is 0 until the first post-mount measurement lands (or
  // permanently, in a test environment with no real layout) -- rendering a
  // reasonable first batch instead of nothing keeps the initial paint (and
  // every existing test that queries for a rendered row) working rather
  // than showing an empty list until a `ResizeObserver` callback that may
  // never fire.
  const effectiveHeight = viewportHeight || itemHeight * VIRTUALIZE_THRESHOLD
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + effectiveHeight) / itemHeight) + overscan)
  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      role="list"
      style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: startIndex * itemHeight, left: 0, right: 0 }}>
          {visibleItems.map((item) => (
            <div key={getKey(item)} role="listitem" style={{ height: itemHeight, overflow: 'hidden' }}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
