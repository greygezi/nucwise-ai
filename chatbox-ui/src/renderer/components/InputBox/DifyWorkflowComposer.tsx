import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Collapse,
  Flex,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import type { DifyInputField, DifyProfile, DifyRunRequest, DifyRunResult } from '@shared/dify'
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconFile,
  IconFileUpload,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import { difyClient } from '@/packages/dify/client'
import { useUIStore } from '@/stores/uiStore'
import { ScalableIcon } from '../common/ScalableIcon'
import ModelSelector from '../ModelSelector'

export type DifyWorkflowCompletion = {
  profile: DifyProfile
  result: DifyRunResult
  inputSummary: string
  request: DifyRunRequest
}

type Props = {
  profileId: string
  conversationId?: string
  model?: { provider: string; modelId: string }
  fullWidth?: boolean
  onSelectModel?(provider: string, modelId: string): void
  onSelectWorkflow(profileId: string): void
  onComplete(completion: DifyWorkflowCompletion): Promise<void>
}

function hasValue(value: unknown) {
  if (value === undefined || value === null || value === '') return false
  if (typeof value === 'object' && '__dify_file_paths__' in value) {
    return (
      Array.isArray((value as { __dify_file_paths__?: string[] }).__dify_file_paths__) &&
      Boolean((value as { __dify_file_paths__: string[] }).__dify_file_paths__.length)
    )
  }
  return true
}

function statusText(event: string, data: Record<string, unknown>) {
  if (event === 'upload_started') return '正在上传文件…'
  if (event === 'workflow_started') return '工作流已启动'
  if (event === 'node_started') return `正在执行：${String(data.title || data.node_type || '节点')}`
  if (event === 'message') return '正在生成回复…'
  if (event === 'workflow_finished' || event === 'message_end') return '执行完成'
  if (event === 'error' || event === 'workflow_failed') return '执行失败'
  return '工作流运行中…'
}

type FileDropzoneProps = {
  field: DifyInputField
  names: string[]
  onFiles(files: File[]): void
  onClear(): void
}

