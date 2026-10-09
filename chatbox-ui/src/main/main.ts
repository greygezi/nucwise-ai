// solve electron breaking changes, see https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-directory-databases-in-userdata-will-be-deleted
// since 1.21.0, and this NEEDS to be imported before any other module, specifically before `app` inited.
import './legacy-database-migration'

/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net, { type Server, type Socket } from 'node:net'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, session, shell, Tray } from 'electron'
import electronDebug from 'electron-debug'
import log from 'electron-log/main'
import os from 'os'
import path from 'path'
// @ts-expect-error - source-map-support doesn't have type definitions
import * as sourceMapSupport from 'source-map-support'
import type {
  DesktopAssistantChunkEvent,
  DesktopAssistantProgressEvent,
  DesktopAssistantRequest,
  DesktopAssistantResultEvent,
} from 'src/shared/electron-types'
import {
  DESKTOP_ASSISTANT_ACTIVE_IDLE_TIMEOUT_MS,
  DESKTOP_ASSISTANT_RENDERER_ACK_TIMEOUT_MS,
} from 'src/shared/electron-types'
import type { ShortcutSetting } from 'src/shared/types'
import * as autoLauncher from './autoLauncher'
import { handleDeepLink } from './deeplinks'
import { buildDesktopAssistantComposeText } from './desktopAssistantCompose'
import { DesktopAssistantRequestLifecycle, isDesktopAssistantRendererReload } from './desktopAssistantLifecycle'
import { attachDesktopAssistantProtocol, formatDesktopAssistantExecutionMode } from './desktopAssistantProtocol'
import { registerDifyHandlers } from './dify/ipc-handlers'
import {
  cancel as cancelDify,
  getAssistantProfileId,
  listProfiles as listDifyProfiles,
  migrateLegacyKnowledgeProfile,
  run as runDify,
} from './dify/service'
import { isAllowedExternalUrl, isSameDocumentNavigation } from './externalLinks'
import { parseFile } from './file-parser'
import Locale from './locales'
import * as mcpIpc from './mcp/ipc-stdio-transport'
import MenuBuilder from './menu'
import { registerOAuthHandlers } from './oauth'
import * as proxy from './proxy'
import { registerSandboxHandlers } from './sandbox'
import { registerSkillsHandlers } from './skills'
import {
  delStoreBlob,
  getConfig,
  getSettings,
  getStoreBlob,
  listStoreBlobKeys,
  setStoreBlob,
  store,
} from './store-node'
import * as windowState from './window_state'

const knowledgeBaseInitPromise = import('./knowledge-base/index.js')
  .then((mod) => mod.getInitPromise())
  .catch((error) => {
    log.error('[KB] Failed to initialize knowledge base during bootstrap:', error)
  })

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function initializeSessionAttachmentRagAfterAppReady() {
  return import('./session-attachment-rag/index.js')
    .then((mod) => mod.getInitPromise())
    .catch((error) => {
      log.error('[SessionAttachmentRAG] Failed to initialize during bootstrap:', error)
    })
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
}

function detectContainerEnvironment(): boolean {
  if (process.env.CONTAINER === 'docker' || !!process.env.KUBERNETES_SERVICE_HOST) {
    return true
  }
  if (fs.existsSync('/.dockerenv')) {
    return true
  }
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8')
    return /docker|containerd|kubepods|podman|lxc/i.test(cgroup)
  } catch {
    return false
  }
}

type LinuxRuntimeFlags = {
  disableGpu: boolean
  disableDevShmUsage: boolean
}

function getLinuxRuntimeFlags(): LinuxRuntimeFlags {
  const forceGpu = isTruthyEnv(process.env.CHATBOX_FORCE_GPU)
  const forceDisableGpu = isTruthyEnv(process.env.CHATBOX_DISABLE_GPU)
  const isCI = isTruthyEnv(process.env.CI)
  const isContainer = detectContainerEnvironment()
  const hasDisplayServer = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY

  return {
    disableGpu: forceGpu ? false : forceDisableGpu || isCI || isContainer || !hasDisplayServer,
    disableDevShmUsage: isCI || isContainer,
  }
}

// Linux startup compatibility flags:
// - Disable GPU only in constrained environments (CI/container/headless) or when explicitly requested.
// - Keep GPU enabled on normal Linux desktops for better rendering performance.
// - Use /tmp instead of /dev/shm only in CI/container environments.
// Must run before app.whenReady().
if (process.platform === 'linux') {
  const linuxRuntimeFlags = getLinuxRuntimeFlags()
  if (linuxRuntimeFlags.disableGpu) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu')
  }
  if (linuxRuntimeFlags.disableDevShmUsage) {
    app.commandLine.appendSwitch('disable-dev-shm-usage')
  }
  const { disableGpu, disableDevShmUsage } = linuxRuntimeFlags
  log.info(`[Linux startup flags] disableGpu=${disableGpu}, disableDevShmUsage=${disableDevShmUsage}`)
}

app.setName('NucWise AI')

// 这行代码是解决 Windows 通知的标题和图标不正确的问题，确保使用产品品牌名。
// 参考：https://stackoverflow.com/questions/65859634/notification-from-electron-shows-electron-app-electron
if (process.platform === 'win32') {
  app.setAppUserModelId(app.name)
}

const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '../../assets')

const getAssetPath = (...paths: string[]): string => {
  return path.join(RESOURCES_PATH, ...paths)
}

// 开发环境使用独立协议，避免和正式版冲突
const PROTOCOL_SCHEME = process.defaultApp ? 'desktopassistant-dev' : 'desktopassistant'

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)
}

