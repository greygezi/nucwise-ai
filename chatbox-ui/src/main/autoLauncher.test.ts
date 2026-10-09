import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const autoLaunchState = vi.hoisted(() => ({ instances: [] as Array<Record<string, unknown>>, enable: vi.fn() }))

vi.mock('auto-launch', () => ({
  default: class MockAutoLaunch {
    constructor(options: Record<string, unknown>) {
      autoLaunchState.instances.push(options)
    }

    async isEnabled() {
      return false
    }

    async enable() {
      autoLaunchState.enable()
    }

    async disable() {}
  },
}))

vi.mock('./store-node', () => ({
  getSettings: () => ({ autoLaunch: false }),
}))

describe('auto-launch executable selection', () => {
  const originalPortableExecutable = process.env.PORTABLE_EXECUTABLE_FILE

  beforeEach(() => {
    autoLaunchState.instances.length = 0
    vi.resetModules()
  })

  afterEach(() => {
    if (originalPortableExecutable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
    else process.env.PORTABLE_EXECUTABLE_FILE = originalPortableExecutable
  })

  it('uses the portable outer executable when provided', async () => {
    const portableExecutable = path.resolve('NucWise AI-Portable.exe')
    process.env.PORTABLE_EXECUTABLE_FILE = portableExecutable

    const { get } = await import('./autoLauncher')
    get()

    expect(autoLaunchState.instances).toEqual([{ name: 'NucWise AI', path: portableExecutable }])
  })

  it('keeps auto-launch default path selection for ordinary runs', async () => {
    delete process.env.PORTABLE_EXECUTABLE_FILE

    const { get } = await import('./autoLauncher')
    get()

    expect(autoLaunchState.instances).toEqual([{ name: 'NucWise AI' }])
  })
})

it('refreshes the enabled registration on an explicit enable request', async () => {
  const { ensure } = await import('./autoLauncher')
  await ensure(true)
  expect(autoLaunchState.enable).toHaveBeenCalled()
})
