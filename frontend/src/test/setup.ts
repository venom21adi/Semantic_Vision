import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// @xyflow/react uses d3-drag to enable node dragging, which attaches a
// raw `mousedown` listener reading `event.view.document`.
// @testing-library/user-event's synthetic MouseEvents always leave
// `view` null (set via a non-configurable getter, so it can't be
// patched afterwards either), which makes that listener throw on every
// simulated click. None of our tests exercise drag-and-drop, so the
// behavior is stubbed out here for the test environment only -- this
// does not affect the real app build/dev server.
vi.mock('d3-drag', () => {
  function noopDragBehavior(): unknown {
    const behavior = (() => behavior) as Record<string, unknown> & (() => unknown)
    for (const method of ['on', 'filter', 'container', 'subject', 'touchable', 'clickDistance']) {
      behavior[method] = () => behavior
    }
    return behavior
  }
  return { drag: noopDragBehavior }
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  // jsdom doesn't implement ResizeObserver, which @xyflow/react needs to
  // measure node dimensions.
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverMock,
  })
}