log.info(`📱 URL Scheme registered: ${PROTOCOL_SCHEME}://`)

// --------- 全局变量 ---------

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let hasShownTrayHint = false
let desktopAssistantProcess: ChildProcess | null = null
let desktopAssistantServer: Server | null = null
let desktopAssistantSocket: Socket | null = null
let desktopAssistantStopping = false
let desktopAssistantRequestId = 0
const desktopAssistantRequests = new Set<string>()
const desktopAssistantDifyRequests = new Set<string>()
const desktopAssistantPendingRequests = new Map<string, DesktopAssistantRequest>()
let desktopAssistantRendererReady = false

function describeDesktopAssistantRequest(requestId: string, detail: string) {
  // Request IDs and lengths are safe diagnostics; never log selected text,
  // prompts, provider credentials, or model output here.
  log.info(`[NucWise AI] DesktopAssistant request=${requestId} ${detail}`)
}

function failDesktopAssistantRequest(requestId: string, error: string, phase: string) {
  const wasActive = desktopAssistantRequests.delete(requestId)
  desktopAssistantPendingRequests.delete(requestId)
  if (!wasActive) {
    describeDesktopAssistantRequest(requestId, `late-timeout-ignored phase=${phase}`)
    return
  }
  if (desktopAssistantDifyRequests.has(requestId)) {
    cancelDify(requestId)
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    // Stop a renderer that ACKed late or is still streaming after the main
    // watchdog has already reported a visible failure to the floating window.
    mainWindow.webContents.send('desktop-assistant:cancel', { requestId })
    describeDesktopAssistantRequest(requestId, 'timeout-cancel-forwarded-to-renderer')
  }
  describeDesktopAssistantRequest(requestId, `timeout phase=${phase}`)
  sendDesktopAssistantMessage({ command: 'actionResult', requestId, ok: false, error })
}

const desktopAssistantRequestLifecycle = new DesktopAssistantRequestLifecycle<DesktopAssistantRequest>(
  DESKTOP_ASSISTANT_RENDERER_ACK_TIMEOUT_MS,
  ({ requestId, phase }) => {
    const error =
      phase === 'active'
        ? '助手执行长时间没有进展，请检查主对话模型或稍后重试。'
        : '主程序界面未及时接收助手请求，请稍后重试。'
    failDesktopAssistantRequest(requestId, error, phase)
  },
  DESKTOP_ASSISTANT_ACTIVE_IDLE_TIMEOUT_MS
)

function sendDesktopAssistantCommand(command: string, params?: Record<string, unknown>) {
  if (!desktopAssistantSocket || desktopAssistantSocket.destroyed) {
    log.warn(`[NucWise AI] Cannot send ${command}: sidecar is not connected`)
    return false
  }
  desktopAssistantRequestId += 1
  desktopAssistantSocket.write(`${JSON.stringify({ id: String(desktopAssistantRequestId), command, params })}\n`)
  return true
}

function sendDesktopAssistantMessage(message: Record<string, unknown>) {
  if (!desktopAssistantSocket || desktopAssistantSocket.destroyed) return false
  desktopAssistantSocket.write(`${JSON.stringify(message)}\n`)
  return true
}

function syncDesktopAssistantExecutionMode() {
  const profileId = getAssistantProfileId()
  const profileName = profileId ? listDifyProfiles().find((profile) => profile.id === profileId)?.name : undefined
  sendDesktopAssistantMessage({
    command: 'executionMode',
    mode: profileId ? 'dify' : 'chat',
    label: formatDesktopAssistantExecutionMode(profileName),
  })
}

function syncDesktopAssistantHotkey(hotkey = getSettings().shortcuts.selectionAssistant) {
  sendDesktopAssistantCommand('updateHotkey', { hotkey: hotkey || 'Ctrl+Alt+Space' })
}

function sendDesktopAssistantRequest(request: DesktopAssistantRequest) {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const tracked = desktopAssistantRequestLifecycle.has(request.requestId)
    ? desktopAssistantRequestLifecycle.update(request.requestId, request)
    : desktopAssistantRequestLifecycle.track(request.requestId, request)
  if (!tracked) return false
  desktopAssistantPendingRequests.set(request.requestId, request)
  describeDesktopAssistantRequest(
    request.requestId,
    `queued rendererReady=${desktopAssistantRendererReady} completedResult=${request.completedResult !== undefined}`
  )
  flushDesktopAssistantRequests()
  return true
}

function flushDesktopAssistantRequests() {
  if (!desktopAssistantRendererReady || !mainWindow || mainWindow.isDestroyed()) return
  for (const [requestId, request] of desktopAssistantPendingRequests) {
    if (desktopAssistantPendingRequests.get(requestId) !== request) continue
    desktopAssistantPendingRequests.delete(requestId)
    if (!desktopAssistantRequestLifecycle.markSent(requestId)) continue
    describeDesktopAssistantRequest(requestId, 'sent-awaiting-renderer-ack')
    mainWindow.webContents.send('desktop-assistant:request', request)
  }
}

function isMainRendererSender(event: Electron.IpcMainEvent) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id
}

function markDesktopAssistantRendererReady(event: Electron.IpcMainEvent) {
  if (!isMainRendererSender(event)) return
  desktopAssistantRendererReady = true
  log.info('[NucWise AI] DesktopAssistant renderer ready')
  flushDesktopAssistantRequests()
}

function markDesktopAssistantRendererStarted(event: Electron.IpcMainEvent, requestId: unknown) {
  if (!isMainRendererSender(event)) return
  const normalizedRequestId = String(requestId || '')
  if (!normalizedRequestId || !desktopAssistantRequests.has(normalizedRequestId)) return
  if (desktopAssistantRequestLifecycle.markActive(normalizedRequestId)) {
    describeDesktopAssistantRequest(normalizedRequestId, 'renderer-ack-active')
  }
}

