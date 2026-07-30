import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getSettings } from './store-node'
import { getLogger } from './util'

const log = getLogger('app-updater')

function sendToRenderer(win: BrowserWindow | null, channel: string, data?: unknown) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export class AppUpdater {
  private getWindow: () => BrowserWindow | null
  private isChecking = false
  private suppressError = false

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow

    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      sendToRenderer(this.getWindow(), 'updater:checking')
    })

    autoUpdater.on('update-available', (info) => {
      sendToRenderer(this.getWindow(), 'updater:available', { version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      sendToRenderer(this.getWindow(), 'updater:not-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      sendToRenderer(this.getWindow(), 'updater:progress', {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer(this.getWindow(), 'updater:downloaded', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      log.error('auto_updater error:', err)
      // Suppress error events during feed URL fallback to avoid false error flashes
      if (!this.suppressError) {
        sendToRenderer(this.getWindow(), 'updater:error', { message: err?.message || 'Unknown error' })
      }
    })

    // Guard against double-registration (defensive — AppUpdater is singleton)
    ipcMain.removeHandler('updater:check')
    ipcMain.handle('updater:check', async () => {
      if (this.isChecking) return { started: false }
      try {
        const result = await this.tryUpdate()
        // electron-updater returns null without firing events in dev mode or when all URLs fail
        if (!result) sendToRenderer(this.getWindow(), 'updater:not-available')
      } catch (e) {
        log.error('auto_updater: check failed', e)
        sendToRenderer(this.getWindow(), 'updater:error', {
          message: e instanceof Error ? e.message : 'Unknown error',
        })
      }
      return { started: true }
    })

    ipcMain.removeHandler('install-update')
    ipcMain.handle('install-update', () => {
      autoUpdater.quitAndInstall()
    })

    const settings = getSettings()
    if (settings.autoUpdate) {
      setTimeout(() => this.tryUpdate().catch((e) => log.error('auto_updater: startup check failed', e)), 5_000)
      setInterval(
        () => this.tryUpdate().catch((e) => log.error('auto_updater: scheduled check failed', e)),
        1000 * 60 * 60
      )
      log.info('Update timer started, checking every hour')
    }
  }

  async tryUpdate() {
    // NucWise AI 便携离线发行版没有受控、签名的更新源；禁止回落到上游 Chatbox 服务。
    log.info('auto_updater: disabled for the portable NucWise AI distribution')
    return null
  }
}
