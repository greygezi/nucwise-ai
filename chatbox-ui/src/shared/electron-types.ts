export type DesktopAssistantMessageRole = 'system' | 'user' | 'assistant'

export interface DesktopAssistantMessage {
  role: DesktopAssistantMessageRole
  content: string
}

// Keep hosted assistant hand-off failures bounded without treating a slow but
// active model response as a dead request. The renderer owns the model stream
// first-response/idle watchdogs; the main process only waits for renderer ACK
// and uses a longer idle watchdog after the ACK.
export const DESKTOP_ASSISTANT_RENDERER_ACK_TIMEOUT_MS = 15_000
export const DESKTOP_ASSISTANT_ACTIVE_IDLE_TIMEOUT_MS = 120_000
export const DESKTOP_ASSISTANT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = 60_000
export const DESKTOP_ASSISTANT_STREAM_IDLE_TIMEOUT_MS = 60_000

export interface DesktopAssistantRequest {
  requestId: string
  sessionId?: string
  completedResult?: string
  text: string
  action: Record<string, unknown>
  conversation: Array<Record<string, unknown>>
  followupText: string
  messages: DesktopAssistantMessage[]
}

export interface DesktopAssistantProgressEvent {
  requestId: string
  message: string
}

export interface DesktopAssistantChunkEvent {
  requestId: string
  text: string
}

export interface DesktopAssistantResultEvent {
  requestId: string
  ok: boolean
  sessionId?: string
  result?: string
  error?: string
}

export interface DesktopAssistantCancelEvent {
  requestId: string
}

export interface DesktopAssistantComposePayload {
  sessionId?: string
  text?: string
  action?: Record<string, unknown>
  result?: string
  conversation?: Array<Record<string, unknown>>
  followupText?: string
}

export interface ElectronIPC {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  getPathForFile: (file: File) => string
  onSystemThemeChange: (callback: () => void) => () => void
  onWindowMaximizedChanged: (callback: (_: Electron.IpcRendererEvent, windowMaximized: boolean) => void) => () => void
  onWindowShow: (callback: () => void) => () => void
  onWindowFocused: (callback: () => void) => () => void
  onUpdateDownloaded: (callback: () => void) => () => void
  addMcpStdioTransportEventListener: (transportId: string, event: string, callback?: (...args: any[]) => void) => void
  onNavigate: (callback: (path: string) => void) => () => void
  onDesktopAssistantCompose: (callback: (text: string, payload?: DesktopAssistantComposePayload) => void) => () => void
  onDesktopAssistantRequest: (callback: (request: DesktopAssistantRequest) => void) => () => void
  onDesktopAssistantCancel: (callback: (event: DesktopAssistantCancelEvent) => void) => () => void
  notifyDesktopAssistantReady: () => void
  notifyDesktopAssistantStarted: (requestId: string) => void
  sendDesktopAssistantProgress: (event: DesktopAssistantProgressEvent) => void
  sendDesktopAssistantChunk: (event: DesktopAssistantChunkEvent) => void
  sendDesktopAssistantResult: (event: DesktopAssistantResultEvent) => void
  onDifyRunEvent: (callback: (event: import('./dify').DifyRunEvent) => void) => () => void

  // Auto-updater events
  onUpdaterChecking: (callback: () => void) => () => void
  onUpdaterAvailable: (callback: (data: { version: string }) => void) => () => void
  onUpdaterNotAvailable: (callback: () => void) => () => void
  onUpdaterProgress: (
    callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  ) => () => void
  onUpdaterDownloaded: (callback: (data: { version: string }) => void) => () => void
  onUpdaterError: (callback: (data: { message: string }) => void) => () => void
}