function forwardDesktopAssistantCancel(requestId: string) {
  if (!requestId || !desktopAssistantRequests.has(requestId)) return
  if (desktopAssistantDifyRequests.has(requestId)) {
    cancelDify(requestId)
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (desktopAssistantPendingRequests.delete(requestId)) {
    desktopAssistantRequestLifecycle.complete(requestId)
    desktopAssistantRequests.delete(requestId)
    describeDesktopAssistantRequest(requestId, 'cancelled-before-renderer-ack')
    sendDesktopAssistantMessage({ command: 'actionResult', requestId, ok: false, error: '已取消' })
    return
  }
  describeDesktopAssistantRequest(requestId, 'cancel-forwarded-to-renderer')
  mainWindow.webContents.send('desktop-assistant:cancel', { requestId })
}

function forwardDesktopAssistantProgress(event: Electron.IpcMainEvent, payload: unknown) {
  if (!isMainRendererSender(event) || !payload || typeof payload !== 'object') return
  const data = payload as Partial<DesktopAssistantProgressEvent>
  const requestId = String(data.requestId || '')
  if (
    !requestId ||
    !desktopAssistantRequests.has(requestId) ||
    desktopAssistantDifyRequests.has(requestId) ||
    typeof data.message !== 'string'
  )
  {
    if (requestId && !desktopAssistantRequests.has(requestId)) {
      describeDesktopAssistantRequest(requestId, 'late-progress-ignored')
    }
    return
  }
  const activated = desktopAssistantRequestLifecycle.markActive(requestId)
  if (!activated) desktopAssistantRequestLifecycle.touch(requestId)
  if (activated) describeDesktopAssistantRequest(requestId, `progress-active messageLength=${data.message.length}`)
  sendDesktopAssistantMessage({ command: 'actionProgress', requestId, message: data.message })
}

function forwardDesktopAssistantChunk(event: Electron.IpcMainEvent, payload: unknown) {
  if (!isMainRendererSender(event) || !payload || typeof payload !== 'object') return
  const data = payload as Partial<DesktopAssistantChunkEvent>
  const requestId = String(data.requestId || '')
  if (
    !requestId ||
    !desktopAssistantRequests.has(requestId) ||
    desktopAssistantDifyRequests.has(requestId) ||
    typeof data.text !== 'string' ||
    !data.text
  )
  {
    if (requestId && !desktopAssistantRequests.has(requestId)) {
      describeDesktopAssistantRequest(requestId, 'late-chunk-ignored')
    }
    return
  }
  const activated = desktopAssistantRequestLifecycle.markActive(requestId)
  if (!activated) desktopAssistantRequestLifecycle.touch(requestId)
  if (activated) describeDesktopAssistantRequest(requestId, `chunk-active textLength=${data.text.length}`)
  sendDesktopAssistantMessage({ command: 'actionChunk', requestId, text: data.text })
}

function forwardDesktopAssistantResult(event: Electron.IpcMainEvent, payload: unknown) {
  if (!isMainRendererSender(event) || !payload || typeof payload !== 'object') return
  const data = payload as Partial<DesktopAssistantResultEvent>
  const requestId = String(data.requestId || '')
  if (
    !requestId ||
    !desktopAssistantRequests.has(requestId) ||
    desktopAssistantDifyRequests.has(requestId) ||
    typeof data.ok !== 'boolean'
  )
  {
    if (requestId && !desktopAssistantRequests.has(requestId)) {
      describeDesktopAssistantRequest(requestId, 'late-result-ignored')
    }
    return
  }
  desktopAssistantRequestLifecycle.complete(requestId)
  desktopAssistantPendingRequests.delete(requestId)
  desktopAssistantRequests.delete(requestId)
  describeDesktopAssistantRequest(
    requestId,
    `result ok=${data.ok} resultLength=${typeof data.result === 'string' ? data.result.length : 0} error=${typeof data.error === 'string'}`
  )
  sendDesktopAssistantMessage({
    command: 'actionResult',
    requestId,
    ok: data.ok,
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
    result: typeof data.result === 'string' ? data.result : '',
    error: typeof data.error === 'string' ? data.error : undefined,
  })
}

async function openExternalLink(link: unknown) {
  if (!isAllowedExternalUrl(link)) {
    log.warn('[NucWise AI] Blocked unsupported external link')
    return
  }
  try {
    await shell.openExternal(link)
  } catch (error) {
    log.warn('[NucWise AI] Failed to open external link:', error)
  }
}

async function handleDesktopAssistantEvent(message: Record<string, unknown>) {
  if (!mainWindow) return
  if (message.event === 'ready' || message.event === 'selectionCaptured') {
    syncDesktopAssistantExecutionMode()
    return
  }
  if (message.event === 'cancelAction') {
    const payload =
      message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
    forwardDesktopAssistantCancel(String(message.requestId || payload.requestId || ''))
    return
  }
  if (message.event === 'continueInChat') {
    const payload =
      message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
    const text = buildDesktopAssistantComposeText(payload)
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!text && !sessionId) return
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('desktop-assistant-compose', text, payload)
    return
  }
  if (message.event !== 'runAction') return
  const requestId = String(message.requestId || '')
  const action = (message.action || {}) as Record<string, unknown>
  const sessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() || undefined : undefined
  const followupText = String(message.followupText || '').trim()
  const conversation = Array.isArray(message.conversation) ? message.conversation : []
  if (!requestId || desktopAssistantRequests.has(requestId)) {
    sendDesktopAssistantMessage({ command: 'actionResult', requestId, ok: false, error: '无效或重复的助手请求。' })
    return
  }
  desktopAssistantRequests.add(requestId)
  describeDesktopAssistantRequest(requestId, 'received-runAction')
  const messages = Array.isArray(message.messages)
    ? message.messages.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const value = item as Record<string, unknown>
        const role = value.role
        const content = value.content
        if (!['system', 'user', 'assistant'].includes(String(role)) || typeof content !== 'string') return []
        return [{ role: role as 'system' | 'user' | 'assistant', content }]
      })
    : []
  const desktopRequest: DesktopAssistantRequest = {
    requestId,
    sessionId,
    text: String(message.text || ''),
    action,
    conversation: conversation.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object'),
    followupText,
    messages,
  }
  const profileId = getAssistantProfileId()
  if (!profileId) {
    if (!desktopAssistantRequestLifecycle.track(requestId, desktopRequest)) {
      desktopAssistantRequests.delete(requestId)
      sendDesktopAssistantMessage({ command: 'actionResult', requestId, ok: false, error: '助手请求已在处理中。' })
      return
    }
    if (!sendDesktopAssistantRequest(desktopRequest)) {
      desktopAssistantRequestLifecycle.complete(requestId)
      desktopAssistantRequests.delete(requestId)
      sendDesktopAssistantMessage({
        command: 'actionResult',
        requestId,
        ok: false,
        error: '主程序界面尚未准备好，请稍后重试。',
      })
    }
    return
  }
  // Dify runs in the main process and has its own run/cancel lifecycle. Do
  // not place it under the renderer ACK watchdog; only the eventual Chat
  // persistence request is tracked below when a renderer is actually needed.
  desktopAssistantDifyRequests.add(requestId)
  sendDesktopAssistantMessage({ command: 'actionProgress', requestId, message: '正在通过统一 Dify 服务执行…' })
  let userRequest = String(action.user_request || action.label || '')
  if (followupText) {
    const transcript = conversation
      .slice(-8)
      .map((turn) => {
        if (!turn || typeof turn !== 'object') return ''
        const item = turn as Record<string, unknown>
        if (item.initial_action) return ''
        const content = String(item.content || '').trim()
        if (!content) return ''
        return `${item.role === 'assistant' ? '助手' : '用户'}：${content}`
      })
      .filter(Boolean)
      .join('\n\n')
      .slice(-12000)
    userRequest = [
      `原始操作：${userRequest}`,
      `原始选中文本：\n${String(message.text || '')}`,
      `已有对话：\n${transcript || '（无）'}`,
      `用户追问：${followupText}`,
      '请基于原始文本和已有对话直接回答这次追问；不要重复输出工作流提示词或说明。',
    ].join('\n\n')
  }
  const inputs: Record<string, unknown> = {
    Input_Text: String(message.text || ''),
    user_request: userRequest,
  }
  if (action.how_polish) inputs.how_polish = String(action.how_polish)
  let persistenceQueued = false
  try {
    const result = await runDify({ profileId, inputs, runId: requestId }, mainWindow.webContents)
    if (result.status === 'succeeded' && result.output.trim()) {
      desktopAssistantDifyRequests.delete(requestId)
      persistenceQueued = sendDesktopAssistantRequest({ ...desktopRequest, completedResult: result.output })
      if (persistenceQueued) return
    }
    sendDesktopAssistantMessage({
      command: 'actionResult',
      requestId,
      ok: false,
      result: result.output,
      error: result.error || '工作流未返回可保存的文本结果。',
    })
  } catch (error) {
    sendDesktopAssistantMessage({
      command: 'actionResult',
      requestId,
      ok: false,
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    desktopAssistantDifyRequests.delete(requestId)
    if (!persistenceQueued) {
      desktopAssistantRequestLifecycle.complete(requestId)
      desktopAssistantRequests.delete(requestId)
    }
  }
}

async function startDesktopAssistant() {
  if (process.platform !== 'win32' || desktopAssistantProcess) {
    return
  }

  const executablePath = app.isPackaged
    ? path.join(process.resourcesPath, 'assistant', 'DesktopAssistantTray.exe')
    : process.env.DESKTOP_ASSISTANT_EXE

  if (!executablePath || !fs.existsSync(executablePath)) {
    if (app.isPackaged) {
      log.error('[NucWise AI] Bundled tray executable is missing:', executablePath)
    }
    return
  }

  const controlToken = randomBytes(32).toString('hex')
  desktopAssistantServer = net.createServer()
  await new Promise<void>((resolve, reject) => {
    desktopAssistantServer?.once('error', reject)
    desktopAssistantServer?.listen(0, '127.0.0.1', () => resolve())
  })
  const address = desktopAssistantServer.address()
  if (!address || typeof address === 'string') {
    desktopAssistantServer.close()
    desktopAssistantServer = null
    throw new Error('Unable to allocate the desktop assistant control port')
  }

  desktopAssistantServer.on('connection', (socket) => {
    attachDesktopAssistantProtocol(
      socket,
      controlToken,
      () => {
        desktopAssistantSocket?.destroy()
        desktopAssistantSocket = socket
        log.info('[NucWise AI] Sidecar control channel ready')
        syncDesktopAssistantExecutionMode()
        syncDesktopAssistantHotkey()
      },
      (message) => {
        void handleDesktopAssistantEvent(message).catch((error) => log.warn('[NucWise AI] Sidecar event failed', error))
      }
    )
    socket.on('close', () => {
      if (desktopAssistantSocket === socket) {
        desktopAssistantSocket = null
        log.info('[NucWise AI] DesktopAssistant sidecar disconnected; clearing request lifecycle')
        desktopAssistantRequestLifecycle.clear()
        desktopAssistantRequests.clear()
        desktopAssistantDifyRequests.clear()
        desktopAssistantPendingRequests.clear()
      }
    })
    socket.on('error', (error) => log.warn('[NucWise AI] Control socket error:', error))
  })

  desktopAssistantStopping = false
  desktopAssistantProcess = spawn(
    executablePath,
    [
      '--hosted',
      '--control-port',
      String(address.port),
      '--control-token',
      controlToken,
      '--host-pid',
      String(process.pid),
    ],
    {
      cwd: path.dirname(executablePath),
      windowsHide: true,
      stdio: 'ignore',
    }
  )
  desktopAssistantProcess.once('error', (error) => {
    log.error('[NucWise AI] Failed to start tray process:', error)
    desktopAssistantProcess = null
  })
  desktopAssistantProcess.once('exit', (code, signal) => {
    log.info(`[NucWise AI] Tray process exited (code=${code}, signal=${signal})`)
    desktopAssistantProcess = null
    desktopAssistantSocket?.destroy()
    desktopAssistantSocket = null
    if (!desktopAssistantStopping) {
      log.warn('[NucWise AI] Sidecar exited unexpectedly')
    }
  })
  log.info('[NucWise AI] Headless sidecar process started')
}

function stopDesktopAssistant() {
  desktopAssistantStopping = true
  desktopAssistantRequestLifecycle.clear()
  desktopAssistantRequests.clear()
  desktopAssistantDifyRequests.clear()
  desktopAssistantPendingRequests.clear()
  sendDesktopAssistantCommand('shutdown')
  if (!desktopAssistantProcess) {
    desktopAssistantServer?.close()
    desktopAssistantServer = null
    return
  }
  const assistantPid = desktopAssistantProcess.pid
  const processToStop = desktopAssistantProcess
  setTimeout(() => {
    if (desktopAssistantProcess !== processToStop) return
    if (process.platform === 'win32' && assistantPid) {
      // PyInstaller one-file apps use a bootloader child; terminate the exact
      // process tree so the tray cannot outlive the Electron host.
      spawn('taskkill.exe', ['/pid', String(assistantPid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } else {
      processToStop.kill()
    }
  }, 1200).unref()
  desktopAssistantServer?.close()
  desktopAssistantServer = null
}

// --------- 快捷键 ---------

/**
 * 将渲染层的 shortcut 转化成 electron 支持的格式
 * react-hotkeys-hook 的快捷键格式参考： https://react-hotkeys-hook.vercel.app/docs/documentation/useHotkeys/basic-usage#modifiers--special-keys
 * Electron 的快捷键格式参考： https://www.electronjs.org/docs/latest/api/accelerator
 */
function normalizeShortcut(shortcut: string) {
  if (!shortcut) {
    return ''
  }
  let keys = shortcut.split('+')
  keys = keys.map((key) => {
    switch (key) {
      case 'mod':
        return 'CommandOrControl'
      case 'option':
        return 'Alt'
      case 'backquote':
        return '`'
      default:
        return key
    }
  })
  return keys.join('+')
}

/**
 * 检查快捷键是否有效
 * @param shortcut 快捷键字符串
 * @returns 是否为有效的快捷键
 */
function isValidShortcut(shortcut: string): boolean {
  if (!shortcut) {
    return false
  }
  const keys = shortcut.split('+')
  // 检查是否至少包含一个非修饰键
  const hasNonModifier = keys.some((key) => {
    const normalizedKey = key.trim().toLowerCase()
    return ![
      'mod',
      'command',
      'cmd',
      'control',
      'ctrl',
      'commandorcontrol',
      'option',
      'alt',
      'shift',
      'super',
    ].includes(normalizedKey)
  })
  return hasNonModifier
}

function registerShortcuts(shortcutSetting?: ShortcutSetting) {
  if (!shortcutSetting) {
    shortcutSetting = getSettings().shortcuts
  }
  if (!shortcutSetting) {
    return
  }
  try {
    const quickToggle = normalizeShortcut(shortcutSetting.quickToggle)
    if (isValidShortcut(quickToggle)) {
      globalShortcut.register(quickToggle, () => showOrHideWindow())
    }
  } catch (error) {
    log.error('Failed to register shortcut [windowQuickToggle]:', error)
  }
}

function unregisterShortcuts() {
  return globalShortcut.unregisterAll()
}

// --------- Tray 图标 ---------

function createTray() {
  const locale = new Locale()
  let iconPath = getAssetPath('nucwise-nid-icon-imagen-v1-transparent.png')
  if (process.platform === 'darwin') {
    // 生成 iconTemplate.png 的命令
    // gm convert -background none ./iconTemplateRawPreview.png -resize 130% -gravity center -extent 512x512 iconTemplateRaw.png
    // gm convert ./iconTemplateRaw.png -colorspace gray -negate -threshold 50% -resize 16x16 -units PixelsPerInch -density 72 iconTemplate.png
    // gm convert ./iconTemplateRaw.png -colorspace gray -negate -threshold 50% -resize 64x64 -units PixelsPerInch -density 144 iconTemplate@2x.png
    iconPath = getAssetPath('iconTemplate.png')
  } else if (process.platform === 'win32') {
    iconPath = getAssetPath('nucwise-nid-icon-imagen-v1-transparent.ico')
  }
  tray = new Tray(iconPath)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主对话',
      click: showOrHideWindow,
      accelerator: getSettings().shortcuts.quickToggle,
    },
    {
      label: '显示划词助手',
      click: () => {
        syncDesktopAssistantExecutionMode()
        sendDesktopAssistantCommand('showAssistant')
      },
    },
    {
      label: '捕获当前选区',
      click: () => sendDesktopAssistantCommand('captureSelection'),
    },
    {
      label: 'Dify 工作流…',
      click: () => {
        if (!mainWindow) return
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('navigate-to', '/settings/workflows')
      },
    },
    { type: 'separator' },
    {
      label: locale.t('Exit'),
      click: () => app.quit(),
      accelerator: 'Command+Q',
    },
  ])
  tray.setToolTip('NucWise AI')
  tray.setContextMenu(contextMenu)
  tray.on('double-click', showOrHideWindow)
  return tray
}

function ensureTray() {
  if (tray) {
    log.info('tray: already exists')
    return tray
  }
  try {
    createTray()
    log.info('tray: created')
  } catch (e) {
    log.error('tray: failed to create', e)
  }
}

function destroyTray() {
  if (!tray) {
    log.info('tray: skip destroy because it does not exist')
    return
  }
  try {
    tray.destroy()
    tray = null
    log.info('tray: destroyed')
  } catch (e) {
    log.error('tray: failed to destroy', e)
  }
}

// --------- 开发模式 ---------

if (process.env.NODE_ENV === 'production') {
  sourceMapSupport.install()
}

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
  electronDebug()
}

