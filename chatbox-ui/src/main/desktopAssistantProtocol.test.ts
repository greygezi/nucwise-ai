import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attachDesktopAssistantProtocol,
  DESKTOP_ASSISTANT_MAX_MESSAGE_BYTES,
  formatDesktopAssistantExecutionMode,
} from './desktopAssistantProtocol'

afterEach(() => vi.useRealTimers())
function connection() {
  const socket = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), destroy: vi.fn() })
  const authenticated = vi.fn()
  const event = vi.fn()
  attachDesktopAssistantProtocol(socket as unknown as Socket, 'test-token', authenticated, event)
  return { socket, authenticated, event }
}
it('consumes hello and event in one chunk and clears the handshake timeout', () => {
  vi.useFakeTimers()
  const { socket, authenticated, event } = connection()
  socket.emit('data', '{"type":"hello","token":"test-token","protocol":1}\n{"type":"event","event":"test"}\n')
  expect(authenticated).toHaveBeenCalledOnce()
  expect(event).toHaveBeenCalledWith({ type: 'event', event: 'test' })
  vi.advanceTimersByTime(10001)
  expect(socket.destroy).not.toHaveBeenCalled()
  socket.emit('close')
})
it('rejects malformed, non-object, unauthorized and oversized messages', () => {
  for (const payload of [
    'null\n',
    '[]\n',
    '{\n',
    '{"type":"hello","token":"wrong","protocol":1}\n',
    'x'.repeat(DESKTOP_ASSISTANT_MAX_MESSAGE_BYTES + 1),
  ]) {
    const { socket, authenticated } = connection()
    socket.emit('data', payload)
    expect(socket.destroy).toHaveBeenCalledOnce()
    expect(authenticated).not.toHaveBeenCalled()
    socket.emit('close')
  }
})
it('expires an unauthenticated connection', () => {
  vi.useFakeTimers()
  const { socket } = connection()
  vi.advanceTimersByTime(10001)
  expect(socket.destroy).toHaveBeenCalledOnce()
  socket.emit('close')
})

it('distinguishes the shared Chat model and Dify execution', () => {
  expect(formatDesktopAssistantExecutionMode()).toBe('Chat：跟随主对话模型')
  expect(formatDesktopAssistantExecutionMode('文档工作流')).toBe('Dify Workflow：文档工作流')
})
