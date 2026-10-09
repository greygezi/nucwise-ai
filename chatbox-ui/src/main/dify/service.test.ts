import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/Users/test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

const memory = new Map<string, unknown>()
vi.mock('../store-node', () => ({
  getSettings: () => ({ difyKnowledge: undefined }),
  store: {
    get: (key: string, fallback: unknown) => memory.get(key) ?? fallback,
    set: (key: string, value: unknown) => memory.set(key, value),
  },
}))

async function runStream(body: string, appType: 'workflow' | 'chatflow' = 'workflow') {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器未能启动。')
    const { run, saveProfile } = await import('./service')
    const profile = saveProfile({
      name: '本地流式回归测试',
      baseUrl: `127.0.0.1:${address.port}`,
      appType,
      apiKey: 'app-stream-test',
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    return await run(
      { profileId: profile.id, inputs: {}, ...(appType === 'chatflow' ? { query: '测试问题' } : {}) },
      sender as never
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    )
  }
}

describe('Dify service normalization', () => {
  beforeEach(() => memory.clear())

  it('normalizes cloud and self-hosted service URLs', async () => {
    const { normalizeBaseUrl } = await import('./service')
    expect(normalizeBaseUrl('https://example.udify.app/chat/abc')).toBe('https://api.dify.ai/v1')
    expect(normalizeBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1')
    expect(normalizeBaseUrl('192.168.1.50:8080')).toBe('http://192.168.1.50:8080/v1')
    expect(normalizeBaseUrl('dify-server')).toBe('http://dify-server/v1')
    expect(normalizeBaseUrl('http://192.168.1.50:8080/dify')).toBe('http://192.168.1.50:8080/dify/v1')
    expect(normalizeBaseUrl('https://dify.example.com/v1')).toBe('https://dify.example.com/v1')
  })

  it('defaults the floating assistant to Chat and uses Dify only after explicit selection', async () => {
    const { DESKTOP_ASSISTANT_DEFAULT_CHAT } = await import('../../shared/dify')
    const { getAssistantProfileId, saveProfile, setAssistantProfileId } = await import('./service')
    const profile = saveProfile({
      name: '兼容性工作流',
      baseUrl: '127.0.0.1:8080',
      appType: 'workflow',
      apiKey: 'test-key',
    })
    const secondProfile = saveProfile({
      name: '备用工作流',
      baseUrl: '127.0.0.1:8081',
      appType: 'workflow',
      apiKey: 'test-key',
    })

    expect(getAssistantProfileId()).toBe('')
    expect(setAssistantProfileId(DESKTOP_ASSISTANT_DEFAULT_CHAT)).toBe('')
    expect(getAssistantProfileId()).toBe('')
    expect(setAssistantProfileId(profile.id)).toBe(profile.id)
    expect(getAssistantProfileId()).toBe(profile.id)
    const { deleteProfile } = await import('./service')
    expect(deleteProfile(profile.id)).toBe(true)
    expect(getAssistantProfileId()).toBe('')
    expect(secondProfile.id).not.toBe(profile.id)
  })

  it('flattens Dify user_input_form schemas', async () => {
    const { normalizeFields } = await import('./service')
    expect(
      normalizeFields([
        { 'text-input': { variable: 'query', label: '问题', required: true } },
        { select: { variable: 'tone', label: '语气', options: ['正式', '简洁'] } },
        { file: { variable: 'document', label: '文档' } },
      ])
    ).toEqual([
      { variable: 'query', label: '问题', type: 'text-input', required: true },
      { variable: 'tone', label: '语气', type: 'select', required: false, options: ['正式', '简洁'] },
      { variable: 'document', label: '文档', type: 'file', required: false },
    ])
  })

  it('loads parameters from a local Dify deployment with a reverse-proxy subpath', async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe('/dify/v1/parameters')
      expect(request.headers.authorization).toBe('Bearer app-local-test')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          app_mode: 'workflow',
          user_input_form: [{ file: { variable: 'document', label: '本地文档', required: true } }],
        })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试服务器未能启动。')
      const { getParameters, saveProfile } = await import('./service')
      const profile = saveProfile({
        name: '本地 Dify',
        baseUrl: `127.0.0.1:${address.port}/dify`,
        appType: 'workflow',
        apiKey: 'app-local-test',
      })
      await expect(getParameters(profile.id)).resolves.toEqual({
        fields: [{ variable: 'document', label: '本地文档', type: 'file', required: true }],
        detectedAppType: 'workflow',
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      )
    }
  })

  it('fails an empty stream instead of recording a successful run', async () => {
    await expect(runStream('')).resolves.toMatchObject({
      status: 'failed',
      output: '',
      error: 'Dify 流式响应在终止事件前结束，结果可能不完整。',
    })
  })

  it('preserves partial chat output when the stream ends before its terminal event', async () => {
    await expect(runStream('data: {"event":"message","data":{"answer":"部分结果"}}\n\n')).resolves.toMatchObject({
      status: 'failed',
      output: '部分结果',
    })
  })

  it('waits for message_end after a successful chatflow workflow_finished event', async () => {
    const body =
      'data: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n' +
      'data: {"event":"message","data":{"answer":"完整回答"}}\n\n' +
      'data: {"event":"message_end","data":{"conversation_id":"conversation-1"}}'
    await expect(runStream(body, 'chatflow')).resolves.toMatchObject({
      status: 'succeeded',
      output: '完整回答',
      conversationId: 'conversation-1',
    })
  })

  it('uploads a file and reads a workflow result when the final SSE event has no trailing newline', async () => {
    const requests: Array<{ url: string; authorization?: string; contentType?: string }> = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url || '',
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
      })
      if (request.url === '/v1/files/upload') {
        request.resume()
        request.on('end', () => {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ id: 'uploaded-file-1' }))
        })
        return
      }
      if (request.url === '/v1/workflows/run') {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => {
          body += chunk
        })
        request.on('end', () => {
          expect(JSON.parse(body)).toMatchObject({
            inputs: {
              document: [{ type: 'document', transfer_method: 'local_file', upload_file_id: 'uploaded-file-1' }],
            },
            response_mode: 'streaming',
          })
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          response.end(
            'data: {"event":"workflow_finished","data":{"status":"succeeded","outputs":{"result":"真实文档对比结果"}}}'
          )
        })
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试服务器未能启动。')
      const { run, saveProfile } = await import('./service')
      const profile = saveProfile({
        name: '本地工作流回归测试',
        baseUrl: `127.0.0.1:${address.port}`,
        appType: 'workflow',
        apiKey: 'app-workflow-test',
      })
      const sender = { isDestroyed: () => false, send: vi.fn() }
      const result = await run(
        {
          profileId: profile.id,
          inputs: {
            document: {
              __dify_file_paths__: [
                fileURLToPath(new URL('../../../test/cases/file-conversation/sample.txt', import.meta.url)),
              ],
            },
          },
        },
        sender as never
      )
      expect(result).toMatchObject({ status: 'succeeded', output: '## result\n\n真实文档对比结果' })
      expect(requests.map((item) => item.url)).toEqual(['/v1/files/upload', '/v1/workflows/run'])
      expect(requests.every((item) => item.authorization === 'Bearer app-workflow-test')).toBe(true)
      expect(requests[0].contentType).toContain('multipart/form-data')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      )
    }
  })

  it('uses Dify-compatible MIME types for office documents', async () => {
    const { mimeTypeForPath } = await import('./service')
    expect(mimeTypeForPath('D:/docs/specification.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(mimeTypeForPath('D:/docs/data.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(mimeTypeForPath('D:/docs/report.pdf')).toBe('application/pdf')
    expect(mimeTypeForPath('D:/docs/unknown.bin')).toBe('application/octet-stream')
  })

  it('detects when a workflow returns its assistant prompt example', async () => {
    const { isPromptEcho } = await import('./service')
    const example =
      '# 差异对比表\n|序号|页码|位置标识|旧值|新值|差异类型|差异说明|\n|1|5|表2.1 主冷却剂泵参数|额定流量 2500|额定流量 2650|数值差异|主冷却剂泵额定流量从 2500 增加到 2650|'
    expect(isPromptEcho(`## text\n\n${example}`, [`\`\`\`markdown\n${example}`])).toBe(true)
    expect(
      isPromptEcho('# 差异对比表\n|1|88|真实章节|A|B|内容新增|本次文档的实际差异内容，且与示例完全不同。|', [example])
    ).toBe(false)
  })
})