// const installExtensions = async () => {
//     const installer = require('electron-devtools-installer')
//     const forceDownload = !!process.env.UPGRADE_EXTENSIONS
//     const extensions = ['REACT_DEVELOPER_TOOLS']

//     return installer
//         .default(
//             extensions.map((name) => installer[name]),
//             forceDownload
//         )
//         .catch(console.log)
// }

// --------- 窗口管理 ---------

async function createWindow() {
  if (isDebug) {
    // 不在安装 DEBUG 浏览器插件。可能不兼容，所以不如直接在网页里debug
    // await installExtensions()
  }

  const [state] = windowState.getState()

  mainWindow = new BrowserWindow({
    show: false,
    // remove the default titlebar
    titleBarStyle: 'hidden',
    // expose window controlls in Windows/Linux
    frame: false,
    trafficLightPosition: { x: 10, y: 16 },
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: windowState.minWidth,
    minHeight: windowState.minHeight,
    icon: getAssetPath('nucwise-nid-icon-imagen-v1-transparent.png'),
    webPreferences: {
      spellcheck: true,
      webSecurity: false, // 其中一个作用是解决跨域问题
      allowRunningInsecureContent: false,
      preload: app.isPackaged
        ? path.join(__dirname, '../preload/index.js')
        : path.join(__dirname, '../../out/preload/index.js'),
    },
  })

  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (!isDesktopAssistantRendererReload(details)) return
    desktopAssistantRendererReady = false
    const requeued = desktopAssistantRequestLifecycle.requeueSent()
    for (const [requestId, request] of requeued) {
      if (!desktopAssistantRequests.has(requestId)) continue
      desktopAssistantPendingRequests.set(requestId, request)
      describeDesktopAssistantRequest(requestId, 'renderer-reload-requeued-before-ack')
    }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSameDocumentNavigation(url, mainWindow?.webContents.getURL() || '')) {
      event.preventDefault()
      void openExternalLink(url)
    }
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isSameDocumentNavigation(url, mainWindow?.webContents.getURL() || '')) event.preventDefault()
  })

  // Load the local URL for development or the local
  // html file for production
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined')
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize()
    } else {
      if (state.mode === windowState.WindowMode.Maximized) {
        mainWindow.maximize()
      }
      if (state.mode === windowState.WindowMode.Fullscreen) {
        mainWindow.setFullScreen(true)
      }
      mainWindow.show()
    }
  })

  // 窗口关闭时保存窗口大小与位置
  mainWindow.on('close', (event) => {
    if (mainWindow) {
      windowState.saveState(mainWindow)
    }
    // 保持托盘助手可用，同时让首次关闭窗口的行为对用户可见。
    if (!isQuitting && mainWindow) {
      event.preventDefault()
      mainWindow.hide()
      if (!hasShownTrayHint && tray) {
        hasShownTrayHint = true
        tray.displayBalloon({
          title: 'NucWise AI 仍在运行',
          content: '程序已最小化到系统托盘。右键托盘图标可退出应用。',
        })
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Send maximized state changes to renderer
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('window:focused')
  })

  const menuBuilder = new MenuBuilder(mainWindow)
  menuBuilder.buildMenu()

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    void openExternalLink(edata.url)
    return { action: 'deny' }
  })

  // 隐藏 Windows, Linux 应用顶部的菜单栏
  // https://www.computerhope.com/jargon/m/menubar.htm
  mainWindow.setMenuBarVisibility(false)

  // 网络问题
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // 'Content-Security-Policy': ['default-src \'self\'']
        // 'Content-Security-Policy': ['*'], // 为了支持代理
      },
    })
  })

  // 监听系统主题更新
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('system-theme-updated')
  })

  return mainWindow
}

