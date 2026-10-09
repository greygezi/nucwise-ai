import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  DESKTOP_ASSISTANT_DEFAULT_CHAT,
  type DifyHistoryEntry,
  type DifyProfile,
  type DifyProfileInput,
} from '@shared/dify'
import { IconCopy, IconHistory, IconMessageCircle, IconPlus, IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { difyClient } from '@/packages/dify/client'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { resolvePreferredChatModel } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'

const emptyProfile: DifyProfileInput = {
  name: '新工作流',
  baseUrl: 'https://api.dify.ai/v1',
  appType: 'workflow',
  verifyTls: true,
  apiKey: '',
}

export default function DifyWorkflowWorkbench() {
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)
  const lastUsedChatModel = useStore(lastUsedModelStore, (state) => state.chat)
  const [profiles, setProfiles] = useState<DifyProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<DifyProfileInput>(emptyProfile)
  const [status, setStatus] = useState('请选择或新增 Dify 应用')
  const [assistantProfileId, setAssistantProfileId] = useState('')
  const [history, setHistory] = useState<DifyHistoryEntry[]>([])

  const selected = useMemo(() => profiles.find((item) => item.id === selectedId), [profiles, selectedId])
  const assistantProfile = useMemo(
    () => profiles.find((item) => item.id === assistantProfileId),
    [profiles, assistantProfileId]
  )
  const chatModel = resolvePreferredChatModel(defaultChatModel, lastUsedChatModel)

  const refresh = useCallback(async () => {
    const [nextProfiles, nextAssistantProfile, nextHistory] = await Promise.all([
      difyClient.listProfiles(),
      difyClient.getAssistantProfile(),
      difyClient.history(),
    ])
    setProfiles(nextProfiles)
    setAssistantProfileId(nextAssistantProfile)
    setHistory(nextHistory)
    setSelectedId((current) => current || nextAssistantProfile || nextProfiles[0]?.id || null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selected) return
    setEditor({
      id: selected.id,
      name: selected.name,
      baseUrl: selected.baseUrl,
      appType: selected.appType,
      verifyTls: selected.verifyTls,
      apiKey: '',
    })
    setStatus(selected.hasApiKey ? '配置已保存，可在对话界面选择并运行' : '请补充 API Key')
  }, [selected])

  const save = async () => {
    try {
      const saved = await difyClient.saveProfile(editor)
      await refresh()
      setSelectedId(saved.id)
      setStatus('配置已安全保存')
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const testConnection = async () => {
    try {
      const saved = await difyClient.saveProfile(editor)
      const parameters = await difyClient.parameters(saved.id)
      const detected = parameters.detectedAppType
      if (detected && detected !== editor.appType) {
        const corrected = { ...editor, id: saved.id, appType: detected }
        await difyClient.saveProfile(corrected)
        setEditor(corrected)
        setStatus(`连接成功，已识别为 ${detected === 'workflow' ? 'Workflow' : 'Chatflow'} 并更新配置。`)
      } else {
        setStatus(`连接成功，已读取 ${parameters.fields.length} 个输入参数。`)
      }
      await refresh()
      setSelectedId(saved.id)
    } catch (error) {
      setStatus(`连接失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const remove = async () => {
    if (!selectedId || !window.confirm('确定删除当前 Dify 配置？运行历史将保留。')) return
    await difyClient.deleteProfile(selectedId)
    setSelectedId(null)
    setEditor(emptyProfile)
    await refresh()
  }

  const importLegacy = async () => {
    const result = await difyClient.importLegacy()
    await refresh()
    setStatus(
      result.imported
        ? `已导入 ${result.imported} 个旧配置；出于安全原因请重新填写各配置的 API Key。`
        : '没有发现可导入的旧工作流配置。'
    )
  }

  return (
    <Stack p="md" gap="lg" className="overflow-auto">
      <Stack gap={2}>
        <Title order={4}>划词助手与 Dify 工作流</Title>
        <Text size="sm" c="dimmed">
          划词助手可跟随主对话的统一 Chat 模型，或使用一个 Dify Workflow；成功结果会自动创建或继续主会话。
        </Text>
      </Stack>

      <Paper withBorder p="lg">
        <Stack>
          <Stack gap={2}>
            <Title order={5}>划词助手执行方式</Title>
            <Text size="sm" c="dimmed">
              这里决定点击“总结”、“翻译”等划词操作时实际调用哪个引擎。
            </Text>
          </Stack>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Paper withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>Chat 模型</Text>
                  <Text size="xs" c={!assistantProfileId ? 'teal' : 'dimmed'}>
                    {!assistantProfileId ? '当前方式' : '可选'}
                  </Text>
                </Group>
                <Text size="sm" c={chatModel ? undefined : 'orange'}>
                  {chatModel
                    ? `跟随主对话：${chatModel.provider} / ${chatModel.modelId}`
                    : '跟随主对话当前选择；主对话尚未选择 Chat 模型。'}
                </Text>
                <Button
                  variant={!assistantProfileId ? 'filled' : 'light'}
                  onClick={async () => {
                    await difyClient.setAssistantProfile(DESKTOP_ASSISTANT_DEFAULT_CHAT)
                    setAssistantProfileId('')
                    setStatus('划词助手已切换为主对话统一模型')
                  }}
                >
                  {!assistantProfileId ? '正在跟随主对话' : '使用主对话模型'}
                </Button>
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>Dify Workflow</Text>
                  <Text size="xs" c={assistantProfileId ? 'teal' : 'dimmed'}>
                    {assistantProfileId ? '当前方式' : '可选'}
                  </Text>
                </Group>
                <Text size="sm" c={assistantProfileId ? undefined : 'dimmed'}>
                  {assistantProfile ? `当前工作流：${assistantProfile.name}` : '尚未选择划词助手工作流。'}
                </Text>
                <Select
                  placeholder="选择已保存的 Workflow"
                  value={selected?.appType === 'workflow' ? selectedId : null}
                  data={profiles
                    .filter((profile) => profile.appType === 'workflow')
                    .map((profile) => ({ value: profile.id, label: profile.name }))}
                  onChange={setSelectedId}
                />
                <Button
                  variant={assistantProfileId === selectedId ? 'filled' : 'light'}
                  disabled={!selectedId || selected?.appType !== 'workflow' || !selected.hasApiKey}
                  onClick={async () => {
                    if (!selectedId) return
                    await difyClient.setAssistantProfile(selectedId)
                    setAssistantProfileId(selectedId)
                    setStatus('已设为划词助手工作流')
                  }}
                >
                  {assistantProfileId === selectedId ? '正在使用此 Workflow' : '使用此 Workflow'}
                </Button>
              </Stack>
            </Paper>
          </SimpleGrid>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper withBorder p="lg">
          <Stack>
            <Group justify="space-between">
              <Title order={5}>应用配置</Title>
              <Group gap="xs">
                <Button variant="subtle" size="xs" onClick={importLegacy}>
                  导入旧配置
                </Button>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => {
                    setSelectedId(null)
                    setEditor({ ...emptyProfile })
                  }}
                >
                  新增
                </Button>
              </Group>
            </Group>
            <Alert color={status.includes('失败') || status.includes('请') ? 'orange' : 'indigo'}>{status}</Alert>
            <Select
              label="已保存应用"
              placeholder="新增或选择应用"
              value={selectedId}
              data={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              onChange={setSelectedId}
              clearable
            />
            <TextInput
              label="显示名称"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.currentTarget.value })}
            />
            <TextInput
              label="Dify 服务地址"
              value={editor.baseUrl}
              onChange={(e) => setEditor({ ...editor, baseUrl: e.currentTarget.value })}
            />
            <Select
              label="应用类型"
              value={editor.appType}
              data={[
                { value: 'workflow', label: 'Workflow' },
                { value: 'chatflow', label: 'Chatflow' },
              ]}
              onChange={(value) => setEditor({ ...editor, appType: value === 'chatflow' ? 'chatflow' : 'workflow' })}
            />
            <PasswordInput
              label={selected?.hasApiKey ? 'API Key（留空则保持原密钥）' : 'API Key'}
              value={editor.apiKey || ''}
              onChange={(e) => setEditor({ ...editor, apiKey: e.currentTarget.value })}
            />
            <Switch
              label="验证 TLS 证书"
              description="建议保持开启；仅在可信内网且使用自签名 HTTPS 证书时关闭。HTTP 地址不受此选项影响。"
              checked={editor.verifyTls !== false}
              onChange={(e) => setEditor({ ...editor, verifyTls: e.currentTarget.checked })}
            />
            <Group justify="flex-end">
              {selectedId && (
                <Button color="red" variant="subtle" leftSection={<IconTrash size={15} />} onClick={remove}>
                  删除
                </Button>
              )}
              <Button variant="default" onClick={() => void testConnection()}>
                测试连接并读取参数
              </Button>
              <Button onClick={save}>保存配置</Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="lg">
          <Stack align="center" justify="center" mih={360} ta="center" px="xl">
            <IconMessageCircle size={42} className="text-chatbox-brand" />
            <Title order={5}>在对话界面运行工作流</Title>
            <Text size="sm" c="dimmed" maw={360}>
              在消息输入框右下角打开选择器，切换到“Dify
              工作流”。选择应用后，软件会自动读取参数并要求填写文字、选项或文件。
            </Text>
            <Text size="xs" c="dimmed">
              运行结果会作为普通助手消息加入当前对话，Chatflow 也会在同一对话中保持连续上下文。
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="lg">
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <IconHistory size={18} />
            <Title order={5}>运行历史</Title>
            <Text size="xs" c="dimmed">
              保留最近 100 次执行结果
            </Text>
          </Group>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            disabled={!history.length}
            onClick={async () => {
              if (!window.confirm('确定清空全部 Dify 运行历史？此操作不可恢复。')) return
              await difyClient.clearHistory()
              setHistory([])
              setStatus('已清空 Dify 运行历史')
            }}
          >
            清空历史
          </Button>
        </Group>
        {history.length === 0 ? (
          <Text size="sm" c="dimmed">
            尚无运行记录。工作流执行后，状态和文本结果会保留在这里。
          </Text>
        ) : (
          <ScrollArea mah={300} type="auto">
            <Stack gap="xs">
              {history.map((item) => (
                <Paper key={item.id} withBorder p="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2} className="min-w-0" flex={1}>
                      <Group gap="xs">
                        <Text fw={600} size="sm">
                          {item.profileName}
                        </Text>
                        <Text size="xs" c={item.status === 'succeeded' ? 'teal' : 'red'}>
                          {item.status === 'succeeded' ? '成功' : item.status === 'stopped' ? '已停止' : '失败'}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {new Date(item.createdAt).toLocaleString()}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {item.output || item.error || '未返回文本结果'}
                      </Text>
                    </Stack>
                    <ActionIcon
                      variant="subtle"
                      aria-label="复制运行结果"
                      onClick={() => void navigator.clipboard.writeText(item.output || item.error || '')}
                    >
                      <IconCopy size={16} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Paper>
    </Stack>
  )
}
