export type DifyAppType = 'workflow' | 'chatflow'

// Stored explicitly so an old installation with no preference can keep its
// historical first-Workflow fallback while users can opt into default Chat.
export const DESKTOP_ASSISTANT_DEFAULT_CHAT = '__default_chat__'

export interface DifyProfile {
  id: string
  name: string
  baseUrl: string
  appType: DifyAppType
  verifyTls: boolean
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface DifyProfileInput {
  id?: string
  name: string
  baseUrl: string
  appType: DifyAppType
  verifyTls?: boolean
  apiKey?: string
}

export interface DifyInputField {
  variable: string
  label: string
  type: 'text-input' | 'paragraph' | 'select' | 'radio' | 'file' | 'file-list' | 'text-area'
  required: boolean
  default?: string
  options?: string[]
  description?: string
}

export interface DifyRunRequest {
  profileId: string
  runId?: string
  inputs: Record<string, unknown>
  query?: string
  conversationId?: string
  user?: string
}

export interface DifyRunResult {
  runId: string
  status: 'succeeded' | 'failed' | 'stopped'
  output: string
  outputs?: Record<string, unknown>
  conversationId?: string
  error?: string
}

export interface DifyRunEvent {
  runId: string
  event: string
  data: Record<string, unknown>
}

export interface DifyHistoryEntry {
  id: string
  profileId: string
  profileName: string
  createdAt: string
  status: DifyRunResult['status']
  output: string
  error?: string
}