async function showOrHideWindow() {
  if (!mainWindow) {
    await createWindow()
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('window-show')
  } else if (mainWindow?.isFocused()) {
    // 解决MacOS全屏下隐藏将黑屏的问题
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
    mainWindow.hide()
    // mainWindow.minimize()
  } else {
    // 解决MacOS下无法聚焦的问题
    mainWindow.hide()
    mainWindow.show()
    mainWindow.focus()
    // 解决MacOS全屏下无法聚焦的问题
    mainWindow.webContents.send('window-show')
  }
}

// --------- 应用管理 ---------

const gotTheLock = app.isPackaged
  ? app.requestSingleInstanceLock({ version: app.getVersion(), executablePath: process.execPath })
  : true

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', async (event, commandLine, workingDirectory, additionalData) => {
    const incoming = additionalData as { version?: unknown; executablePath?: unknown } | undefined
    const incomingVersion = typeof incoming?.version === 'string' ? incoming.version : ''
    if (incomingVersion && incomingVersion !== app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        title: '检测到另一个 NucWise AI 版本',
        message: `当前正在运行 NucWise AI ${app.getVersion()}。`,
        detail: `您刚启动的是 ${incomingVersion}。请从系统托盘选择“退出”，再重新启动新版本，以确保功能已更新。`,
      })
    }
    // on windows and linux, the deep link is passed in the command line
    const url = commandLine.find(
      (arg) => arg.startsWith('desktopassistant://') || arg.startsWith('desktopassistant-dev://')
    )

    if (url) {
      // Deep Link 场景：总是显示并聚焦窗口
      if (!mainWindow) {
        // 窗口未创建，立即创建
        await createWindow()
      }

      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.show()
        mainWindow.focus()

        // 确保窗口加载完成后再处理 Deep Link
        if (mainWindow.webContents.isLoading()) {
          mainWindow.webContents.once('did-finish-load', () => {
            if (mainWindow) {
              handleDeepLink(mainWindow, url)
            }
          })
        } else {
          handleDeepLink(mainWindow, url)
        }
      }
    } else {
      // 非 Deep Link 场景：切换显示/隐藏
      await showOrHideWindow()
    }
  })

  app.on('window-all-closed', () => {
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    // if (process.platform !== 'darwin') {
    //     app.quit()
    // }
  })

  app
    .whenReady()
    .then(async () => {
      migrateLegacyKnowledgeProfile()
      await knowledgeBaseInitPromise
      await createWindow()
      await startDesktopAssistant()
      await initializeSessionAttachmentRagAfterAppReady()
      ensureTray()
      // 处理启动时的 Deep Link (Windows/Linux)
      // macOS 会通过 open-url 事件处理，不需要在这里处理
      if (process.platform !== 'darwin') {
        const url = process.argv.find(
          (arg) => arg.startsWith('desktopassistant://') || arg.startsWith('desktopassistant-dev://')
        )
        if (url && mainWindow) {
          // 确保窗口加载完成后再处理 Deep Link
          if (mainWindow.webContents.isLoading()) {
            mainWindow.webContents.once('did-finish-load', () => {
              if (mainWindow) {
                handleDeepLink(mainWindow, url)
              }
            })
          } else {
            handleDeepLink(mainWindow, url)
          }
        }
      }
      app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) {
          createWindow()
        }
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.show()
          mainWindow.focus()
        }
      })
      // 监听窗口大小位置变化的代码，很大程度参考了 VSCODE 的实现 /Users/benn/Documents/w/vscode/src/vs/platform/windows/electron-main/windowsStateHandler.ts
      // When a window looses focus, save all windows state. This allows to
      // prevent loss of window-state data when OS is restarted without properly
      // shutting down the application (https://github.com/microsoft/vscode/issues/87171)
      app.on('browser-window-blur', () => {
        if (mainWindow) {
          windowState.saveState(mainWindow)
        }
      })
      registerShortcuts()
      proxy.init()
      app.on('will-quit', () => {
        try {
          unregisterShortcuts()
        } catch (e) {
          log.error('shortcut: failed to unregister', e)
        }
        mcpIpc.closeAllTransports()
        stopDesktopAssistant()
        destroyTray()
      })
      app.on('before-quit', () => {
        isQuitting = true
        stopDesktopAssistant()
        destroyTray()
      })
    })
    .catch((err: unknown) => log.error('App initialization failed:', err))
}

