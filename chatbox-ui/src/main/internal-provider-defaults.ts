import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { ModelProviderEnum, ModelProviderType, ProviderModelInfoSchema, type Settings } from '../shared/types'

export const INTERNAL_PROVIDER_DEFAULTS_FILENAME = 'nucwise-provider.defaults.json'

const InternalProviderDefaultsSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(ModelProviderType).default(ModelProviderType.OpenAI),
  isCustom: z.literal(true).optional().default(true),
  iconUrl: z.string().optional(),
  urls: z
    .object({
      website: z.string().optional(),
      apiKey: z.string().optional(),
      docs: z.string().optional(),
      models: z.string().optional(),
    })
    .optional(),
  settings: z.object({
    apiHost: z
      .string()
      .trim()
      .min(1)
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol
          return protocol === 'http:' || protocol === 'https:'
        } catch {
          return false
        }
      }, 'apiHost must be an http(s) URL'),
    apiPath: z.string().trim().optional().default('/chat/completions'),
    apiKey: z.string().optional().default(''),
    models: z
      .array(ProviderModelInfoSchema)
      .min(1)
      .refine((models) => models.some((model) => model.modelId.trim().length > 0), 'at least one model is required'),
  }),
  defaultModel: z.string().trim().optional(),
  defaultEmbeddingModel: z.string().trim().optional(),
  defaultRerankModel: z.string().trim().optional(),
  apply: z.enum(['if-empty', 'always']).optional().default('if-empty'),
})

export type InternalProviderDefaults = z.infer<typeof InternalProviderDefaultsSchema>

export function parseInternalProviderDefaults(value: unknown): InternalProviderDefaults | null {
  const parsed = InternalProviderDefaultsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Copy the packaged defaults beside a portable executable on first launch.
 * An existing external file always wins and is never overwritten.
 */
export function materializePackagedInternalProviderDefaults(): string | null {
  if (!process.resourcesPath) return null

  const embeddedPath = path.join(process.resourcesPath, INTERNAL_PROVIDER_DEFAULTS_FILENAME)
  try {
    const stat = fs.statSync(embeddedPath)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    if (!parseInternalProviderDefaults(JSON.parse(fs.readFileSync(embeddedPath, 'utf8')))) return null
  } catch {
    return null
  }

  const targetDirectory = process.env.PORTABLE_EXECUTABLE_FILE
    ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE)
    : app.getPath('userData')
  const targetPath = path.join(targetDirectory, INTERNAL_PROVIDER_DEFAULTS_FILENAME)

  try {
    if (fs.existsSync(targetPath)) return targetPath
    fs.copyFileSync(embeddedPath, targetPath, fs.constants.COPYFILE_EXCL)
    return targetPath
  } catch {
    // Read-only or restricted install directories fall back to the embedded resource.
    return null
  }
}

export function internalProviderDefaultsPaths(): string[] {
  const candidates = [
    path.join(app.getPath('userData'), INTERNAL_PROVIDER_DEFAULTS_FILENAME),
    path.join(path.dirname(process.execPath), INTERNAL_PROVIDER_DEFAULTS_FILENAME),
  ]

  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    candidates.splice(
      1,
      0,
      path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), INTERNAL_PROVIDER_DEFAULTS_FILENAME)
    )
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, INTERNAL_PROVIDER_DEFAULTS_FILENAME))
  }

  if (!app.isPackaged) {
    candidates.push(path.join(app.getAppPath(), INTERNAL_PROVIDER_DEFAULTS_FILENAME))
  }

  return [...new Set(candidates)]
}

export function loadInternalProviderDefaults(): { config: InternalProviderDefaults; sourcePath: string } | null {
  for (const candidate of internalProviderDefaultsPaths()) {
    try {
      const stat = fs.statSync(candidate)
      if (!stat.isFile() || stat.size > 1024 * 1024) continue
      const parsed = parseInternalProviderDefaults(JSON.parse(fs.readFileSync(candidate, 'utf8')))
      if (parsed) return { config: parsed, sourcePath: candidate }
    } catch {
      // Missing or invalid optional defaults must not prevent the app from starting.
    }
  }
  return null
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

export function mergeInternalProviderDefaults(current: Settings, config: InternalProviderDefaults): Settings {
  const providerId = config.id
  const force = config.apply === 'always'
  const existingSettings = current.providers?.[providerId]
  const nextSettings = {
    ...(existingSettings || {}),
    apiHost: force || isEmpty(existingSettings?.apiHost) ? config.settings.apiHost : existingSettings?.apiHost,
    apiPath: force || isEmpty(existingSettings?.apiPath) ? config.settings.apiPath : existingSettings?.apiPath,
    apiKey: force || isEmpty(existingSettings?.apiKey) ? config.settings.apiKey : existingSettings?.apiKey,
    models: force || !existingSettings?.models?.length ? config.settings.models : existingSettings.models,
  }

  const next: Settings = {
    ...current,
    providers: {
      ...(current.providers || {}),
      [providerId]: nextSettings,
    },
  }

  const isBuiltin =
    providerId !== ModelProviderEnum.Custom &&
    Object.values(ModelProviderEnum).includes(providerId as ModelProviderEnum)
  if (!isBuiltin) {
    const providerInfo = {
      id: providerId,
      name: config.name,
      type: config.type,
      iconUrl: config.iconUrl,
      urls: config.urls,
      isCustom: true as const,
    }
    const existingCustomProviders = current.customProviders || []
    next.customProviders = existingCustomProviders.some((provider) => provider.id === providerId)
      ? existingCustomProviders.map((provider) =>
          provider.id === providerId && force ? { ...provider, ...providerInfo } : provider
        )
      : [...existingCustomProviders, providerInfo]
  }

  const defaultModel = config.defaultModel || config.settings.models.find((model) => model.type === 'chat')?.modelId
  if (defaultModel && (force || !current.defaultChatModel?.provider || !current.defaultChatModel?.model)) {
    next.defaultChatModel = { provider: providerId, model: defaultModel }
  }

  const defaultRetrievalModels = [
    ['embedding', config.defaultEmbeddingModel],
    ['rerank', config.defaultRerankModel],
  ] as const
  if (defaultRetrievalModels.some(([, modelId]) => modelId)) {
    const currentKnowledgeBase = current.extension?.knowledgeBase
    const currentModels = currentKnowledgeBase?.models || {}
    const nextModels = { ...currentModels }
    for (const [kind, modelId] of defaultRetrievalModels) {
      if (modelId && (force || !currentModels[kind])) {
        nextModels[kind] = { providerId, modelId }
      }
    }
    next.extension = {
      ...current.extension,
      knowledgeBase: {
        ...(currentKnowledgeBase || {}),
        contextCharacterBudget: currentKnowledgeBase?.contextCharacterBudget || 128_000,
        models: nextModels,
      },
    }
  }

  return next
}
