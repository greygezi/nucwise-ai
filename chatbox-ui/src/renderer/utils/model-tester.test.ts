import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  getModel: vi.fn(),
  getProviderSettings: vi.fn(),
  resolveEffectiveApiKey: vi.fn(),
}))

vi.mock('@shared/models', () => ({
  getModel: mocks.getModel,
  getProviderSettings: mocks.getProviderSettings,
}))

vi.mock('@shared/oauth', () => ({
  resolveEffectiveApiKey: mocks.resolveEffectiveApiKey,
}))

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  embed: mocks.embed,
}))

import type { Config, Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { testModelCapabilities } from './model-tester'

const settings = { providers: {} } as Settings
const configs = {} as Config
const dependencies = { platformType: 'desktop' } as ModelDependencies

describe('testModelCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('uses the embeddings API for embedding models', async () => {
    const chat = vi.fn()
    const embeddingModel = {}
    mocks.getModel.mockReturnValue({
      modelId: 'embedding-model',
      chat,
      getTextEmbeddingModel: () => embeddingModel,
    })
    mocks.embed.mockResolvedValue({ embedding: [0.1] })

    const result = await testModelCapabilities({
      providerId: 'custom',
      modelId: 'embedding-model',
      modelType: 'embedding',
      settings,
      configs,
      dependencies,
    })

    expect(result.basicTest?.status).toBe('success')
    expect(mocks.embed).toHaveBeenCalledWith({ model: embeddingModel, value: 'NucWise AI connection test' })
    expect(chat).not.toHaveBeenCalled()
  })

  test('uses the rerank endpoint and sends the saved API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'test',
          results: [{ index: 0, relevance_score: 1 }],
          meta: { api_version: { version: '1' }, billed_units: { search_units: 1 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    mocks.getProviderSettings.mockReturnValue({
      providerSetting: { apiKey: 'saved-key' },
      formattedApiHost: 'https://models.internal/api/v1/rerank',
    })
    mocks.resolveEffectiveApiKey.mockReturnValue('saved-key')

    const result = await testModelCapabilities({
      providerId: 'custom',
      modelId: 'rerank-model',
      modelType: 'rerank',
      settings,
      configs,
      dependencies,
    })

    expect(result.basicTest?.status).toBe('success')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://models.internal/api/v1/rerank')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer saved-key')
    expect(mocks.getModel).not.toHaveBeenCalled()
  })
})