// macos uses this event to handle deep links
app.on('open-url', async (_event, url) => {
  if (!mainWindow) {
    // 窗口未创建，立即创建
    await createWindow()
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()

    // 确保窗口加载完成后再处理 Deep Link
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (mainWindow) {
          handleDeepLink(mainWindow, url)
        }
      })
    } else {
      handleDeepLink(mainWindow, url)
    }
  }
})

// --------- IPC 监听 ---------

ipcMain.handle('getStoreValue', (event, key) => {
  return store.get(key)
})
ipcMain.handle('setStoreValue', (event, key, dataJson) => {
  // 仅在传输层用 JSON 序列化，存储层用原生数据，避免存储层 JSON 损坏后无法自动处理的情况
  const data = JSON.parse(dataJson)
  const result = store.set(key, data)
  if (key === 'settings') {
    syncDesktopAssistantExecutionMode()
    syncDesktopAssistantHotkey()
  }
  return result
})
ipcMain.handle('delStoreValue', (event, key) => {
  return store.delete(key)
})
ipcMain.handle('getAllStoreValues', (event) => {
  return JSON.stringify(store.store)
})
ipcMain.handle('getAllStoreKeys', (event) => {
  return Object.keys(store.store)
})
ipcMain.handle('setAllStoreValues', (event, dataJson) => {
  const data = JSON.parse(dataJson)
  store.store = { ...store.store, ...data }
})

