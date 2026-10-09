import type { Socket } from 'node:net'

export const DESKTOP_ASSISTANT_MAX_MESSAGE_BYTES = 256 * 1024
export const DESKTOP_ASSISTANT_HANDSHAKE_TIMEOUT_MS = 10_000

export function formatDesktopAssistantExecutionMode(profileName?: string) {
  if (profileName) return `Dify Workflow：${profileName}`
  return 'Chat：跟随主对话模型'
}

export function parseDesktopAssistantMessage(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function attachDesktopAssistantProtocol(
  socket: Pick<Socket, 'setEncoding' | 'on' | 'destroy'>,
  controlToken: string,
  onAuthenticated: () => void,
  onMessage: (message: Record<string, unknown>) => void
) {
  let authenticated = false
  let buffer = ''
  const handshakeTimeout = setTimeout(() => {
    if (!authenticated) socket.destroy()
  }, DESKTOP_ASSISTANT_HANDSHAKE_TIMEOUT_MS)
  handshakeTimeout.unref()

  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n')
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (Buffer.byteLength(line, 'utf8') > DESKTOP_ASSISTANT_MAX_MESSAGE_BYTES) {
        socket.destroy()
        return
      }
      const message = parseDesktopAssistantMessage(line)
      if (!message) {
        socket.destroy()
        return
      }
      if (!authenticated) {
        if (message.type !== 'hello' || message.token !== controlToken || message.protocol !== 1) {
          socket.destroy()
          return
        }
        authenticated = true
        clearTimeout(handshakeTimeout)
        onAuthenticated()
      } else if (message.type === 'event') {
        onMessage(message)
      }
    }
    if (Buffer.byteLength(buffer, 'utf8') > DESKTOP_ASSISTANT_MAX_MESSAGE_BYTES) {
      socket.destroy()
    }
  })
  socket.on('close', () => clearTimeout(handshakeTimeout))
}
