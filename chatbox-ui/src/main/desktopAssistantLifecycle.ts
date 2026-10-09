export type DesktopAssistantRequestPhase = 'pending' | 'sent' | 'active'

export interface DesktopAssistantRequestTimeout<T> {
  requestId: string
  payload: T
  phase: DesktopAssistantRequestPhase
}

export function isDesktopAssistantRendererReload(details: { isMainFrame: boolean; isSameDocument: boolean }) {
  return details.isMainFrame && !details.isSameDocument
}

interface RequestRecord<T> {
  payload: T
  phase: DesktopAssistantRequestPhase
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Tracks a hosted assistant request until the renderer reports a result.
 *
 * The main process needs to retain a sent request because a renderer reload
 * can happen between `webContents.send` and the renderer handler. A request
 * only becomes active after the renderer acknowledges it (or sends progress),
 * so a send call alone is never treated as delivery. Active requests use an
 * idle watchdog that is refreshed by progress/chunks; the renderer owns the
 * first-response and stream-idle watchdogs for model execution.
 */
export class DesktopAssistantRequestLifecycle<T> {
  private readonly records = new Map<string, RequestRecord<T>>()

  constructor(
    private readonly ackTimeoutMs: number,
    private readonly onTimeout: (request: DesktopAssistantRequestTimeout<T>) => void,
    private readonly activeIdleTimeoutMs = ackTimeoutMs
  ) {}

  track(requestId: string, payload: T): boolean {
    if (!requestId || this.records.has(requestId)) return false
    const record: RequestRecord<T> = { payload, phase: 'pending' }
    this.records.set(requestId, record)
    this.armTimeout(requestId, record)
    return true
  }

  update(requestId: string, payload: T): boolean {
    const record = this.records.get(requestId)
    if (!record) return false
    record.payload = payload
    record.phase = 'pending'
    this.armTimeout(requestId, record)
    return true
  }

  markSent(requestId: string): boolean {
    const record = this.records.get(requestId)
    if (!record || record.phase !== 'pending') return false
    record.phase = 'sent'
    return true
  }

  markActive(requestId: string): boolean {
    const record = this.records.get(requestId)
    if (!record || record.phase === 'pending') return false
    const transitioned = record.phase !== 'active'
    record.phase = 'active'
    this.armTimeout(requestId, record)
    return transitioned
  }

  touch(requestId: string): boolean {
    const record = this.records.get(requestId)
    if (!record || record.phase !== 'active') return false
    this.armTimeout(requestId, record)
    return true
  }

  requeueSent(): Array<[string, T]> {
    const requeued: Array<[string, T]> = []
    for (const [requestId, record] of this.records) {
      if (record.phase !== 'sent') continue
      record.phase = 'pending'
      this.armTimeout(requestId, record)
      requeued.push([requestId, record.payload])
    }
    return requeued
  }

  pending(): Array<[string, T]> {
    return Array.from(this.records)
      .filter(([, record]) => record.phase === 'pending')
      .map(([requestId, record]) => [requestId, record.payload])
  }

  active(): Array<[string, T]> {
    return Array.from(this.records)
      .filter(([, record]) => record.phase === 'active')
      .map(([requestId, record]) => [requestId, record.payload])
  }

  has(requestId: string): boolean {
    return this.records.has(requestId)
  }

  complete(requestId: string): boolean {
    const record = this.records.get(requestId)
    if (!record) return false
    this.clearRecord(requestId, record)
    return true
  }

  clear() {
    for (const [requestId, record] of this.records) {
      this.clearRecord(requestId, record)
    }
  }

  private armTimeout(requestId: string, record: RequestRecord<T>) {
    if (record.timer) clearTimeout(record.timer)
    const timeoutMs = record.phase === 'active' ? this.activeIdleTimeoutMs : this.ackTimeoutMs
    record.timer = setTimeout(() => {
      if (this.records.get(requestId) !== record) return
      this.records.delete(requestId)
      record.timer = undefined
      this.onTimeout({ requestId, payload: record.payload, phase: record.phase })
    }, timeoutMs)
    record.timer.unref?.()
  }

  private clearRecord(requestId: string, record: RequestRecord<T>) {
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    this.records.delete(requestId)
  }
}
