import { describe, expect, it, vi } from 'vitest'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import type { SentryScope } from '../../../utils/sentry_adapter'
import Ollama from './ollama'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
}

function createDependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
  return {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest,
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'desktop',
    oauth: {
      refreshCredential: vi.fn(),
      persistCredential: vi.fn(),
      clearCredential: vi.fn(),
    },
  }
}

function createOllama(apiKey: string, apiRequest: ModelDependencies['request']['apiRequest']) {
  const model: ProviderModelInfo = { modelId: 'qwen3', type: 'chat' }
  return new Ollama(
    {
      apiKey,
      ollamaHost: 'https://ollama.example.test',
      model,
      stream: false,
    },
    createDependencies(apiRequest)
  )
}

describe('Ollama authentication', () => {
  it('sends the configured API key when listing remote models', async () => {
    const apiRequest = vi.fn((request) => {
      expect(request.url).toBe('https://ollama.example.test/v1/models')
      expect(request.headers).toMatchObject({ Authorization: 'Bearer secret-ollama-key' })
      return Promise.resolve(
        new Response(JSON.stringify({ object: 'list', data: [{ id: 'qwen3', object: 'model', created: 0 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    const models = await createOllama('secret-ollama-key', apiRequest).listModels()

    expect(models.map((model) => model.modelId)).toEqual(['qwen3'])
    expect(apiRequest).toHaveBeenCalledOnce()
  })

  it('keeps local passwordless Ollama compatible when the key is blank', async () => {
    const apiRequest = vi.fn((request) => {
      expect(request.headers).toMatchObject({ Authorization: 'Bearer ollama' })
      return Promise.resolve(
        new Response(JSON.stringify({ object: 'list', data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    await createOllama('', apiRequest).listModels()

    expect(apiRequest).toHaveBeenCalledOnce()
  })
})
