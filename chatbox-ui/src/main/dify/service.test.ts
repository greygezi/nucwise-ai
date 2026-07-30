import { createServer } from 'node:http'
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
