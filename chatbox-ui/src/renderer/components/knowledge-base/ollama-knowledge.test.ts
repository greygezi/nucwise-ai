import { describe, expect, it } from 'vitest'
import { isLikelyEmbeddingModel, prepareOllamaModels } from './ollama-knowledge'

describe('Ollama knowledge base setup', () => {
  it.each(['bge-m3:latest', 'nomic-embed-text', 'mxbai-embed-large', 'multilingual-e5-large'])(
    'recognizes common embedding model %s',
    (modelId) => {
      expect(isLikelyEmbeddingModel(modelId)).toBe(true)
    }
  )

  it('does not classify a normal chat model as embedding', () => {
    expect(isLikelyEmbeddingModel('deepseek-r1:14b')).toBe(false)
  })

  it('keeps existing model metadata and marks the selected model as embedding', () => {
    const result = prepareOllamaModels(
      [{ modelId: 'deepseek-r1:14b', type: 'chat', nickname: 'DeepSeek' }],
      [
        { modelId: 'deepseek-r1:14b', type: 'chat' },
        { modelId: 'bge-m3:latest', type: 'chat' },
      ],
      'bge-m3:latest'
    )

    expect(result).toEqual([
      { modelId: 'deepseek-r1:14b', type: 'chat', nickname: 'DeepSeek' },
      { modelId: 'bge-m3:latest', type: 'embedding' },
    ])
  })
})
