import { ipcMain } from 'electron'
import type { DifyProfileInput, DifyRunRequest } from '../../shared/dify'
import {
  cancel,
  clearHistory,
  deleteProfile,
  getAssistantProfileId,
  getParameters,
  importLegacyWorkflowClient,
  listHistory,
  listProfiles,
  run,
  saveProfile,
  setAssistantProfileId,
} from './service'

export function registerDifyHandlers(onAssistantProfileChanged?: () => void) {
  ipcMain.handle('dify:profiles:list', () => listProfiles())
  ipcMain.handle('dify:profiles:save', (_event, input: DifyProfileInput) => saveProfile(input))
  ipcMain.handle('dify:profiles:delete', (_event, id: string) => deleteProfile(id))
  ipcMain.handle('dify:profiles:import-legacy', () => importLegacyWorkflowClient())
  ipcMain.handle('dify:parameters', (_event, profileId: string) => getParameters(profileId))
  ipcMain.handle('dify:run', (event, request: DifyRunRequest) => run(request, event.sender))
  ipcMain.handle('dify:cancel', (_event, runId: string) => cancel(runId))
  ipcMain.handle('dify:history:list', () => listHistory())
  ipcMain.handle('dify:history:clear', () => clearHistory())
  ipcMain.handle('dify:assistant-profile:get', () => getAssistantProfileId())
  ipcMain.handle('dify:assistant-profile:set', (_event, profileId: string) => {
    const result = setAssistantProfileId(profileId)
    onAssistantProfileChanged?.()
    return result
  })
}
