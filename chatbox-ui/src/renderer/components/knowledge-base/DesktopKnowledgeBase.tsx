import { Alert, Badge, Button, Group, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import type { DifyProfile } from '@shared/dify'
import type { KnowledgeBase, ProviderModelInfo } from '@shared/types'
import { IconBook2, IconCloud, IconPlus, IconSettings, IconTrash } from '@tabler/icons-react'
import compact from 'lodash/compact'
import flatten from 'lodash/flatten'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/layout/Overlay'
import { useProviders } from '@/hooks/useProviders'
import { navigateToSettings } from '@/modals/Settings'
import { difyClient } from '@/packages/dify/client'
import { runDifyKnowledgeWorkflow } from '@/packages/dify-knowledge'
import { toastError } from '@/packages/toast'
import platform from '@/platform'
import { AddProviderModal } from '@/components/settings/provider/AddProviderModal'
import { useSettingsStore } from '@/stores/settingsStore'
import PopoverConfirm from '../common/PopoverConfirm'
import { ScalableIcon } from '../common/ScalableIcon'
import KnowledgeBaseDocuments from './KnowledgeBaseDocuments'

export default function DesktopKnowledgeBasePage() {
  const { providers } = useProviders()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const knowledgeBaseSettings = useSettingsStore((state) => state.extension?.knowledgeBase)
  const savedDify = useSettingsStore((state) => state.difyKnowledge)
  const [dify, setDify] = useState(
    savedDify || {
      enabled: false,
      name: 'Dify 知识工作流',
      profileId: '',
      baseUrl: 'https://api.dify.ai/v1',
      apiKey: '',
      inputVariable: 'query',
      outputVariable: '',
      user: 'desktop-assistant',
    }
  )
  const [testingDify, setTestingDify] = useState(false)
  const [difyProfiles, setDifyProfiles] = useState<DifyProfile[]>([])
  const [difyResult, setDifyResult] = useState<string | null>(null)
  const [kbList, setKbList] = useState<KnowledgeBase[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null)
  const [rerankModel, setRerankModel] = useState<string | null>(null)
  const [visionModel, setVisionModel] = useState<string | null>(null)
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null)
  const [editingRerankModel, setEditingRerankModel] = useState<string | null>(null)
  const [showProviderSetup, setShowProviderSetup] = useState(false)

  const controller = useMemo(() => platform.getKnowledgeBaseController(), [])
  const refresh = useCallback(async () => {
    try {
      setKbList((await controller.list()) || [])
    } catch (error) {
      toastError(`读取本地知识库失败：${error}`)
    }
  }, [controller])

  useEffect(() => {
    void refresh()
    void difyClient.listProfiles().then(setDifyProfiles)
  }, [refresh])

  const modelOptions = useCallback(
    (predicate: (model: ProviderModelInfo) => boolean) =>
      compact(
        flatten(
          providers.map((provider) =>
            provider.models?.filter(predicate).map((model) => ({
              label: `${provider.name} | ${model.nickname || model.modelId}`,
              value: `${provider.id}:${model.modelId}`,
            }))
          )
        )
      ),
    [providers]
  )
  const embeddingOptions = useMemo(() => modelOptions((model) => model.type === 'embedding'), [modelOptions])
  const rerankOptions = useMemo(() => modelOptions((model) => model.type === 'rerank'), [modelOptions])
  const visionOptions = useMemo(() => modelOptions((model) => !!model.capabilities?.includes('vision')), [modelOptions])
  const contextCharacterBudget = knowledgeBaseSettings?.contextCharacterBudget || 128_000
  const toModelValue = (model: { providerId: string; modelId: string } | null | undefined) =>
    model ? `${model.providerId}:${model.modelId}` : null
  const globalEmbeddingModel = toModelValue(knowledgeBaseSettings?.models?.embedding)
  const globalRerankModel = toModelValue(knowledgeBaseSettings?.models?.rerank)

  const setGlobalRetrievalModel = (kind: 'embedding' | 'rerank', value: string | null) => {
    const separatorIndex = value?.indexOf(':') ?? -1
    const model =
      value && separatorIndex > 0
        ? { providerId: value.slice(0, separatorIndex), modelId: value.slice(separatorIndex + 1) }
        : null
    setSettings((settings) => {
      settings.extension = {
        ...(settings.extension || {}),
        knowledgeBase: {
          ...(settings.extension?.knowledgeBase || { models: {}, contextCharacterBudget: 128_000 }),
          contextCharacterBudget: settings.extension?.knowledgeBase?.contextCharacterBudget || 128_000,
          models: {
            ...(settings.extension?.knowledgeBase?.models || {}),
            [kind]: model,
          },
        },
      }
    })
  }

  const setContextCharacterBudget = (value: string | null) => {
    const next = Number(value)
    if (!Number.isFinite(next)) return
    setSettings((settings) => {
      settings.extension = {
        ...(settings.extension || {}),
        knowledgeBase: {
          ...(settings.extension?.knowledgeBase || { models: {} }),
          contextCharacterBudget: next,
        },
      }
    })
  }

  const saveDify = () => {
    setSettings({ difyKnowledge: dify })
    setDifyResult('配置已保存。启用后可在聊天输入框的知识库按钮中选择该工作流。')
  }

  const testDify = async () => {
    setTestingDify(true)
    setDifyResult(null)
    try {
      const result = await runDifyKnowledgeWorkflow(dify, '这是一次连接测试，请返回简短的成功信息。')
      setDifyResult(`连接成功：${result.slice(0, 240)}`)
    } catch (error) {
      setDifyResult(`连接失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTestingDify(false)
    }
  }

  const createLocalKnowledgeBase = async () => {
    if (!name.trim() || !embeddingModel) return
    try {
      await controller.create({
        name: name.trim(),
        embeddingModel,
        rerankModel: rerankModel || '',
        visionModel: visionModel || '',
        documentParser: { type: 'local' },
        providerMode: 'custom',
      })
      setName('')
      setEmbeddingModel(null)
      setRerankModel(null)
      setVisionModel(null)
      setShowCreate(false)
      await refresh()
    } catch (error) {
      toastError(`创建本地知识库失败：${error}`)
    }
  }

  const deleteKnowledgeBase = async (kb: KnowledgeBase) => {
    try {
      await controller.delete(kb.id)
      await refresh()
    } catch (error) {
      toastError(`删除知识库失败：${error}`)
    }
  }

  const openRetrievalSettings = (kb: KnowledgeBase) => {
    setEditingKb(kb)
    setEditingRerankModel(kb.rerankModel || null)
  }

  const saveRetrievalSettings = async () => {
    if (!editingKb) return
    try {
      await controller.update({ id: editingKb.id, rerankModel: editingRerankModel || '' })
      setEditingKb(null)
      setEditingRerankModel(null)
      await refresh()
    } catch (error) {
      toastError(`保存检索模型失败：${error}`)
    }
  }

  return (
    <Stack p="md" gap="xl">
      <Stack gap={4}>
        <Title order={4}>知识库</Title>
        <Text size="sm" c="dimmed">
          可使用完全本地的文件知识库，也可把现有 Dify 知识库工作流作为对话上下文来源。
        </Text>
      </Stack>

      <Alert color="indigo" title="桌面划词助手已集成">
        选中任意软件中的文字后按 Ctrl+Alt+Space，即可使用总结、回复、代写、润色等 Dify 动作；托盘助手随本程序自动启动。
      </Alert>

      <Paper withBorder p="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <Group gap="xs">
              <ScalableIcon icon={IconCloud} size={22} />
              <Title order={5}>Dify 知识工作流</Title>
            </Group>
            <Switch
              label="启用"
              checked={dify.enabled}
              onChange={(event) => setDify({ ...dify, enabled: event.currentTarget.checked })}
            />
          </Group>
          <TextInput
            label="显示名称"
            value={dify.name}
            onChange={(event) => setDify({ ...dify, name: event.currentTarget.value })}
          />
          <Select
            label="Dify Workflow 配置"
            description="地址和 API Key 统一在“Dify 工作流”中管理"
            placeholder="选择一个 Workflow"
            value={dify.profileId || null}
            data={difyProfiles
              .filter((profile) => profile.appType === 'workflow')
              .map((profile) => ({
                value: profile.id,
                label: `${profile.name}${profile.hasApiKey ? '' : '（缺少 API Key）'}`,
              }))}
            onChange={(value) => setDify({ ...dify, profileId: value || '' })}
          />
          {difyProfiles.length === 0 && <Alert color="orange">请先在左侧“Dify 工作流”页面新增应用配置。</Alert>}
          <Group grow align="start">
            <TextInput
              label="查询输入变量"
              description="对应 Dify Start 节点变量名"
              value={dify.inputVariable}
              onChange={(event) => setDify({ ...dify, inputVariable: event.currentTarget.value })}
            />
            <TextInput
              label="结果输出变量（可选）"
              description="留空时自动读取第一个文本输出"
              value={dify.outputVariable}
              onChange={(event) => setDify({ ...dify, outputVariable: event.currentTarget.value })}
            />
          </Group>
          <Group justify="flex-end">
            <Button variant="default" loading={testingDify} onClick={() => void testDify()}>
              测试连接
            </Button>
            <Button onClick={saveDify}>保存 Dify 配置</Button>
          </Group>
          {difyResult && <Alert color={difyResult.startsWith('连接失败') ? 'red' : 'green'}>{difyResult}</Alert>}
        </Stack>
      </Paper>

      <Group justify="space-between">
        <Group gap="xs">
          <ScalableIcon icon={IconBook2} size={22} />
          <Title order={5}>本地文件知识库</Title>
        </Group>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setShowCreate(true)}>
          新建知识库
        </Button>
      </Group>

      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={6}>
            <Text fw={600}>检索模型选择（全局）</Text>
            <Text size="sm" c="dimmed">
              模型服务统一在“模型与服务”中维护；这里仅选择要用于大文件本地检索的 Embedding 与 Rerank 模型。
            </Text>
            <Group gap="xs">
              <Badge color={embeddingOptions.length ? 'green' : 'orange'} variant="light">
                Embedding：{embeddingOptions.length} 个可用
              </Badge>
              <Badge color={rerankOptions.length ? 'green' : 'gray'} variant="light">
                Rerank：{rerankOptions.length} 个可用
              </Badge>
              <Badge color="indigo" variant="light">
                上下文预算：约 {contextCharacterBudget.toLocaleString()} 字符
              </Badge>
            </Group>
          </Stack>
          <Stack gap="xs">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setShowProviderSetup(true)}>
              统一模型配置
            </Button>
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconSettings size={14} />}
              onClick={() => navigateToSettings('/provider')}
            >
              查看全部模型服务
            </Button>
          </Stack>
        </Group>
        <Group grow mt="md" align="flex-start">
          <Select
            label="Embedding 模型"
            description="必选。配置后，大文件附件可建立本地向量索引。"
            data={embeddingOptions}
            value={globalEmbeddingModel}
            onChange={(value) => setGlobalRetrievalModel('embedding', value)}
            searchable
            placeholder={embeddingOptions.length ? '选择 Embedding 模型' : '请先新增 Embedding 模型'}
          />
          <Select
            label="Rerank 模型（可选）"
            description="推荐。用于对召回结果进行二次排序。"
            data={rerankOptions}
            value={globalRerankModel}
            onChange={(value) => setGlobalRetrievalModel('rerank', value)}
            searchable
            clearable
            placeholder={rerankOptions.length ? '选择 Rerank 模型' : '请先新增 Rerank 模型'}
          />
        </Group>
        <Select
          mt="md"
          label="知识库上下文预算"
          description="控制每次检索可注入模型的最大文本量。较大预算适合本地长上下文模型，但会增加响应时间与显存占用。"
          value={String(contextCharacterBudget)}
          onChange={setContextCharacterBudget}
          data={[
            { value: '48000', label: '48,000 字符（节省资源）' },
            { value: '128000', label: '128,000 字符（推荐）' },
            { value: '256000', label: '256,000 字符（本地长上下文）' },
            { value: '512000', label: '512,000 字符（高显存 / 超长上下文）' },
          ]}
        />
      </Paper>

      {embeddingOptions.length === 0 && (
        <Alert color="blue" title="需要向量模型">
          请先在“模型提供方”中新增模型，并把“模型类型”设为 Embedding；文档解析和索引均在本机完成。
        </Alert>
      )}

      {embeddingOptions.length > 0 && rerankOptions.length === 0 && (
        <Alert color="gray" title="尚未配置 Rerank（可选但推荐）">
          当前会使用向量相似度动态筛选并最多返回 8 个片段。添加 Rerank 模型后，将从 20 个候选中精排出 5
          个片段，通常能进一步降低无关上下文。
        </Alert>
      )}

      {kbList.length === 0 ? (
        <Paper withBorder p="xl" ta="center">
          <Text fw={500}>还没有本地知识库</Text>
          <Text size="sm" c="dimmed" mt="xs">
            创建后可自由添加 PDF、Word、PowerPoint、Excel、Markdown、TXT 等本地文件。
          </Text>
        </Paper>
      ) : (
        kbList.map((kb) => (
          <Paper key={kb.id} withBorder p="md">
            <Stack gap="md">
              <Group justify="space-between">
                <Stack gap={2}>
                  <Text fw={600}>{kb.name}</Text>
                  <Text size="xs" c="dimmed">
                    Embedding：{kb.embeddingModel}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Rerank：{kb.rerankModel || '未配置（动态阈值，最多 8 个片段）'}
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Button
                    variant="subtle"
                    leftSection={<IconSettings size={16} />}
                    onClick={() => openRetrievalSettings(kb)}
                  >
                    检索模型
                  </Button>
                  <PopoverConfirm
                    title={`确认删除知识库“${kb.name}”及其全部本地索引？`}
                    confirmButtonColor="red"
                    onConfirm={() => void deleteKnowledgeBase(kb)}
                  >
                    <Button color="red" variant="subtle" leftSection={<IconTrash size={16} />}>
                      删除
                    </Button>
                  </PopoverConfirm>
                </Group>
              </Group>
              <KnowledgeBaseDocuments knowledgeBase={kb} />
            </Stack>
          </Paper>
        ))
      )}

      <Modal opened={showCreate} onClose={() => setShowCreate(false)} title="新建本地知识库" centered>
        <Stack gap="md">
          <TextInput label="名称" value={name} onChange={(event) => setName(event.currentTarget.value)} autoFocus />
          <Select
            label="Embedding 模型"
            description="必选。创建后会锁定；更换模型需要重建知识库索引。"
            data={embeddingOptions}
            value={embeddingModel}
            onChange={setEmbeddingModel}
            searchable
            required
          />
          <Select
            label="Rerank 模型（可选）"
            description="推荐配置：先召回 20 个候选，再精排并仅注入最相关的 5 个片段。"
            data={rerankOptions}
            value={rerankModel}
            onChange={setRerankModel}
            searchable
            clearable
          />
          <Select
            label="图片理解模型（可选）"
            data={visionOptions}
            value={visionModel}
            onChange={setVisionModel}
            searchable
            clearable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button disabled={!name.trim() || !embeddingModel} onClick={() => void createLocalKnowledgeBase()}>
              创建
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!editingKb}
        onClose={() => setEditingKb(null)}
        title={`检索模型 · ${editingKb?.name || ''}`}
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Embedding 模型（已锁定）"
            description="现有向量索引由该模型生成。若要更换，请新建知识库并重新导入文件。"
            value={editingKb?.embeddingModel || ''}
            readOnly
          />
          <Select
            label="Rerank 模型（可选）"
            description="可随时更换或清除，不需要重建 Embedding 索引。"
            data={rerankOptions}
            value={editingRerankModel}
            onChange={setEditingRerankModel}
            searchable
            clearable
            placeholder={rerankOptions.length ? '选择 Rerank 模型' : '请先到模型提供方添加 Rerank 模型'}
          />
          <Group justify="space-between">
            <Button variant="subtle" onClick={() => navigateToSettings('/provider')}>
              管理模型提供方
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={() => setEditingKb(null)}>
                取消
              </Button>
              <Button onClick={() => void saveRetrievalSettings()}>保存</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <AddProviderModal opened={showProviderSetup} onClose={() => setShowProviderSetup(false)} />
    </Stack>
  )
}
