import type { DesktopAssistantComposePayload, DesktopAssistantRequest } from '@shared/electron-types'
import type { ModelMessage } from 'ai'

export interface DesktopAssistantComposeEvent {
  text: string
  payload?: DesktopAssistantComposePayload
}

type DesktopAssistantComposeListener = (event: DesktopAssistantComposeEvent) => void

export type DesktopAssistantStreamTimeoutPhase = 'first-response' | 'idle'

export class DesktopAssistantStreamTimeoutError extends Error {
  constructor(readonly phase: DesktopAssistantStreamTimeoutPhase) {
    super(phase === 'first-response' ? '主对话模型未及时开始响应。' : '主对话模型响应长时间没有进展。')
    this.name = 'DesktopAssistantStreamTimeoutError'
  }
}

export function nextDesktopAssistantPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  phase: DesktopAssistantStreamTimeoutPhase,
  controller: AbortController
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DesktopAssistantStreamTimeoutError(phase))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function nextDesktopAssistantStreamPart<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  phase: DesktopAssistantStreamTimeoutPhase,
  controller: AbortController
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new DesktopAssistantStreamTimeoutError(phase))
    }, timeoutMs)
  })
  try {
    return await Promise.race([iterator.next(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut) {
      const cleanup = iterator.return?.()
      if (cleanup) void cleanup.catch(() => undefined)
    }
  }
}

const pendingDesktopAssistantComposes: DesktopAssistantComposeEvent[] = []
const desktopAssistantComposeListeners = new Set<DesktopAssistantComposeListener>()

export function enqueueDesktopAssistantCompose(
  text: string,
  payload?: DesktopAssistantComposePayload,
  deferUntilNextSubscriber = false
) {
  const event = { text, payload }
  const listener = Array.from(desktopAssistantComposeListeners).at(-1)
  if (deferUntilNextSubscriber || !listener) {
    pendingDesktopAssistantComposes.push(event)
    return false
  }
  listener(event)
  return true
}

export function subscribeDesktopAssistantCompose(listener: DesktopAssistantComposeListener) {
  desktopAssistantComposeListeners.add(listener)
  if (pendingDesktopAssistantComposes.length > 0) {
    const pending = pendingDesktopAssistantComposes.splice(0)
    pending.forEach(listener)
  }
  return () => {
    desktopAssistantComposeListeners.delete(listener)
  }
}

export function buildDesktopAssistantMessages(
  request: DesktopAssistantRequest,
  defaultPrompt?: string
): ModelMessage[] {
  const messages: ModelMessage[] = request.messages
    .filter((message) => message.content.trim())
    .map((message) => ({ role: message.role, content: message.content }))
  if (messages.length > 0) return messages

  const action = String(request.action.user_request || request.action.label || '').trim()
  const followupText = request.followupText.trim()
  const history: ModelMessage[] = request.conversation.flatMap((turn, index) => {
    const role = turn.role
    const content = typeof turn.content === 'string' ? turn.content.trim() : ''
    if (index === request.conversation.length - 1 && role === 'user' && content === followupText) return []
    return (role === 'user' || role === 'assistant') && content ? [{ role: role as 'user' | 'assistant', content }] : []
  })
  const userText = [action, request.text.trim()].filter(Boolean).join('\n\n')
  return [
    { role: 'system', content: defaultPrompt || 'You are a helpful assistant.' },
    { role: 'user', content: userText },
    ...history,
    ...(followupText ? [{ role: 'user' as const, content: followupText }] : []),
  ] as ModelMessage[]
}

export function adaptDesktopAssistantMessages(messages: ModelMessage[], supportsSystemMessages: boolean) {
  return supportsSystemMessages
    ? messages
    : messages.map((message) => (message.role === 'system' ? { ...message, role: 'user' as const } : message))
}

export function buildDesktopAssistantSessionTitle(request: DesktopAssistantRequest) {
  const action = String(request.action.label || request.action.user_request || '划词助手').trim()
  const preview = request.text.replace(/\s+/g, ' ').trim().slice(0, 24)
  return [action || '划词助手', preview].filter(Boolean).join(' · ').slice(0, 50)
}

export function buildDesktopAssistantSessionTurns(
  request: DesktopAssistantRequest,
  result: string,
  includeHistory = false
) {
  const action = String(request.action.label || request.action.user_request || '').trim()
  const source = request.text.trim()
  const initialUserText = [action ? `操作：${action}` : '', source ? `原文：\n${source}` : '']
    .filter(Boolean)
    .join('\n\n')
  const followup = request.followupText.trim()
  if (!includeHistory || !followup) {
    return [
      { role: 'user' as const, content: followup || initialUserText },
      { role: 'assistant' as const, content: result },
    ]
  }

  const history = request.conversation.flatMap((turn) => {
    const role = turn.role
    const content = typeof turn.content === 'string' ? turn.content.trim() : ''
    return !turn.initial_action && (role === 'user' || role === 'assistant') && content
      ? [{ role, content } as const]
      : []
  })
  if (history.at(-1)?.role !== 'user' || history.at(-1)?.content !== followup) {
    history.push({ role: 'user', content: followup })
  }
  return [
    { role: 'user' as const, content: initialUserText },
    ...history,
    { role: 'assistant' as const, content: result },
  ]
}
