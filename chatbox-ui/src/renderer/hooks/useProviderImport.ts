import type { ModelProviderEnum, ProviderInfo, ProviderSettings } from '@shared/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseProviderFromJson } from '@/utils/provider-config'

export function useProviderImport(providers: ProviderInfo[]) {
  const { t } = useTranslation()
  const [importModalOpened, setImportModalOpened] = useState(false)
  const [importedConfig, setImportedConfig] = useState<
    ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | null
  >(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [existingProvider, setExistingProvider] = useState<ProviderInfo | null>(null)

  const checkExistingProvider = useCallback(
    (providerId: string) => {
      const existing = providers.find((p) => p.id === providerId)
      if (existing) {
        setExistingProvider(existing)
      } else {
        setExistingProvider(null)
      }
    },
    [providers]
  )

  const openImportText = useCallback(
    (text: string) => {
      const config = parseProviderFromJson(text)
      if (!config) {
        setImportError(t('Invalid provider configuration format'))
        return
      }

      checkExistingProvider(config.id)
      setImportedConfig(config)
      setImportModalOpened(true)
    },
    [checkExistingProvider, t]
  )

  const handleClipboardImport = async () => {
    try {
      setIsImporting(true)
      setImportError(null)

      const text = await navigator.clipboard.readText()
      openImportText(text)
    } catch (err) {
      console.error('Clipboard import failed:', err)
      setImportError(t('Failed to read from clipboard'))
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileImport = async (file: File) => {
    try {
      setIsImporting(true)
      setImportError(null)
      if (file.size > 1024 * 1024) {
        setImportError(t('Invalid provider configuration format'))
        return
      }
      openImportText(await file.text())
    } catch (err) {
      console.error('File import failed:', err)
      setImportError(t('Invalid provider configuration format'))
    } finally {
      setIsImporting(false)
    }
  }

  const handleCancelImport = () => {
    setImportModalOpened(false)
    setImportedConfig(null)
    setImportError(null)
    setExistingProvider(null)
  }

  return {
    importModalOpened,
    setImportModalOpened,
    importedConfig,
    setImportedConfig,
    importError,
    setImportError,
    isImporting,
    existingProvider,
    checkExistingProvider,
    handleClipboardImport,
    handleFileImport,
    handleCancelImport,
  }
}
