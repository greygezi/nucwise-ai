import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage, type WebContents } from 'electron'
import { Agent } from 'undici'
import {
  DESKTOP_ASSISTANT_DEFAULT_CHAT,
  type DifyHistoryEntry,
  type DifyInputField,
  type DifyProfile,
  type DifyProfileInput,
  type DifyRunEvent,
  type DifyRunRequest,
  type DifyRunResult,
} from '../../shared/dify'
import { getSettings, store } from '../store-node'

interface StoredProfile extends Omit<DifyProfile, 'hasApiKey'> {
  encryptedApiKey: string
}

const PROFILE_KEY = 'difyProfiles'
const HISTORY_KEY = 'difyHistory'
const ASSISTANT_PROFILE_KEY = 'difyAssistantProfileId'
const activeRuns = new Map<string, AbortController>()
const insecureTlsAgent = new Agent({ connect: { rejectUnauthorized: false } })

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function mimeTypeForPath(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function difyFileType(filePath: string) {
  const mime = mimeTypeForPath(filePath)
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

function assistantPromptExamples(data: Record<string, unknown>) {
  const processData = data.process_data
  if (!processData || typeof processData !== 'object') return []
  const prompts = (processData as { prompts?: unknown }).prompts
  if (!Array.isArray(prompts)) return []
  return prompts.flatMap((prompt) => {
    if (!prompt || typeof prompt !== 'object') return []
    const item = prompt as { role?: unknown; text?: unknown }
    return item.role === 'assistant' && typeof item.text === 'string' ? [item.text] : []
  })
}

function normalizedOutput(value: string) {
  const tail = value.split('</think>').at(-1) || ''
  return tail
    .replace(/```(?:markdown)?/gi, '')
    .replace(/\s+/g, '')
    .trim()
}

export function isPromptEcho(output: string, assistantExamples: string[]) {
  const normalized = normalizedOutput(output)
  if (normalized.length < 80) return false
  return assistantExamples.some((example) => {
    const candidate = normalizedOutput(example)
    return candidate.length >= 80 && (candidate.includes(normalized) || normalized.includes(candidate))
  })
}

export function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('请填写 Dify 服务地址。')
  const hostCandidate = trimmed.split('/')[0].split(':')[0].toLowerCase()
  const isPrivateIpv4 =
    /^(?:127|10)\./.test(hostCandidate) ||
    /^192\.168\./.test(hostCandidate) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostCandidate) ||
    /^169\.254\./.test(hostCandidate)
  const isLocalHost =
    hostCandidate === 'localhost' ||
    hostCandidate.endsWith('.local') ||
    (!hostCandidate.includes('.') && hostCandidate !== '') ||
    isPrivateIpv4
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `${isLocalHost ? 'http' : 'https'}://${trimmed}`
  const url = new URL(withProtocol)
  if (url.hostname.endsWith('udify.app') || ['dify.ai', 'cloud.dify.ai', 'api.dify.ai'].includes(url.hostname)) {
    return 'https://api.dify.ai/v1'
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  const apiPath = pathname.endsWith('/v1') ? pathname : `${pathname === '/' ? '' : pathname}/v1`
  return `${url.origin}${apiPath}`
}

function encryptSecret(value: string) {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全保存 API Key。')
  return safeStorage.encryptString(value).toString('base64')
}

function decryptSecret(value: string) {
  if (!value) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

function storedProfiles(): StoredProfile[] {
  return (store.get(PROFILE_KEY as never, []) || []) as StoredProfile[]
}

function publicProfile(profile: StoredProfile): DifyProfile {
  const { encryptedApiKey, ...rest } = profile
  return { ...rest, hasApiKey: !!encryptedApiKey }
}

export function listProfiles() {
  return storedProfiles().map(publicProfile)
}

export function saveProfile(input: DifyProfileInput) {
  const profiles = storedProfiles()
  const existing = input.id ? profiles.find((item) => item.id === input.id) : undefined
  const now = new Date().toISOString()
  const profile: StoredProfile = {
    id: existing?.id || randomUUID(),
    name: input.name.trim() || '未命名工作流',
    baseUrl: normalizeBaseUrl(input.baseUrl),
    appType: input.appType,
    verifyTls: input.verifyTls !== false,
    encryptedApiKey: input.apiKey ? encryptSecret(input.apiKey.trim()) : existing?.encryptedApiKey || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  const next = existing ? profiles.map((item) => (item.id === profile.id ? profile : item)) : [...profiles, profile]
  store.set(PROFILE_KEY as never, next as never)
  return publicProfile(profile)
}

export function deleteProfile(id: string) {
  store.set(PROFILE_KEY as never, storedProfiles().filter((item) => item.id !== id) as never)
  return true
}

function requireProfile(id: string) {
  const profile = storedProfiles().find((item) => item.id === id)
  if (!profile) throw new Error('Dify 配置不存在或已删除。')
  const apiKey = decryptSecret(profile.encryptedApiKey)
  if (!apiKey) throw new Error('请先为该 Dify 配置填写 API Key。')
  return { profile, apiKey }
}

function networkErrorDetail(error: unknown) {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const item = current as { message?: unknown; code?: unknown; cause?: unknown }
    if (typeof item.code === 'string') messages.push(item.code)
    if (typeof item.message === 'string' && item.message !== 'fetch failed') messages.push(item.message)
    current = item.cause
  }
  return [...new Set(messages)].join(' / ') || '网络连接失败'
}

async function checkedFetch(url: string, init: RequestInit, apiKey: string, verifyTls = true) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const requestInit = {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Accept-Encoding': 'identity',
          Connection: 'close',
          ...init.headers,
        },
        ...(verifyTls ? {} : { dispatcher: insecureTlsAgent }),
      } as RequestInit
      const response = await fetch(url, requestInit)
      if (!response.ok) {
        const responseText = await response.text()
        let detail: unknown = responseText
        try {
          const payload = JSON.parse(responseText) as Record<string, unknown>
          detail = payload.message || payload.error || responseText
        } catch {
          // Keep the raw body for non-JSON proxy and server errors.
        }
        throw new Error(`HTTP ${response.status} - ${String(detail || response.statusText)}`)
      }
      return response
    } catch (error) {
      lastError = error
      if (init.signal?.aborted || (error instanceof Error && error.message.startsWith('HTTP '))) throw error
      if (attempt === 2) {
        const detail = networkErrorDetail(error)
        const tlsHint = url.startsWith('https://')
          ? '若本地服务使用自签名证书，可在该工作流配置中关闭“验证 TLS 证书”。'
          : '请确认 Dify 服务、端口、防火墙和反向代理均可从本机访问。'
        throw new Error(`无法连接 Dify：${url}（${detail}）。${tlsHint}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

export function normalizeFields(raw: unknown[]): DifyInputField[] {
  const kinds = new Set(['text-input', 'paragraph', 'select', 'file', 'file-list', 'text-area', 'radio'])
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    let item = entry as Record<string, unknown>
    let type = String(item.type || 'text-input')
    const keys = Object.keys(item)
    if (keys.length === 1 && kinds.has(keys[0]) && item[keys[0]] && typeof item[keys[0]] === 'object') {
      type = keys[0]
      item = item[keys[0]] as Record<string, unknown>
    }
    const variable = String(item.variable || item.name || '')
    if (!variable) return []
    return [
      {
        variable,
        label: String(item.label || item.display_name || variable),
        type: (kinds.has(type) ? type : 'text-input') as DifyInputField['type'],
        required: Boolean(item.required),
        default: item.default == null ? undefined : String(item.default),
        options: Array.isArray(item.options) ? item.options.map(String) : undefined,
        description: item.hint || item.description ? String(item.hint || item.description) : undefined,
      },
    ]
  })
}

export async function getParameters(profileId: string) {
  const { profile, apiKey } = requireProfile(profileId)
  const response = await checkedFetch(`${profile.baseUrl}/parameters`, { method: 'GET' }, apiKey, profile.verifyTls)
  const payload = (await response.json()) as { user_input_form?: unknown[]; app_mode?: string; mode?: string }
  const detected = String(payload.app_mode || payload.mode || '').toLowerCase()
  return {
    fields: normalizeFields(payload.user_input_form || []),
    detectedAppType:
      detected === 'workflow'
        ? 'workflow'
        : ['advanced-chat', 'chatflow', 'chat', 'agent-chat'].includes(detected)
          ? 'chatflow'
          : undefined,
  }
}

async function uploadFile(profile: StoredProfile, apiKey: string, filePath: string, user: string, signal: AbortSignal) {
  const bytes = await fs.readFile(filePath)
  const mimeType = mimeTypeForPath(filePath)
  const form = new FormData()
  form.append('user', user)
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: mimeType }), path.basename(filePath))
  const response = await checkedFetch(
    `${profile.baseUrl}/files/upload`,
    { method: 'POST', body: form, signal },
    apiKey,
    profile.verifyTls
  )
  const payload = (await response.json()) as { id?: unknown }
  const uploadFileId = typeof payload.id === 'string' ? payload.id.trim() : ''
  if (!uploadFileId) throw new Error(`Dify 未返回文件 ID，上传失败：${path.basename(filePath)}`)
  return { type: difyFileType(filePath), transfer_method: 'local_file', upload_file_id: uploadFileId }
}

async function prepareInputs(
  profile: StoredProfile,
  apiKey: string,
  inputs: Record<string, unknown>,
  user: string,
  signal: AbortSignal
) {
  const prepared: Record<string, unknown> = {}
  const chatFiles: Record<string, unknown>[] = []
  for (const [name, value] of Object.entries(inputs)) {
    if (!value || typeof value !== 'object' || !('__dify_file_paths__' in value)) {
      prepared[name] = value
      continue
    }
    const paths = (value as { __dify_file_paths__: string[] }).__dify_file_paths__
    const refs = []
    for (const filePath of paths) {
      const ref = await uploadFile(profile, apiKey, filePath, user, signal)
      refs.push(ref)
      chatFiles.push(ref)
    }
    prepared[name] = refs
  }
  return { prepared, chatFiles }
}

function outputText(outputs?: Record<string, unknown>) {
  if (!outputs) return ''
  return Object.entries(outputs)
    .map(([key, value]) => `## ${key}\n\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}`)
    .join('\n\n')
}

function appendHistory(profile: StoredProfile, result: DifyRunResult) {
  const history = (store.get(HISTORY_KEY as never, []) || []) as DifyHistoryEntry[]
  history.unshift({
    id: randomUUID(),
    profileId: profile.id,
    profileName: profile.name,
    createdAt: new Date().toISOString(),
    status: result.status,
    output: result.output,
    error: result.error,
  })
  store.set(HISTORY_KEY as never, history.slice(0, 100) as never)
}

export function listHistory() {
  return ((store.get(HISTORY_KEY as never, []) || []) as DifyHistoryEntry[]).slice(0, 100)
}

export function clearHistory() {
  store.set(HISTORY_KEY as never, [] as never)
  return true
}

export function getAssistantProfileId() {
  const configured = (store.get(ASSISTANT_PROFILE_KEY as never, '') || '') as string
  if (configured === DESKTOP_ASSISTANT_DEFAULT_CHAT) return ''
  const profiles = storedProfiles()
  if (configured) {
    return profiles.some((profile) => profile.id === configured && profile.appType === 'workflow') ? configured : ''
  }
  return ''
}

export function setAssistantProfileId(profileId: string) {
  if (profileId === DESKTOP_ASSISTANT_DEFAULT_CHAT) {
    store.set(ASSISTANT_PROFILE_KEY as never, DESKTOP_ASSISTANT_DEFAULT_CHAT as never)
    return ''
  }
  const profile = storedProfiles().find((item) => item.id === profileId && item.appType === 'workflow')
  if (!profile) throw new Error('浮窗助手只能使用已保存的 Workflow 配置。')
  store.set(ASSISTANT_PROFILE_KEY as never, profileId as never)
  return profileId
}

export async function run(request: DifyRunRequest, sender: WebContents): Promise<DifyRunResult> {
  const { profile, apiKey } = requireProfile(request.profileId)
  const runId = request.runId?.trim() || randomUUID()
  const controller = new AbortController()
  activeRuns.set(runId, controller)
  const user = request.user?.trim() || `desktop-assistant-${randomUUID()}`
  let chatAnswer = ''
  let finalResult: DifyRunResult | undefined
  const assistantExamples: string[] = []
  const emit = (event: string, data: Record<string, unknown>) => {
    const payload: DifyRunEvent = { runId, event, data }
    if (!sender.isDestroyed()) sender.send('dify:run-event', payload)
  }
  try {
    emit('upload_started', {})
    const { prepared, chatFiles } = await prepareInputs(profile, apiKey, request.inputs, user, controller.signal)
    const isChat = profile.appType === 'chatflow'
    const endpoint = `${profile.baseUrl}/${isChat ? 'chat-messages' : 'workflows/run'}`
    const body: Record<string, unknown> = isChat
      ? { inputs: prepared, query: request.query || '', response_mode: 'streaming', user, files: chatFiles }
      : { inputs: prepared, response_mode: 'streaming', user }
    if (isChat && request.conversationId) body.conversation_id = request.conversationId
    const response = await checkedFetch(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
      apiKey,
      profile.verifyTls
    )
    if (!response.body) throw new Error('Dify 没有返回流式响应。')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamDone = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        streamDone = done
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const lines = buffer.split(/\r?\n/)
        // Some self-hosted Dify/reverse-proxy combinations close the SSE stream
        // immediately after the final `data:` record without a trailing newline.
        // On EOF the remaining fragment is a complete line and must be parsed.
        buffer = done ? '' : lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          let event: { event?: string; data?: Record<string, unknown>; [key: string]: unknown }
          try {
            event = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          const eventName = event.event || 'unknown'
          const data = event.data && typeof event.data === 'object' ? event.data : event
          emit(eventName, data)
          if (eventName === 'node_finished') {
            assistantExamples.push(...assistantPromptExamples(data))
          }
          if (eventName === 'message') chatAnswer += String(data.answer || '')
          if (eventName === 'workflow_finished' && !isChat) {
            const status = data.status === 'succeeded' ? 'succeeded' : 'failed'
            const outputs = (data.outputs || {}) as Record<string, unknown>
            const output = outputText(outputs)
            finalResult = isPromptEcho(output, assistantExamples)
              ? {
                  runId,
                  status: 'failed',
                  outputs,
                  output: '',
                  error:
                    'Dify 的 LLM 节点返回了 Prompt 中预设的 assistant 示例，而不是本次运行结果。请删除该节点的 assistant 示例消息后重试。',
                }
              : {
                  runId,
                  status,
                  outputs,
                  output,
                  error: data.error ? String(data.error) : undefined,
              }
          }
          if (eventName === 'workflow_finished' && isChat && data.status !== 'succeeded') {
            finalResult = {
              runId,
              status: 'failed',
              output: chatAnswer,
              error: String(data.error || 'Dify 执行失败'),
            }
          }
          if (eventName === 'message_end') {
            finalResult = {
              runId,
              status: 'succeeded',
              output: chatAnswer,
              conversationId: data.conversation_id ? String(data.conversation_id) : undefined,
            }
          }
          if (eventName === 'error' || eventName === 'workflow_failed') {
            finalResult = {
              runId,
              status: 'failed',
              output: chatAnswer,
              error: String(data.message || data.error || 'Dify 执行失败'),
            }
          }
        }
        if (done || finalResult) break
      }
      finalResult ||= {
        runId,
        status: 'failed',
        output: chatAnswer,
        error: 'Dify 流式响应在终止事件前结束，结果可能不完整。',
      }
    } finally {
      if (!streamDone) {
        await reader.cancel().catch(() => undefined)
      }
      reader.releaseLock()
    }
    appendHistory(profile, finalResult)
    return finalResult
  } catch (error) {
    const stopped = controller.signal.aborted
    const result: DifyRunResult = {
      runId,
      status: stopped ? 'stopped' : 'failed',
      output: chatAnswer,
      error: stopped ? '已取消' : error instanceof Error ? error.message : String(error),
    }
    appendHistory(profile, result)
    return result
  } finally {
    activeRuns.delete(runId)
  }
}

export function cancel(runId: string) {
  const controller = activeRuns.get(runId)
  controller?.abort()
  return !!controller
}

export function migrateLegacyKnowledgeProfile() {
  if (storedProfiles().length) return
  const legacy = getSettings().difyKnowledge
  if (!legacy?.baseUrl) return
  const profile = saveProfile({
    name: legacy.name || 'Dify 知识工作流',
    baseUrl: legacy.baseUrl,
    appType: 'workflow',
    apiKey: legacy.apiKey,
  })
  store.set('settings', {
    ...getSettings(),
    difyKnowledge: { ...legacy, profileId: profile.id, apiKey: '' },
  })
}

export async function importLegacyWorkflowClient() {
  const legacyPath = path.join(app.getPath('home'), '.dify_workflow_client.json')
  try {
    const raw = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as Record<string, unknown>
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
    let imported = 0
    for (const item of profiles) {
      if (!item || typeof item !== 'object') continue
      const profile = item as Record<string, unknown>
      saveProfile({
        name: String(profile.name || `导入的工作流 ${imported + 1}`),
        baseUrl: String(profile.service_url || profile.published_url || raw.base_url || ''),
        appType: profile.app_type === 'chatflow' ? 'chatflow' : 'workflow',
        verifyTls: profile.verify_tls !== false,
      })
      imported += 1
    }
    return { imported, needsApiKey: imported, source: legacyPath }
  } catch {
    return { imported: 0, needsApiKey: 0, source: legacyPath }
  }
}
