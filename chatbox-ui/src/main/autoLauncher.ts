import AutoLaunch from 'auto-launch'
import path from 'node:path'
import { getSettings } from './store-node'

// 开机自启动
let _autoLaunch: AutoLaunch | null = null

export function get() {
  if (!_autoLaunch) {
    const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE
    _autoLaunch = new AutoLaunch({
      name: 'NucWise AI',
      ...(portableExecutable && path.isAbsolute(portableExecutable) ? { path: portableExecutable } : {}),
    })
  }
  return _autoLaunch
}

export async function sync() {
  await ensure(!!getSettings().autoLaunch)
}

export async function ensure(enable: boolean) {
  const autoLaunch = get()
  if (enable) {
    // Refresh the registered path when the portable EXE has moved.
    await autoLaunch.enable()
  } else if (await autoLaunch.isEnabled()) {
    await autoLaunch.disable()
  }
}