function DifyFileDropzone({ field, names, onFiles, onClear }: FileDropzoneProps) {
  const multiple = field.type === 'file-list'
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple,
    onDrop: (files) => onFiles(multiple ? files : files.slice(0, 1)),
  })

  return (
    <Stack gap={5}>
      <Text size="sm" fw={500}>
        {field.label || field.variable}
        {field.required && (
          <Text span c="red" ml={3}>
            *
          </Text>
        )}
      </Text>
      {field.description && (
        <Text size="xs" c="chatbox-tertiary">
          {field.description}
        </Text>
      )}
      <Box
        {...getRootProps()}
        className={cn(
          'cursor-pointer rounded-lg border border-dashed px-3 py-3 transition-colors',
          isDragActive
            ? 'border-chatbox-brand bg-chatbox-background-brand-secondary'
            : 'border-chatbox-border-primary hover:border-chatbox-brand hover:bg-chatbox-background-tertiary'
        )}
      >
        <input {...getInputProps()} />
        <Flex align="center" gap="sm">
          <Flex
            w={34}
            h={34}
            align="center"
            justify="center"
            className="shrink-0 rounded-md bg-chatbox-background-brand-secondary text-chatbox-brand"
          >
            <IconFileUpload size={18} />
          </Flex>
          <Stack gap={0} className="min-w-0 flex-1">
            <Text size="sm" fw={500}>
              {isDragActive ? '松开鼠标即可添加文件' : '拖动文件到这里，或点击选择'}
            </Text>
            <Text size="xxs" c="chatbox-tertiary">
              {multiple ? '可一次选择或拖入多个文件' : '此输入项仅接受一个文件'}
            </Text>
          </Stack>
          {names.length > 0 && (
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="清除已选文件"
              onClick={(event) => {
                event.stopPropagation()
                onClear()
              }}
            >
              <IconX size={16} />
            </ActionIcon>
          )}
        </Flex>
        {names.length > 0 && (
          <Stack gap={4} mt="xs">
            {names.map((name) => (
              <Flex key={name} align="center" gap="xs" className="rounded-md bg-chatbox-background-secondary px-2 py-1">
                <IconFile size={14} className="shrink-0 text-chatbox-tint-secondary" />
                <Text size="xs" truncate>
                  {name}
                </Text>
              </Flex>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}

export default function DifyWorkflowComposer({
  profileId,
  conversationId,
  model,
  fullWidth,
  onSelectModel,
  onSelectWorkflow,
  onComplete,
}: Props) {
  const [profiles, setProfiles] = useState<DifyProfile[]>([])
  const [fields, setFields] = useState<DifyInputField[]>([])
  const [inputs, setInputs] = useState<Record<string, unknown>>({})
  const [fileNames, setFileNames] = useState<Record<string, string[]>>({})
  const [query, setQuery] = useState('')
  const [loadingParameters, setLoadingParameters] = useState(true)
  const [running, setRunning] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string>()
  const [status, setStatus] = useState('正在读取工作流输入要求…')
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const widthFull = useUIStore((state) => state.widthFull) || fullWidth

  const profile = useMemo(() => profiles.find((item) => item.id === profileId), [profileId, profiles])

  const refreshProfiles = useCallback(async () => {
    const next = await difyClient.listProfiles()
    setProfiles(next)
    return next
  }, [])

  const loadParameters = useCallback(async () => {
    setLoadingParameters(true)
    setCollapsed(false)
    setError('')
    setFields([])
    setInputs({})
    setFileNames({})
    try {
      const nextProfiles = await refreshProfiles()
      const selected = nextProfiles.find((item) => item.id === profileId)
      if (!selected) throw new Error('工作流配置不存在或已被删除')
      if (!selected.hasApiKey) throw new Error('该工作流尚未配置 API Key')
      const result = await difyClient.parameters(profileId)
      setFields(result.fields)
      setInputs(Object.fromEntries(result.fields.map((field) => [field.variable, field.default || ''])))
      setStatus(
        result.fields.length
          ? `已读取 ${result.fields.length} 个输入要求，请填写后运行`
          : selected.appType === 'chatflow'
            ? '请输入本轮问题'
            : '该工作流无需额外输入，可直接运行'
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('工作流尚未就绪')
    } finally {
      setLoadingParameters(false)
    }
  }, [profileId, refreshProfiles])

  useEffect(() => {
    setQuery('')
    void loadParameters()
  }, [loadParameters])

  useEffect(
    () =>
      difyClient.onRunEvent((event) => {
        setActiveRunId(event.runId)
        setStatus(statusText(event.event, event.data))
      }),
    []
  )

  const missingField = fields.find((field) => field.required && !hasValue(inputs[field.variable]))
  const queryMissing = profile?.appType === 'chatflow' && !query.trim()
  const ready = Boolean(profile && !loadingParameters && !error && !missingField && !queryMissing)

  const inputSummary = useMemo(() => {
    const lines = fields
      .filter((field) => hasValue(inputs[field.variable]))
      .map((field) => {
        const names = fileNames[field.variable]
        const value = names?.length ? names.join('、') : String(inputs[field.variable] ?? '')
        return `- ${field.label}：${value}`
      })
    if (query.trim()) lines.unshift(`- 本轮问题：${query.trim()}`)
    return `运行工作流「${profile?.name || 'Dify'}」${lines.length ? `\n\n${lines.join('\n')}` : ''}`
  }, [fields, fileNames, inputs, profile?.name, query])

  const run = async () => {
    if (!profile || !ready) return
    setRunning(true)
    setError('')
    setStatus('正在提交工作流…')
    try {
      const request: DifyRunRequest = {
        profileId,
        inputs,
        query: query.trim() || undefined,
        conversationId,
      }
      const result = await difyClient.run(request)
      setStatus(result.status === 'succeeded' ? '执行完成，结果已加入对话' : result.error || result.status)
      await onComplete({ profile, result, inputSummary, request })
      setCollapsed(result.status === 'succeeded')
      if (profile.appType === 'workflow') {
        setInputs(Object.fromEntries(fields.map((field) => [field.variable, field.default || ''])))
        setFileNames({})
      } else {
        setQuery('')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('执行失败')
    } finally {
      setRunning(false)
      setActiveRunId(undefined)
    }
  }

  return (
    <Box pt={0} pb="sm" px="sm">
      <Stack
        className={cn(widthFull ? 'w-full' : 'w-full max-w-4xl xl:max-w-6xl 2xl:max-w-[calc(100%-4rem)] mx-auto')}
        gap="xs"
      >
        <Stack
          className="rounded-xl bg-chatbox-background-secondary px-3 py-3 shadow-[0_12px_32px_rgba(17,24,39,0.18)]"
          style={{ border: '1px solid var(--chatbox-border-primary)' }}
          gap="sm"
        >
          <Flex align="center" justify="space-between" gap="sm">
            <Flex align="center" gap="sm" className="min-w-0">
              <Flex
                w={32}
                h={32}
                align="center"
                justify="center"
                className="rounded-md bg-chatbox-background-brand-secondary text-chatbox-brand shrink-0"
              >
                {loadingParameters ? <Loader size={15} /> : <ScalableIcon icon={IconRoute} size={17} />}
              </Flex>
              <Stack gap={0} className="min-w-0">
                <Text size="sm" fw={600} truncate>
                  {profile?.name || 'Dify 工作流'}
                </Text>
                <Text size="xxs" c={error ? 'orange' : 'chatbox-tertiary'} truncate>
                  {status}
                </Text>
              </Stack>
            </Flex>
            <Flex gap={2}>
              <ActionIcon variant="subtle" aria-label="重新读取参数" onClick={() => void loadParameters()}>
                <IconRefresh size={16} />
              </ActionIcon>
              <ActionIcon variant="subtle" aria-label="配置工作流" onClick={() => navigateToSettings('/workflows')}>
                <IconSettings size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label={collapsed ? '展开工作流输入' : '折叠工作流输入'}
                title={collapsed ? '展开工作流输入' : '折叠工作流输入'}
                disabled={running}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? <IconChevronUp size={17} /> : <IconChevronDown size={17} />}
              </ActionIcon>
            </Flex>
          </Flex>

          <Collapse in={!collapsed}>
            <Stack gap="sm" pt="sm">
              {error && (
                <Alert color="orange" icon={<IconAlertCircle size={16} />} py="xs">
                  {error}
                </Alert>
              )}

              {!loadingParameters && !error && (
                <Stack gap="sm">
                  {profile?.appType === 'chatflow' && (
                    <Textarea
                      label="本轮问题"
                      required
                      autosize
                      minRows={2}
                      maxRows={6}
                      placeholder="输入希望工作流处理的问题…"
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                  )}
                  {fields.map((field) => {
                    const label = field.label || field.variable
                    if (field.type === 'select' || field.type === 'radio') {
                      return (
                        <Select
                          key={field.variable}
                          label={label}
                          required={field.required}
                          description={field.description}
                          data={field.options || []}
                          value={String(inputs[field.variable] || '') || null}
                          onChange={(value) => setInputs((current) => ({ ...current, [field.variable]: value || '' }))}
                        />
                      )
                    }
                    if (field.type === 'file' || field.type === 'file-list') {
                      return (
                        <DifyFileDropzone
                          key={field.variable}
                          field={field}
                          names={fileNames[field.variable] || []}
                          onFiles={(files) => {
                            setFileNames((current) => ({
                              ...current,
                              [field.variable]: files.map((file) => file.name),
                            }))
                            setInputs((current) => ({
                              ...current,
                              [field.variable]: {
                                __dify_file_paths__: files.map((file) => window.electronAPI.getPathForFile(file)),
                              },
                            }))
                          }}
                          onClear={() => {
                            setFileNames((current) => ({ ...current, [field.variable]: [] }))
                            setInputs((current) => ({
                              ...current,
                              [field.variable]: { __dify_file_paths__: [] },
                            }))
                          }}
                        />
                      )
                    }
                    if (field.type === 'paragraph' || field.type === 'text-area') {
                      return (
                        <Textarea
                          key={field.variable}
                          label={label}
                          required={field.required}
                          description={field.description}
                          autosize
                          minRows={2}
                          maxRows={6}
                          value={String(inputs[field.variable] || '')}
                          onChange={(event) =>
                            setInputs((current) => ({ ...current, [field.variable]: event.currentTarget.value }))
                          }
                        />
                      )
                    }
                    return (
                      <TextInput
                        key={field.variable}
                        label={label}
                        required={field.required}
                        description={field.description}
                        value={String(inputs[field.variable] || '')}
                        onChange={(event) =>
                          setInputs((current) => ({ ...current, [field.variable]: event.currentTarget.value }))
                        }
                      />
                    )
                  })}
                </Stack>
              )}

              <Flex align="center" justify="space-between" gap="sm">
                <ModelSelector
                  onSelect={onSelectModel}
                  onSelectWorkflow={onSelectWorkflow}
                  selectedProviderId={model?.provider}
                  selectedModelId={model?.modelId}
                  selectedDifyProfileId={profileId}
                  position="top-start"
                >
                  <UnstyledButton className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--chatbox-background-tertiary)]">
                    <ScalableIcon icon={IconRoute} size={18} className="text-chatbox-brand shrink-0" />
                    <Text size="sm" className="max-w-[220px] truncate">
                      {profile?.name || 'Dify 工作流'}
                    </Text>
                    <IconChevronRight size={14} className="rotate-90 text-chatbox-tint-tertiary" />
                  </UnstyledButton>
                </ModelSelector>
                {running && activeRunId ? (
                  <Button
                    color="red"
                    variant="light"
                    size="sm"
                    leftSection={<IconPlayerStop size={16} />}
                    onClick={() => void difyClient.cancel(activeRunId)}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    leftSection={<IconPlayerPlay size={16} />}
                    loading={running}
                    disabled={!ready}
                    onClick={() => void run()}
                  >
                    运行工作流
                  </Button>
                )}
              </Flex>
              {!ready && !loadingParameters && !error && (
                <Text size="xxs" c="chatbox-tertiary" ta="right">
                  {missingField ? `请填写必填项：${missingField.label}` : queryMissing ? '请输入本轮问题' : ''}
                </Text>
              )}
            </Stack>
          </Collapse>
        </Stack>
        <Text size="xxs" c="chatbox-tertiary" ta="center">
          工作流结果会直接加入当前对话；文件仅上传到所选 Dify 应用。
        </Text>
      </Stack>
    </Box>
  )
}
