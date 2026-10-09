import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAssistantRequestLifecycle, isDesktopAssistantRendererReload } from './desktopAssistantLifecycle'

afterEach(() => vi.useRealTimers())

describe('DesktopAssistantRequestLifecycle', () => {
  it('only resets renderer readiness for a full main-frame navigation', () => {
    expect(isDesktopAssistantRendererReload({ isMainFrame: true, isSameDocument: false })).toBe(true)
    expect(isDesktopAssistantRendererReload({ isMainFrame: false, isSameDocument: false })).toBe(false)
    expect(isDesktopAssistantRendererReload({ isMainFrame: true, isSameDocument: true })).toBe(false)
  })

  it('clears a successful request before its watchdog fires', () => {
    vi.useFakeTimers()
    const timedOut = vi.fn()
    const lifecycle = new DesktopAssistantRequestLifecycle(1000, timedOut, 2000)

    expect(lifecycle.track('request-1', { value: 'payload' })).toBe(true)
    expect(lifecycle.markSent('request-1')).toBe(true)
    expect(lifecycle.markActive('request-1')).toBe(true)
    expect(lifecycle.complete('request-1')).toBe(true)
    vi.advanceTimersByTime(2001)

    expect(timedOut).not.toHaveBeenCalled()
    expect(lifecycle.complete('request-1')).toBe(false)
  })

  it('reports and removes a request that times out while pending', () => {
    vi.useFakeTimers()
    const timedOut = vi.fn()
    const lifecycle = new DesktopAssistantRequestLifecycle(1000, timedOut)

    lifecycle.track('request-2', { value: 'payload' })
    vi.advanceTimersByTime(1001)

    expect(timedOut).toHaveBeenCalledWith({
      requestId: 'request-2',
      payload: { value: 'payload' },
      phase: 'pending',
    })
    expect(lifecycle.pending()).toEqual([])
    expect(lifecycle.complete('request-2')).toBe(false)
  })

  it('requeues a sent request after a renderer reload but keeps active work out of resend', () => {
    vi.useFakeTimers()
    const lifecycle = new DesktopAssistantRequestLifecycle(1000, vi.fn())

    lifecycle.track('request-3', { value: 'payload' })
    lifecycle.markSent('request-3')
    expect(lifecycle.requeueSent()).toEqual([['request-3', { value: 'payload' }]])
    expect(lifecycle.pending()).toEqual([['request-3', { value: 'payload' }]])
    lifecycle.markSent('request-3')
    lifecycle.markActive('request-3')
    expect(lifecycle.requeueSent()).toEqual([])
  })

  it('ignores a late result after timeout cleanup', () => {
    vi.useFakeTimers()
    const lifecycle = new DesktopAssistantRequestLifecycle(1000, vi.fn())

    lifecycle.track('request-4', { value: 'payload' })
    vi.advanceTimersByTime(1001)

    expect(lifecycle.complete('request-4')).toBe(false)
    expect(lifecycle.active()).toEqual([])
  })

  it('refreshes the active idle watchdog when progress arrives', () => {
    vi.useFakeTimers()
    const timedOut = vi.fn()
    const lifecycle = new DesktopAssistantRequestLifecycle(1000, timedOut, 2000)

    lifecycle.track('request-5', { value: 'payload' })
    lifecycle.markSent('request-5')
    lifecycle.markActive('request-5')
    vi.advanceTimersByTime(1500)
    expect(lifecycle.touch('request-5')).toBe(true)
    vi.advanceTimersByTime(1999)
    expect(timedOut).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(timedOut).toHaveBeenCalledWith({
      requestId: 'request-5',
      payload: { value: 'payload' },
      phase: 'active',
    })
  })
})
