import { getModel, getProviderSettings } from '@shared/models'
import { createRerankClient } from '@shared/models/rerank'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import { resolveEffectiveApiKey } from '@shared/oauth'
import type { Config, ProviderModelInfo, Settings } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { type EmbeddingModel, embed, jsonSchema, type ToolSet } from 'ai'

export type TestResult = {
  status: 'success' | 'error' | 'pending'
  error?: string
}

export type ModelTestState = {
  testing: boolean
  basicTest?: TestResult
  visionTest?: TestResult
  toolTest?: TestResult
}

export type TestModelOptions = {
  providerId: string
  modelId: string
  modelType?: ProviderModelInfo['type']
  settings: Settings
  configs: Config
  dependencies: ModelDependencies
  onStateChange?: (state: ModelTestState) => void
}

const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const testWeatherTools: CallChatCompletionOptions['tools'] = {
  get_weather: {
    description: 'Get the weather',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
      additionalProperties: false,
    }),
    execute: async () => ({ temperature: 72, condition: 'sunny' }),
  },
} satisfies ToolSet

/**
 * Test a model's capabilities
 * @returns The final test state
 */
export async function testModelCapabilities(options: TestModelOptions): Promise<ModelTestState> {
  const { providerId, modelId, modelType = 'chat', settings, configs, dependencies, onStateChange } = options
  const isChatModel = modelType === 'chat'

  let state: ModelTestState = {
    testing: true,
    basicTest: { status: 'pending' },
    ...(isChatModel && {
      visionTest: { status: 'pending' as const },
      toolTest: { status: 'pending' as const },
    }),
  }

  onStateChange?.(state)

  try {
    let modelInstance: ModelInterface | undefined
    if (modelType === 'rerank') {
      state = await testRerankRequest(providerId, modelId, settings, dependencies, state)
    } else {
      modelInstance = getModel({ ...settings, provider: providerId, modelId }, settings, configs, dependencies)

      if (modelType === 'embedding') {
        state = await testEmbeddingRequest(modelInstance, state)
      } else if (modelType === 'image') {
        state = await testImageRequest(modelInstance, state)
      } else {
        state = await testBasicRequest(modelInstance, state)
      }
    }
    onStateChange?.({ ...state })

    if (isChatModel && modelInstance && state.basicTest?.status === 'success') {
      state = await testVisionRequest(modelInstance, state)
      onStateChange?.({ ...state })
    }

    if (isChatModel && modelInstance && state.basicTest?.status === 'success') {
      state = await testToolUseRequest(modelInstance, state)
      onStateChange?.({ ...state })
    }
    state = { ...state, testing: false }
    onStateChange?.({ ...state })
  } catch (e: unknown) {
    state = { ...state, testing: false, basicTest: { status: 'error', error: String(e) } }
    onStateChange?.({ ...state })
  }
  return state
}

async function testEmbeddingRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    const getEmbeddingModel = (
      modelInstance as unknown as {
        getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel | null
      }
    ).getTextEmbeddingModel
    const embeddingModel = getEmbeddingModel?.call(modelInstance, {})
    if (!embeddingModel) throw new Error(`Model ${modelInstance.modelId} does not support text embeddings`)
    await embed({ model: embeddingModel, value: 'NucWise AI connection test' })
    return { ...state, basicTest: { status: 'success' } }
  } catch (e: unknown) {
    return { ...state, basicTest: { status: 'error', error: getErrorMessage(e) } }
  }
}

async function testRerankRequest(
  providerId: string,
  modelId: string,
  settings: Settings,
  dependencies: ModelDependencies,
  state: ModelTestState
): Promise<ModelTestState> {
  try {
    const sessionSettings = { ...settings, provider: providerId, modelId }
    const { providerSetting, formattedApiHost } = getProviderSettings(sessionSettings, settings)
    const token = resolveEffectiveApiKey(providerSetting, dependencies.platformType || 'desktop')
    if (!token) throw new Error(`Missing API Key for rerank provider: ${providerId}`)
    const client = createRerankClient(formattedApiHost, token)
    await client.rerank({
      model: modelId,
      query: 'NucWise AI',
      documents: ['NucWise AI desktop assistant', 'unrelated text'],
      topN: 1,
    })
    return { ...state, basicTest: { status: 'success' } }
  } catch (e: unknown) {
    return { ...state, basicTest: { status: 'error', error: getErrorMessage(e) } }
  }
}

async function testImageRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.paint({ prompt: 'A simple blue circle', num: 1 })
    return { ...state, basicTest: { status: 'success' } }
  } catch (e: unknown) {
    return { ...state, basicTest: { status: 'error', error: getErrorMessage(e) } }
  }
}

function getErrorMessage(e: unknown) {
  const error = e as { responseBody?: string; message?: string }
  return error?.responseBody || error?.message || String(e)
}

async function testBasicRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat([{ role: 'user', content: 'Hi' }], { onResultChange: undefined })

    return { ...state, basicTest: { status: 'success' } }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }
    return {
      ...state,
      basicTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}

async function testVisionRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What color is in this image?' },
            { type: 'image', image: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
          ],
        },
      ],
      { onResultChange: () => {} }
    )
    return {
      ...state,
      visionTest: { status: 'success' },
    }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }

    return {
      ...state,
      visionTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}

async function testToolUseRequest(modelInstance: ModelInterface, state: ModelTestState): Promise<ModelTestState> {
  try {
    await modelInstance.chat([{ role: 'user', content: 'What is the weather in San Francisco?' }], {
      tools: testWeatherTools,
      onResultChange: () => {},
      maxSteps: 1,
    })
    return { ...state, toolTest: { status: 'success' } }
  } catch (e: unknown) {
    const error = e as { responseBody?: string; message?: string }
    return {
      ...state,
      toolTest: {
        status: 'error',
        error: error?.responseBody || error?.message || String(e),
      },
    }
  }
}
