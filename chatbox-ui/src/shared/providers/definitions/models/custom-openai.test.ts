import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, test } from 'vitest'
import CustomOpenAI from './custom-openai'

describe('CustomOpenAI embedding endpoint', () => {
  test.each(['', '/'])('accepts a full embeddings endpoint when the saved path is %j', (apiPath) => {
    const model = new CustomOpenAI(
      {
        apiKey: 'test-key',
        apiHost: 'https://api.jina.ai/v1/embeddings',
        apiPath,
        model: { modelId: 'jina-embeddings-v5-omni-small', type: 'embedding' },
      },
      {} as ModelDependencies
    )

    expect(model.options.apiHost).toBe('https://api.jina.ai/v1')
    expect(model.options.apiPath).toBe('/embeddings')
  })
})
