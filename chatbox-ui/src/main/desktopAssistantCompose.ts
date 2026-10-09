export function buildDesktopAssistantComposeText(payload: Record<string, unknown>): string {
  const action = payload.action && typeof payload.action === 'object' ? (payload.action as Record<string, unknown>) : {}
  const actionLabel = String(action.label || action.user_request || '').trim()
  const sourceText = String(payload.text || '').trim()
  const result = String(payload.result || '').trim()
  const followupText = String(payload.followupText || '').trim()

  return [
    actionLabel ? `操作：${actionLabel}` : '',
    sourceText ? `原文：\n${sourceText}` : '',
    result ? `回答：\n${result}` : '',
    followupText ? `追问：\n${followupText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
