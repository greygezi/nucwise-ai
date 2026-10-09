import type { BrowserWindow } from 'electron'
import log from 'electron-log/main'

export function handleDeepLink(mainWindow: BrowserWindow, link: string) {
  let url: URL
  try {
    const normalizedLink = link.replace(/^desktopassistant-dev:\/\//, 'desktopassistant://')
    url = new URL(normalizedLink)
  } catch {
    log.warn('🔗 Ignored malformed deep link')
    return
  }
  if (url.protocol !== 'desktopassistant:') {
    log.warn('🔗 Ignored unsupported deep link protocol')
    return
  }

  log.info('🔗 Parsed URL:', { hostname: url.hostname, pathname: url.pathname })

  // handle `desktopassistant://mcp/install?server=`
  if (url.hostname === 'mcp' && url.pathname === '/install') {
    const encodedConfig = url.searchParams.get('server') || ''
    mainWindow.webContents.send('navigate-to', `/settings/mcp?install=${encodeURIComponent(encodedConfig)}`)
  }

  // handle `desktopassistant://provider/import?config=`
  if (url.hostname === 'provider' && url.pathname === '/import') {
    const encodedConfig = url.searchParams.get('config') || ''
    mainWindow.webContents.send('navigate-to', `/settings/provider?import=${encodeURIComponent(encodedConfig)}`)
  }

  // handle `desktopassistant://assistant/compose?text=` from the companion tray assistant.
  // Text is deliberately prefilled rather than submitted, so the user remains in control.
  if (url.hostname === 'assistant' && url.pathname === '/compose') {
    const text = url.searchParams.get('text') || ''
    mainWindow.webContents.send('desktop-assistant-compose', text)
  }

  // Legacy auth callbacks are intentionally not exposed by Desktop Assistant.
  // // 不需要，实际跳回到 app 后业务hooks useLogin 会处理后续动作
  // if (url.hostname === 'auth' && url.pathname === '/callback') {
  //   const ticketId = url.searchParams.get('ticket_id') || ''
  //   const status = url.searchParams.get('status') || ''
  //   log.info('✅ Auth callback received:', { ticketId, status })
  //   mainWindow.webContents.send('navigate-to', `/settings/provider/chatbox-ai?ticket_id=${ticketId}&status=${status}`)
  // }
}
