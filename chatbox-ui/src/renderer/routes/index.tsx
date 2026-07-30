import NiceModal from '@ebay/nice-modal-react'
import { Box, Button, Flex, Stack, Text, Title } from '@mantine/core'
import { createMessage, type Session } from '@shared/types'
import { IconCommand, IconKey } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useCallback, useMemo, useState } from 'react'
import { z } from 'zod'
import DifyWorkflowComposer, { type DifyWorkflowCompletion } from '@/components/InputBox/DifyWorkflowComposer'
import InputBox, { type InputBoxPayload } from '@/components/InputBox/InputBox'
import Page from '@/components/layout/Page'
import { useProviders } from '@/hooks/useProviders'
import { navigateToSettings } from '@/modals/Settings'
import { createSession as createSessionStore } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/session/crud'
import { submitNewUserMessage } from '@/stores/session/messages'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { useUIStore } from '@/stores/uiStore'

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(
    z.object({
      copilotId: z.string().optional(),
      copilot: z.string().optional(),
      settings: z.string().optional(),
    })
  ),
})

function Index() {
  const { providers } = useProviders()
  const widthFull = useUIStore((state) => state.widthFull)
  const newSessionState = useUIStore((state) => state.newSessionState)
  const setNewSessionState = useUIStore((state) => state.setNewSessionState)
  const addSessionKnowledgeBase = useUIStore((state) => state.addSessionKnowledgeBase)
  const sessionWebBrowsingMap = useUIStore((state) => state.sessionWebBrowsingMap)
  const setSessionWebBrowsing = useUIStore((state) => state.setSessionWebBrowsing)
  const clearSessionWebBrowsing = useUIStore((state) => state.clearSessionWebBrowsing)
  const [session, setSession] = useState<Session>({
    id: 'new',
    ...initEmptyChatSession(),
    name: '新建对话',
  })
  const [showApiNotice, setShowApiNotice] = useState(true)

  const selectedModel = useMemo(() => {
    if (!session.settings?.provider || !session.settings?.modelId) return undefined
    return { provider: session.settings.provider, modelId: session.settings.modelId }
  }, [session.settings?.modelId, session.settings?.provider])

  const onSelectModel = useCallback((provider: string, modelId: string) => {
    setSession((current) => ({
      ...current,
      settings: {
        ...(current.settings || {}),
        provider,
        modelId,
        executionMode: 'model',
        difyProfileId: undefined,
        difyConversationId: undefined,
      },
    }))
  }, [])

  const onSelectWorkflow = useCallback((profileId: string) => {
    setSession((current) => ({
      ...current,
      settings: {
        ...(current.settings || {}),
        executionMode: 'dify',
        difyProfileId: profileId,
        difyConversationId: undefined,
      },
    }))
  }, [])

  const onClickSessionSettings = useCallback(async () => {
    const result: Session = await NiceModal.show('session-settings', { session, disableAutoSave: true })
    if (result) setSession((current) => ({ ...current, ...result }))
    return true
  }, [session])

  const handleSubmit = useCallback(
    async ({ constructedMessage, needGenerating = true, onUserMessageReady }: InputBoxPayload) => {
      const newSession = await createSessionStore({
        name: session.name,
        type: 'chat',
        messages: session.messages,
        settings: session.settings,
      })

      if (newSessionState.knowledgeBase) {
        addSessionKnowledgeBase(newSession.id, newSessionState.knowledgeBase)
        setNewSessionState({})
      }

      const webBrowsing = sessionWebBrowsingMap.new
      if (webBrowsing !== undefined) {
        setSessionWebBrowsing(newSession.id, webBrowsing)
        clearSessionWebBrowsing('new')
      }

      switchCurrentSession(newSession.id)
      localStorage.removeItem('new-chat')
      void submitNewUserMessage(newSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [
      addSessionKnowledgeBase,
      clearSessionWebBrowsing,
      newSessionState.knowledgeBase,
      session,
      sessionWebBrowsingMap.new,
      setNewSessionState,
      setSessionWebBrowsing,
    ]
  )

  const handleWorkflowComplete = useCallback(
    async ({ profile, result, inputSummary, request }: DifyWorkflowCompletion) => {
      const userMessage = createMessage('user', inputSummary)
      const assistantMessage = createMessage(
        'assistant',
        result.output || (result.error ? `工作流执行失败：${result.error}` : '工作流执行完成，但没有返回文本结果。')
      )
      assistantMessage.aiProvider = 'dify'
      assistantMessage.model = profile.name
      assistantMessage.difyRun = request
      const newSession = await createSessionStore({
        name: profile.name,
        type: 'chat',
        messages: [...session.messages, userMessage, assistantMessage],
        settings: {
          ...session.settings,
          executionMode: 'dify',
          difyProfileId: profile.id,
          difyConversationId: result.conversationId,
        },
      })
      switchCurrentSession(newSession.id)
      localStorage.removeItem('new-chat')
    },
    [session.messages, session.settings]
  )

  return (
    <Page title="新建对话">
      <div className="flex flex-col h-full">
        <Flex flex={1} align="center" justify="center" p="xl">
          <Stack align="center" gap="xl" maw={440} w="100%">
            <Stack align="center" gap="sm">
              <Flex
                w={44}
                h={44}
                align="center"
                justify="center"
                className="rounded-xl bg-chatbox-background-brand-secondary border border-solid border-chatbox-border-brand"
              >
                <IconCommand size={24} className="text-chatbox-brand" />
              </Flex>
              <Title order={2} size="h3">
                开始一次对话
              </Title>
              <Text c="chatbox-secondary" ta="center" size="sm" lh={1.6}>
                直接输入消息，或者在任意应用中选中文本后按下
                <Text span c="chatbox-brand" fw={600}>
                  {' '}
                  Ctrl+Alt+Space{' '}
                </Text>
                呼出快捷助手。
              </Text>
            </Stack>

            {providers.length === 0 && showApiNotice && (
              <Box
                w="100%"
                p="lg"
                className="rounded-xl border border-solid border-chatbox-border-primary bg-chatbox-background-secondary"
              >
                <Flex align="flex-start" gap="md">
                  <Flex
                    w={40}
                    h={40}
                    align="center"
                    justify="center"
                    className="rounded-lg bg-chatbox-background-brand-secondary shrink-0"
                  >
                    <IconKey size={20} className="text-chatbox-brand" />
                  </Flex>
                  <Stack gap={4} flex={1}>
                    <Text fw={600}>尚未配置模型 API</Text>
                    <Text size="xs" c="chatbox-secondary" lh={1.5}>
                      配置 OpenAI 兼容接口、Dify 或本地模型即可开始。无需注册或登录任何账户。
                    </Text>
                  </Stack>
                </Flex>
                <Flex gap="sm" mt="lg">
                  <Button flex={1} onClick={() => navigateToSettings('provider')}>
                    配置 API
                  </Button>
                  <Button variant="subtle" color="chatbox-secondary" onClick={() => setShowApiNotice(false)}>
                    稍后
                  </Button>
                </Flex>
              </Box>
            )}
          </Stack>
        </Flex>

        <Stack
          gap="sm"
          className={widthFull ? 'w-full' : 'w-full max-w-4xl xl:max-w-6xl 2xl:max-w-[calc(100%-4rem)] mx-auto'}
        >
          {session.settings?.executionMode === 'dify' && session.settings.difyProfileId ? (
            <DifyWorkflowComposer
              profileId={session.settings.difyProfileId}
              conversationId={session.settings.difyConversationId}
              model={selectedModel}
              onSelectModel={onSelectModel}
              onSelectWorkflow={onSelectWorkflow}
              onComplete={handleWorkflowComplete}
            />
          ) : (
            <InputBox
              sessionType="chat"
              sessionId="new"
              model={selectedModel}
              onSelectModel={onSelectModel}
              onSelectWorkflow={onSelectWorkflow}
              onClickSessionSettings={onClickSessionSettings}
              onSubmit={handleSubmit}
            />
          )}
        </Stack>
      </div>
    </Page>
  )
}