ipcMain.handle('getStoreBlob', async (event, key) => {
  return getStoreBlob(key)
})
ipcMain.handle('setStoreBlob', async (event, key, value: string) => {
  return setStoreBlob(key, value)
})
ipcMain.handle('delStoreBlob', async (event, key) => {
  return delStoreBlob(key)
})
ipcMain.handle('listStoreBlobKeys', async (event) => {
  return listStoreBlobKeys()
})

ipcMain.handle('getVersion', () => {
  return app.getVersion()
})
ipcMain.handle('getPlatform', () => {
  return process.platform
})
ipcMain.handle('getArch', () => {
  return process.arch
})
ipcMain.handle('getHostname', () => {
  return os.hostname()
})
ipcMain.handle('getDeviceName', () => {
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process')
      const computerName = execSync('scutil --get ComputerName', { encoding: 'utf8' }).trim()
      return computerName || os.hostname()
    } catch (error) {
      return os.hostname()
    }
  } else if (process.platform === 'win32') {
    return process.env.COMPUTERNAME || os.hostname()
  } else {
    return os.hostname()
  }
})
ipcMain.handle('getLocale', () => {
  try {
    return app.getLocale()
  } catch (e: unknown) {
    return ''
  }
})
ipcMain.handle('openLink', (event, link) => {
  return openExternalLink(link)
})
ipcMain.handle('ensureShortcutConfig', (event, json) => {
  const config: ShortcutSetting = JSON.parse(json)
  unregisterShortcuts()
  registerShortcuts(config)
  syncDesktopAssistantHotkey(config.selectionAssistant)
})

