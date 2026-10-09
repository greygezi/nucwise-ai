import { Button, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { ModelProviderType, type ProviderModelInfo } from '@shared/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useSettingsStore } from '@/stores/settingsStore'

interface AddProviderModalProps {
  opened: boolean
  onClose: () => void
}

export function AddProviderModal({ opened, onClose }: AddProviderModalProps) {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const customProviders = useSettingsStore((s) => s.customProviders)
  const providers = useSettingsStore((s) => s.providers)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderMode, setNewProviderMode] = useState<ModelProviderType>(ModelProviderType.OpenAI)
  const [apiHost, setApiHost] = useState('')
  const [apiPath, setApiPath] = useState('/chat/completions')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [modelType, setModelType] = useState<NonNullable<ProviderModelInfo['type']>>('embedding')

  const handleAddProvider = () => {
    const pid = `custom-provider-${uuidv4()}`
    setSettings({
      customProviders: [
        ...(customProviders || []),
        {
          id: pid,
          name: newProviderName,
          type: newProviderMode,
          isCustom: true,
        },
      ],
      providers: {
        ...(providers || {}),
        [pid]: {
          apiHost: apiHost.trim(),
          apiPath: apiPath.trim(),
          apiKey: apiKey.trim(),
          models: [{ modelId: modelId.trim(), type: modelType }],
        },
      },
    })
    onClose()
    setNewProviderName('')
    setApiHost('')
    setApiPath('/chat/completions')
    setApiKey('')
    setModelId('')
  }

  return (
    <AdaptiveModal size="sm" opened={opened} onClose={onClose} centered title="新增自定义模型服务">
      <Stack gap="xs">
        <Text size="sm" c="chatbox-tertiary">
          这里与“模型与服务”中的 DeepSeek、Ollama、OpenAI
          属于同一套配置。仅在服务未预置时新增；已有服务请直接到“模型与服务”中编辑，无需重复创建。
        </Text>
        <Text>{t('Name')}</Text>
        <TextInput
          value={newProviderName}
          onChange={(e) => setNewProviderName(e.currentTarget.value)}
          required
          error={!newProviderName.trim() ? t('Name is required') : ''}
        />
        <Text>{t('API Mode')}</Text>
        <AdaptiveSelect
          value={newProviderMode}
          classNames={{ dropdown: 'pointer-events-auto' }}
          onChange={(value) => setNewProviderMode(value as ModelProviderType)}
          data={[
            {
              value: ModelProviderType.OpenAI,
              label: t('OpenAI API Compatible'),
            },
            {
              value: ModelProviderType.OpenAIResponses,
              label: t('OpenAI Responses API Compatible'),
            },
            {
              value: ModelProviderType.Claude,
              label: t('Claude API Compatible'),
            },
            {
              value: ModelProviderType.Gemini,
              label: t('Google Gemini API Compatible'),
            },
          ]}
        />
        <TextInput
          label="API 服务地址"
          description="填写服务基础地址。OpenAI 兼容服务通常需要包含 /v1。"
          placeholder="例如：http://192.168.1.100:8000/v1"
          value={apiHost}
          onChange={(e) => setApiHost(e.currentTarget.value)}
          required
          error={!apiHost.trim() ? '服务地址是必填项' : ''}
        />
        <TextInput
          label="对话接口路径"
          description="仅 Chat 模型使用；Embedding 和 Rerank 会调用各自的标准接口。"
          value={apiPath}
          onChange={(e) => setApiPath(e.currentTarget.value)}
        />
        <PasswordInput
          label="API Key（本地免密服务可留空）"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />
        <TextInput
          label="模型名称"
          placeholder="例如：bge-m3、nomic-embed-text、bge-reranker-v2-m3"
          value={modelId}
          onChange={(e) => setModelId(e.currentTarget.value)}
          required
          error={!modelId.trim() ? '模型名称是必填项' : ''}
        />
        <Select
          label="模型类型"
          value={modelType}
          onChange={(value) => setModelType((value || 'embedding') as NonNullable<ProviderModelInfo['type']>)}
          data={[
            { value: 'embedding', label: 'Embedding（向量模型）' },
            { value: 'rerank', label: 'Rerank（重排序模型）' },
            { value: 'chat', label: 'Chat（对话模型）' },
            { value: 'image', label: 'Image（图像模型）' },
          ]}
        />
        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose} />
          <Button onClick={handleAddProvider} disabled={!newProviderName.trim() || !apiHost.trim() || !modelId.trim()}>
            保存服务与模型
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
