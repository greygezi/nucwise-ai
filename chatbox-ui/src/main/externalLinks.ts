const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false

  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export function isSameDocumentNavigation(target: string, current: string): boolean {
  try {
    const destination = new URL(target)
    const source = new URL(current)
    destination.hash = source.hash = ''
    return destination.href === source.href
  } catch {
    return false
  }
}
