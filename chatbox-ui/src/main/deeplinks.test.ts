import { beforeEach, describe, expect, it, vi } from 'vitest'

const logState = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))

vi.mock('electron-log/main', () => ({ default: logState }))

import { handleDeepLink } from './deeplinks'

function createWindow() {
  return { webContents: { send: vi.fn() } }
}

describe('deep links', () => {
  beforeEach(() => {
    logState.info.mockClear()
    logState.warn.mockClear()
  })

  it('does not log deep-link query values while preserving compose text', () => {
    const mainWindow = createWindow()
    const secretText = 'fake-private-selection-and-key'

    handleDeepLink(mainWindow as never, `desktopassistant://assistant/compose?text=${encodeURIComponent(secretText)}`)

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-assistant-compose', secretText)
    expect(JSON.stringify(logState.info.mock.calls)).not.toContain(secretText)
  })

  it('ignores malformed and unsupported deep links', () => {
    const mainWindow = createWindow()

    expect(() => handleDeepLink(mainWindow as never, 'not a URL')).not.toThrow()
    expect(() => handleDeepLink(mainWindow as never, 'https://example.com/secret')).not.toThrow()
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    expect(logState.warn).toHaveBeenCalledTimes(2)
  })
})