ipcMain.handle('shouldUseDarkColors', () => nativeTheme.shouldUseDarkColors)

ipcMain.handle('ensureProxy', (event, json) => {
  const config: { proxy?: string } = JSON.parse(json)
  proxy.ensure(config.proxy)
})

ipcMain.handle('relaunch', () => {
  app.relaunch()
  app.quit()
})

ipcMain.handle('analysticTrackingEvent', (event, dataJson) => {
  return undefined
})

ipcMain.handle('getConfig', (event) => {
  return getConfig()
})

ipcMain.handle('getSettings', (event) => {
  return getSettings()
})

ipcMain.handle('shouldShowAboutDialogWhenStartUp', (event) => {
  return false
})

ipcMain.handle('appLog', (event, dataJson) => {
  const data: { level: string; message: string } = JSON.parse(dataJson)
  data.message = 'APP_LOG: ' + data.message
  switch (data.level) {
    case 'info':
      log.info(data.message)
      break
    case 'error':
      log.error(data.message)
      break
    default:
      log.info(data.message)
  }
})

ipcMain.handle('exportLogs', async () => {
  try {
    const fsPromises = await import('fs/promises')
    const logPath = log.transports.file.getFile()?.path
    if (!logPath) {
      return ''
    }
    const content = await fsPromises.readFile(logPath, 'utf-8')
    return content
  } catch (error) {
    log.error('Failed to export logs:', error)
    return ''
  }
})

ipcMain.handle('clearLogs', async () => {
  try {
    const fsPromises = await import('fs/promises')
    const logPath = log.transports.file.getFile()?.path
    if (logPath) {
      await fsPromises.writeFile(logPath, '', 'utf-8')
    }
  } catch (error) {
    log.error('Failed to clear logs:', error)
  }
})

ipcMain.handle('ensureAutoLaunch', (event, enable: boolean) => {
  if (isDebug) {
    log.info('ensureAutoLaunch: skip by debug mode')
    return
  }
  return autoLauncher.ensure(enable)
})

ipcMain.handle('parseFileLocally', async (event, dataJSON: string) => {
  const params: { filePath: string } = JSON.parse(dataJSON)
  try {
    const data = await parseFile(params.filePath)
    return JSON.stringify({ text: data, isSupported: true })
  } catch (e) {
    log.error(`parseFileLocally failed: "${params.filePath}"`, e)
    return JSON.stringify({ isSupported: false })
  }
})

ipcMain.handle('parseUrl', async (event, url: string) => {
  // const result = await readability(url, { maxLength: 1000 })
  // const key = 'parseUrl-' + uuidv4()
  // await setStoreBlob(key, result.text)
  // return JSON.stringify({ key, title: result.title })
  return JSON.stringify({ key: '', title: '' })
})

ipcMain.handle('isFullscreen', () => {
  return mainWindow?.isFullScreen() || false
})

ipcMain.handle('setFullscreen', (event, enable: boolean) => {
  if (!mainWindow) {
    return
  }
  if (enable) {
    mainWindow.setFullScreen(true)
  } else {
    // 解决MacOS全屏下隐藏将黑屏的问题
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
    mainWindow.hide()
  }
})

ipcMain.handle('switch-theme', (event, theme: 'dark' | 'light') => {
  if (!mainWindow || process.platform !== 'darwin' || typeof mainWindow.setTitleBarOverlay !== 'function') {
    return
  }
  mainWindow.setTitleBarOverlay({
    color: theme === 'dark' ? '#282828' : 'white',
    symbolColor: theme === 'dark' ? 'white' : 'black',
  })
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Working Directory',
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  mainWindow?.maximize()
})

ipcMain.handle('window:unmaximize', () => {
  mainWindow?.unmaximize()
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:is-maximized', () => {
  return mainWindow?.isMaximized()
})

ipcMain.on('desktop-assistant:progress', forwardDesktopAssistantProgress)
ipcMain.on('desktop-assistant:chunk', forwardDesktopAssistantChunk)
ipcMain.on('desktop-assistant:result', forwardDesktopAssistantResult)
ipcMain.on('desktop-assistant:ready', markDesktopAssistantRendererReady)
ipcMain.on('desktop-assistant:started', markDesktopAssistantRendererStarted)

registerSandboxHandlers()
registerSkillsHandlers()
registerOAuthHandlers()
registerDifyHandlers(syncDesktopAssistantExecutionMode)
