import type {
  DifyHistoryEntry,
  DifyProfile,
  DifyProfileInput,
  DifyRunEvent,
  DifyRunRequest,
  DifyRunResult,
} from '@shared/dify'

export type DifyParametersResult = {
  fields: import('@shared/dify').DifyInputField[]
  detectedAppType?: import('@shared/dify').DifyAppType
}

export const difyClient = {
  listProfiles: () => window.electronAPI.invoke('dify:profiles:list') as Promise<DifyProfile[]>,
  saveProfile: (input: DifyProfileInput) =>
    window.electronAPI.invoke('dify:profiles:save', input) as Promise<DifyProfile>,
  deleteProfile: (id: string) => window.electronAPI.invoke('dify:profiles:delete', id) as Promise<boolean>,
  importLegacy: () =>
    window.electronAPI.invoke('dify:profiles:import-legacy') as Promise<{
      imported: number
      needsApiKey: number
      source: string
    }>,
  parameters: (profileId: string) =>
    window.electronAPI.invoke('dify:parameters', profileId) as Promise<DifyParametersResult>,
  run: (request: DifyRunRequest) => window.electronAPI.invoke('dify:run', request) as Promise<DifyRunResult>,
  cancel: (runId: string) => window.electronAPI.invoke('dify:cancel', runId) as Promise<boolean>,
  history: () => window.electronAPI.invoke('dify:history:list') as Promise<DifyHistoryEntry[]>,
  clearHistory: () => window.electronAPI.invoke('dify:history:clear') as Promise<boolean>,
  getAssistantProfile: () => window.electronAPI.invoke('dify:assistant-profile:get') as Promise<string>,
  setAssistantProfile: (profileId: string) =>
    window.electronAPI.invoke('dify:assistant-profile:set', profileId) as Promise<string>,
  onRunEvent: (callback: (event: DifyRunEvent) => void) => window.electronAPI.onDifyRunEvent(callback),
}
