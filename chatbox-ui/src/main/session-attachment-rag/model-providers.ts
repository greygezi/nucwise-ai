import type { EmbeddingModel } from 'ai'
import { CohereClient } from 'cohere-ai'
import { getProviderSettings } from '../../shared/models'
import { parseKnowledgeBaseModelString } from '../../shared/utils/knowledge-base-model-parser'
import { sentry } from '../adapters/sentry'
import { cache } from '../cache'
import { getLogger } from '../util'
import { createEmbeddingProviderFromModelString } from '../knowledge-base/model-providers'
import { getSettings } from '../store-node'

const log = getLogger('session-attachment-rag:model-providers')

function resolveSessionAttachmentEmbeddingModel() {
  const settings = getSettings()
  const configured = settings.extension?.knowledgeBase?.models?.embedding
  if (configured) return `${configured.providerId}:${configured.modelId}`

  const fallback = Object.entries(settings.providers || {}).flatMap(([providerId, provider]) =>
    (provider.models || [])
      .filter((model) => model.type === 'embedding')
      .map((model) => `${providerId}:${model.modelId}`)
  )[0]
  if (fallback) return fallback

  throw new Error('未配置 Embedding 模型。请在“设置 → 知识库”中配置 Embedding 模型后再使用文件附件检索。')
}

export async function getSessionAttachmentEmbeddingProvider(): Promise<EmbeddingModel> {
  let modelString = ''
  try {
    modelString = resolveSessionAttachmentEmbeddingModel()
    return await createEmbeddingProviderFromModelString(modelString)
  } catch (error) {
    log.error(
      `[MODEL] Failed to resolve session attachment embedding provider: ${modelString}`,
      error
    )
    sentry.withScope((scope) => {
      scope.setTag('component', 'session-attachment-rag-model')
      scope.setTag('operation', 'get_embedding_provider')
      scope.setExtra('embeddingModel', modelString)
      sentry.captureException(error)
    })
    throw error
  }
}

export async function getSessionAttachmentRerankProvider(modelString?: string | null) {
  if (!modelString) {
    return null
  }

  return cache(
    `session-attachment-rag:rerank:${modelString}`,
    async () => {
      try {
        const parsed = parseKnowledgeBaseModelString(modelString)
        if (!parsed) {
          throw new Error(`Invalid rerank model format: ${modelString}`)
        }

        const { providerId, modelId } = parsed
        const settings = getSettings()
        const { providerSetting, formattedApiHost } = getProviderSettings(
          {
            ...settings,
            provider: providerId,
            modelId,
          },
          settings
        )

        const apiHost = formattedApiHost
        const token = providerSetting.apiKey

        if (!token) {
          throw new Error(`Missing token for rerank provider: ${providerId}`)
        }

        const client = new CohereClient({
          environment: apiHost,
          token,
        })
        return { client, modelId }
      } catch (error) {
        log.error(`[MODEL] Failed to resolve session attachment rerank provider: ${modelString}`, error)
        sentry.withScope((scope) => {
          scope.setTag('component', 'session-attachment-rag-model')
          scope.setTag('operation', 'get_rerank_provider')
          scope.setExtra('rerankModel', modelString)
          sentry.captureException(error)
        })
        throw error
      }
    },
    {
      ttl: 1000 * 60,
    }
  )
}
