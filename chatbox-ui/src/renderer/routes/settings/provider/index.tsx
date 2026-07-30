import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { SystemProviders } from '@shared/defaults'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/provider/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const isSmallScreen = useIsSmallScreen()
  const navigate = useNavigate()
  const hiddenProviderIds = useSettingsStore((state) => state.hiddenProviderIds) || []
  useEffect(() => {
    if (!isSmallScreen) {
      const firstProvider = SystemProviders().find(
        (provider) => provider.id !== 'chatbox-ai' && !hiddenProviderIds.includes(provider.id)
      )
      if (firstProvider) {
        navigate({ to: '/settings/provider/$providerId', params: { providerId: firstProvider.id }, replace: true })
      }
    }
  }, [hiddenProviderIds, isSmallScreen, navigate])

  return null
}
