import type { ProviderModelInfo } from '@shared/types'

const EMBEDDING_MODEL_HINTS = ['embed', 'bge', 'e5', 'gte', 'nomic', 'mxbai', 'snowflake-arctic']

export function isLikelyEmbeddingModel(modelId: string) {
  const normalized = modelId.toLowerCase()
  return EMBEDDING_MODEL_HINTS.some((hint) => normalized.includes(hint))
}

export function prepareOllamaModels(
  existingModels: ProviderModelInfo[],
  discoveredModels: ProviderModelInfo[],
  embeddingModelId: string
) {
  const models = new Map(existingModels.map((model) => [model.modelId, model]))

  for (const discovered of discoveredModels) {
    const existing = models.get(discovered.modelId)
    models.set(discovered.modelId, { ...discovered, ...existing })
  }

  const selected = models.get(embeddingModelId) || { modelId: embeddingModelId }
  models.set(embeddingModelId, { ...selected, type: 'embedding' })

  return Array.from(models.values())
}
