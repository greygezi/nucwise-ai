import { ActionIcon, Box, Button, Flex, Image, NavLink, Stack, Text, Tooltip } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import { IconCirclePlus, IconLayoutSidebarLeftCollapse, IconSettingsFilled } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from './components/common/ScalableIcon'
import SessionList from './components/session/SessionList'
import useNeedRoomForMacWinControls from './hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarWidth } from './hooks/useScreenChange'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import nidLogo from './static/nid-logo.jpg'
import nucwiseAppIcon from './static/nucwise-app-icon.png'
import { useLanguage } from './stores/settingsStore'
import { useUIStore } from './stores/uiStore'
import { CHATBOX_BUILD_PLATFORM } from './variables'

export default function Sidebar() {
  const { t } = useTranslation()
  const language = useLanguage()
  const navigate = useNavigate()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const sidebarWidth = useSidebarWidth()
  const isSmallScreen = useIsSmallScreen()
  const sessionListViewportRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)
  const { needRoomForMacWindowControls } = useNeedRoomForMacWinControls()

  const handleCreateNewSession = useCallback(() => {
    navigate({ to: '/' })
    if (isSmallScreen) setShowSidebar(false)
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [isSmallScreen, navigate, setShowSidebar])

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (isSmallScreen) return
      event.preventDefault()
      event.stopPropagation()
      setIsResizing(true)
      resizeStartX.current = event.clientX
      resizeStartWidth.current = sidebarWidth
    },
    [isSmallScreen, sidebarWidth]
  )

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = language === 'ar' ? resizeStartX.current - event.clientX : event.clientX - resizeStartX.current
      setSidebarWidth(Math.max(200, Math.min(500, resizeStartWidth.current + deltaX)))
    }
    const handleMouseUp = () => setIsResizing(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, language, setSidebarWidth])

  return (
    <SwipeableDrawer
      anchor={language === 'ar' ? 'right' : 'left'}
      variant={isSmallScreen ? 'temporary' : 'persistent'}
      open={showSidebar}
      onClose={() => setShowSidebar(false)}
      onOpen={() => setShowSidebar(true)}
      ModalProps={{ keepMounted: true, disableEnforceFocus: true }}
      sx={{
        '& .MuiDrawer-paper': {
          backgroundColor: 'var(--chatbox-background-secondary)',
          backgroundImage: 'none',
          boxSizing: 'border-box',
          width: isSmallScreen ? '75vw' : sidebarWidth,
          maxWidth: '75vw',
        },
      }}
      SlideProps={language === 'ar' ? { direction: 'left' } : undefined}
      PaperProps={
        language === 'ar' ? { sx: { direction: 'rtl', overflowY: 'initial' } } : { sx: { overflowY: 'initial' } }
      }
      disableSwipeToOpen={CHATBOX_BUILD_PLATFORM !== 'ios'}
    >
      <Stack
        h="100%"
        gap={0}
        pt="var(--mobile-safe-area-inset-top, 0px)"
        pb="var(--mobile-safe-area-inset-bottom, 0px)"
        className="relative bg-chatbox-background-secondary border-r border-solid border-chatbox-border-primary"
      >
        {needRoomForMacWindowControls && <Box className="title-bar flex-[0_0_44px]" />}
        <Flex
          align="center"
          justify="space-between"
          mx="xs"
          mt="xs"
          px="sm"
          py="sm"
          className="rounded-xl border border-solid border-white/10 bg-white/[0.025]"
        >
          <Flex align="center" gap="sm" className="min-w-0">
            <Image
              src={nucwiseAppIcon}
              alt="NucWise AI"
              w={42}
              h={42}
              radius="md"
              className="shrink-0 shadow-[0_8px_22px_rgba(20,78,190,0.3)] ring-1 ring-inset ring-white/20"
            />
            <Stack gap={2} className="min-w-0">
              <Text c="chatbox-primary" size="lg" lh={1.05} fw="800" className="truncate tracking-[-0.025em]">
                NucWise AI
              </Text>
              <Text c="chatbox-tertiary" size="xxs" lh={1.2} fw="600" className="tracking-[0.1em]">
                智能桌面助手
              </Text>
            </Stack>
          </Flex>
          <Tooltip label={t('Collapse')} openDelay={800} withArrow>
            <ActionIcon variant="subtle" color="chatbox-tertiary" size={20} onClick={() => setShowSidebar(false)}>
              <IconLayoutSidebarLeftCollapse />
            </ActionIcon>
          </Tooltip>
        </Flex>

        <Box px="sm" pt="sm" pb="sm">
          <Image
            src={nidLogo}
            alt="NID"
            radius="md"
            h={68}
            fit="contain"
            className="w-full overflow-hidden border border-solid border-white/15 shadow-[0_8px_20px_rgba(0,0,0,0.16)]"
          />
        </Box>

        <SessionList sessionListViewportRef={sessionListViewportRef} />

        <Stack gap="xs" px="xs" pb="xs">
          <Button variant="light" fullWidth data-testid="new-chat-button" onClick={handleCreateNewSession}>
            <ScalableIcon icon={IconCirclePlus} className="mr-2" />
            {t('New Chat')}
            <Text span size="xxs" c="chatbox-tertiary" ml="auto">
              Ctrl+N
            </Text>
          </Button>
          <NavLink
            c="chatbox-secondary"
            className="rounded"
            label={t('Settings')}
            leftSection={<ScalableIcon icon={IconSettingsFilled} size={20} />}
            onClick={() => {
              navigateToSettings('provider')
              if (isSmallScreen) setShowSidebar(false)
            }}
            variant="light"
            p="xs"
          />
          <Text ta="center" size="xxs" c="chatbox-tertiary" className="tracking-[0.04em]">
            © {new Date().getFullYear()} @NID/NIR
          </Text>
        </Stack>

        {!isSmallScreen && (
          <Box
            onMouseDown={handleResizeStart}
            className={clsx(
              'absolute top-0 bottom-0 w-1 cursor-col-resize z-[1] bg-chatbox-border-primary opacity-0 hover:opacity-70 transition-opacity duration-200',
              language === 'ar' ? '-left-1' : '-right-1'
            )}
          />
        )}
      </Stack>
    </SwipeableDrawer>
  )
}
