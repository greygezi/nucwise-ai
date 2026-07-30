import type { Settings } from '@shared/types'

export type DifyKnowledgeConfig = NonNullable<Settings['difyKnowledge']>
export const DIFY_KNOWLEDGE_BASE_ID = -1

function normalizeDifyBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('请填写 Dify 服务地址。')
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  if (url.hostname.endsWith('udify.app') || ['dify.ai', 'cloud.dify.ai'].includes(url.hostname)) {
    return 'https://api.dify.ai/v1'
  }
  return url.pathname.endsWith('/v1') ? withProtocol : `${url.origin}/v1`
}

function firstTextOutput(outputs: Record<string, unknown> | undefined): string {
  if (!outputs) return ''
  for (const value of Object.values(outputs)) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value !== undefined && value !== null) {
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
      if (text.trim()) return text.trim()
    }
  }
  return ''
}

export async function runDifyKnowledgeWorkflow(
  config: DifyKnowledgeConfig,
  query: string,
  signal?: AbortSignal
): Promise<string> {
  if (config.profileId && window.electronAPI) {
    const result = (await window.electronAPI.invoke('dify:run', {
      profileId: config.profileId,
      inputs: { [config.inputVariable.trim() || 'query']: query },
      user: config.user.trim() || 'desktop-assistant',
    })) as {
      status: string
      output: string
      outputs?: Record<string, unknown>
      error?: string
    }
    if (result.status !== 'succeeded') throw new Error(result.error || 'Dify 知识工作流执行失败。')
    const selected = config.outputVariable.trim() ? result.outputs?.[config.outputVariable.trim()] : undefined
    const output = selected == null ? result.output : String(selected)
    if (!output.trim()) throw new Error('Dify 工作流已完成，但没有返回可用的文本输出。')
    return output.trim()
  }
  if (!config.apiKey.trim()) throw new Error('请填写 Dify Workflow API Key。')
  if (!query.trim()) throw new Error('知识库查询内容不能为空。')

  const endpoint = `${normalizeDifyBaseUrl(config.baseUrl)}/workflows/run`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: { [config.inputVariable.trim() || 'query']: query },
      response_mode: 'blocking',
      user: config.user.trim() || 'desktop-assistant',
    }),
    signal,
  })

  const payload = (await response.json().catch(() => ({}))) as {
    message?: string
    data?: { status?: string; error?: string; outputs?: Record<string, unknown> }
  }
  if (!response.ok || payload.data?.status === 'failed') {
    throw new Error(payload.data?.error || payload.message || `Dify 请求失败（HTTP ${response.status}）`)
  }

  const configuredOutput = config.outputVariable.trim()
    ? payload.data?.outputs?.[config.outputVariable.trim()]
    : undefined
  const result = configuredOutput == null ? firstTextOutput(payload.data?.outputs) : String(configuredOutput)
  if (!result.trim()) throw new Error('Dify 工作流已完成，但没有返回可用的文本输出。')
  return result.trim()
}

export function injectDifyKnowledgeContext(messages: import('@shared/types').Message[], result: string) {
  const latest = messages.at(-1)
  const latestText = latest?.contentParts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return [
    {
      id: '',
      role: 'system' as const,
      contentParts: [
        {
          type: 'text' as const,
          text: '请优先依据 Dify 知识工作流返回的资料回答问题；资料不足时明确说明，不要编造。',
        },
      ],
    },
    ...messages.slice(0, -1),
    {
      id: '',
      role: 'user' as const,
      contentParts: [
        {
          type: 'text' as const,
          text: `[Dify knowledge begin]\n${result}\n[Dify knowledge end]\n\nUser Message:\n${latestText || ''}`,
        },
      ],
    },
  ]
}
