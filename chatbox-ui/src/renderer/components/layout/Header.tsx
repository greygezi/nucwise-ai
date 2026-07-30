import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Badge, Flex, Text, Tooltip } from '@mantine/core'
import { ModelProviderEnum, type Session } from '@shared/types'
import { isLocalHost } from '@shared/utils/network_utils'
import { IconLayoutSidebarLeftExpand, IconMenu2, IconPencil } from '@tabler/icons-react'
import clsx from 'clsx'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { scheduleGenerateNameAndThreadName, scheduleGenerateThreadName } from '@/stores/sessionActions'
import * as settingActions from '@/stores/settingActions'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import Divider from '../common/Divider'
import { ScalableIcon } from '../common/ScalableIcon'
import Toolbar from './Toolbar'
import WindowControls from './WindowControls'

export default function Header(props: { session: Session }) {
  const { t } = useTranslation()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const webBrowsing = useUIStore((s) => s.sessionWebBrowsingMap[props.session.id])
  const providerHost = useSettingsStore((s) => {
    const provider = props.session.settings?.provider
    return provider ? s.providers?.[provider]?.apiHost : undefined
  })

  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const { session: currentSession } = props
  const isLocalModel =
    currentSession.settings?.provider === ModelProviderEnum.Ollama ||
    currentSession.settings?.provider === ModelProviderEnum.LMStudio ||
    (!!providerHost && isLocalHost(providerHost))
  const connectionLabel =
    currentSession.settings?.executionMode === 'dify' || webBrowsing || !isLocalModel ? '联网' : '本地'
  const connectionHint =
    connectionLabel === '本地' ? '当前模型服务位于本机或内网。' : '当前会话会连接模型、工作流或联网搜索服务。'

  useEffect(() => {
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) {
      return
    }

    const hasGeneratingMessage = currentSession.messages.some((msg) => msg.generating)

    if (hasGeneratingMessage || currentSession.messages.length < 2) {
      return
    }

    if (currentSession.name === 'Untitled') {
      scheduleGenerateNameAndThreadName(currentSession.id)
    } else if (!currentSession.threadName) {
      scheduleGenerateThreadName(currentSession.id)
    }
  }, [currentSession])

  const editCurrentSession = () => {
    if (!currentSession) {
      return
    }
    NiceModal.show('session-settings', { session: currentSession })
  }

  return (
    <>
      <Flex
        h={48}
        align="center"
        px="md"
        className={clsx(
          'flex-none title-bar border-b border-solid border-chatbox-border-primary bg-chatbox-background-primary',
          isSmallScreen ? 'bg-chatbox-background-primary' : ''
        )}
      >
        {(!showSidebar || isSmallScreen) && (
          <Flex align="center" className={needRoomForMacWindowControls ? 'pl-20' : ''}>
            <ActionIcon
              className="controls"
              variant="subtle"
              size={isSmallScreen ? 24 : 20}
              color={isSmallScreen ? 'chatbox-secondary' : 'chatbox-tertiary'}
              mr="xs"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {isSmallScreen ? <IconMenu2 /> : <IconLayoutSidebarLeftExpand />}
            </ActionIcon>
          </Flex>
        )}

        <Flex
          align="center"
          flex={1}
          className="min-w-0"
          {...(isSmallScreen ? { justify: 'center', pl: 28, pr: 8 } : {})}
        >
          <Text fw={600} size="18px" lineClamp={1}>
            {currentSession?.name}
          </Text>
          <Tooltip label={connectionHint}>
            <Badge
              size="xs"
              variant="light"
              color={connectionLabel === '本地' ? 'teal' : 'blue'}
              ml={6}
              className="flex-shrink-0"
            >
              {connectionLabel}
            </Badge>
          </Tooltip>
          {currentSession?.threadName && currentSession.threadName !== currentSession.name && (
            <Badge
              size="xs"
              variant="light"
              color="gray"
              ml={6}
              maw={180}
              className="flex-shrink-0"
              classNames={{ label: 'truncate' }}
            >
              {currentSession.threadName}
            </Badge>
          )}
          <Tooltip label={t('Customize settings for the current conversation')}>
            <ActionIcon
              className="controls"
              variant="subtle"
              color="chatbox-tertiary"
              size={isSmallScreen ? 20 : 16}
              ml={4}
              onClick={editCurrentSession}
            >
              <ScalableIcon icon={IconPencil} size={14} />
            </ActionIcon>
          </Tooltip>
        </Flex>

        <Toolbar sessionId={currentSession.id} />

        <WindowControls className="-mr-3 ml-2" />
      </Flex>

      <Divider />
    </>
  )
}
