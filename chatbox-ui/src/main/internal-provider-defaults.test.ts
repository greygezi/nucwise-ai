import { describe, expect, it, vi } from 'vitest'
import * as defaults from '../shared/defaults'
import { SettingsSchema } from '../shared/types'
import { mergeInternalProviderDefaults, parseInternalProviderDefaults } from './internal-provider-defaults'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/Users/test/AppData/Roaming/NucWise AI',
    getAppPath: () => 'C:/app',
    isPackaged: true,
  },
}))

const config = parseInternalProviderDefaults({
  id: 'nucwise-internal',
  name: '内网模型',
  type: 'openai',
  settings: {
    apiHost: 'http://10.0.0.8:8000/v1',
    apiKey: 'deployment-key',
    models: [
      { modelId: 'internal-chat', type: 'chat' },
      { modelId: 'internal-embedding', type: 'embedding' },
      { modelId: 'internal-rerank', type: 'rerank' },
      { modelId: 'internal-vision', type: 'chat', capabilities: ['vision'] },
    ],
  },
  defaultEmbeddingModel: 'internal-embedding',
  defaultRerankModel: 'internal-rerank',
})

describe('internal provider defaults', () => {
  it('validates and seeds a custom provider and default chat model', () => {
    if (!config) throw new Error('test config should be valid')
    const result = mergeInternalProviderDefaults(SettingsSchema.parse(defaults.settings()), config)

    expect(result.customProviders?.[0]).toMatchObject({ id: 'nucwise-internal', name: '内网模型', isCustom: true })
    expect(result.providers?.['nucwise-internal']).toMatchObject({
      apiHost: 'http://10.0.0.8:8000/v1',
      apiKey: 'deployment-key',
      models: [
        { modelId: 'internal-chat', type: 'chat' },
        { modelId: 'internal-embedding', type: 'embedding' },
        { modelId: 'internal-rerank', type: 'rerank' },
        { modelId: 'internal-vision', type: 'chat', capabilities: ['vision'] },
      ],
    })
    expect(result.defaultChatModel).toEqual({ provider: 'nucwise-internal', model: 'internal-chat' })
    expect(result.extension.knowledgeBase?.models).toEqual({
      embedding: { providerId: 'nucwise-internal', modelId: 'internal-embedding' },
      rerank: { providerId: 'nucwise-internal', modelId: 'internal-rerank' },
    })
    expect(() => SettingsSchema.parse(result)).not.toThrow()
  })

  it('keeps user values for if-empty defaults and supports forced upgrades', () => {
    if (!config) throw new Error('test config should be valid')
    const current = SettingsSchema.parse({
      ...defaults.settings(),
      providers: {
        'nucwise-internal': {
          apiHost: 'http://user-edited:9000/v1',
          apiKey: 'user-key',
          models: [{ modelId: 'user-model', type: 'chat' }],
        },
      },
      customProviders: [{ id: 'nucwise-internal', name: '用户名称', type: 'openai', isCustom: true }],
      defaultChatModel: { provider: 'nucwise-internal', model: 'user-model' },
    })

    const preserved = mergeInternalProviderDefaults(current, config)
    expect(preserved.providers?.['nucwise-internal']?.apiHost).toBe('http://user-edited:9000/v1')
    expect(preserved.providers?.['nucwise-internal']?.models?.[0].modelId).toBe('user-model')
    expect(preserved.extension.knowledgeBase?.models).toEqual({
      embedding: { providerId: 'nucwise-internal', modelId: 'internal-embedding' },
      rerank: { providerId: 'nucwise-internal', modelId: 'internal-rerank' },
    })

    const forced = mergeInternalProviderDefaults(current, { ...config, apply: 'always' })
    expect(forced.providers?.['nucwise-internal']?.apiHost).toBe('http://10.0.0.8:8000/v1')
    expect(forced.providers?.['nucwise-internal']?.apiKey).toBe('deployment-key')
    expect(forced.defaultChatModel).toEqual({ provider: 'nucwise-internal', model: 'internal-chat' })
    expect(forced.extension.knowledgeBase?.models).toEqual({
      embedding: { providerId: 'nucwise-internal', modelId: 'internal-embedding' },
      rerank: { providerId: 'nucwise-internal', modelId: 'internal-rerank' },
    })
  })
})
