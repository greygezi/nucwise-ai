import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isSameDocumentNavigation } from './externalLinks'

describe('external link validation', () => {
  it('allows only valid web and mail links', () => {
    expect(isAllowedExternalUrl('https://example.com/path?q=1')).toBe(true)
    expect(isAllowedExternalUrl('HTTP://example.com')).toBe(true)
    expect(isAllowedExternalUrl('mailto:user@example.com')).toBe(true)
    expect(isAllowedExternalUrl('file:///tmp/secret')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('custom://handler')).toBe(false)
    expect(isAllowedExternalUrl('https://')).toBe(false)
    expect(isAllowedExternalUrl(null)).toBe(false)
  })
})

it('allows hash routing but rejects document navigation', () => {
  expect(isSameDocumentNavigation('file:///app/index.html#/session/2', 'file:///app/index.html#/')).toBe(true)
  expect(isSameDocumentNavigation('https://example.com', 'file:///app/index.html')).toBe(false)
  expect(isSameDocumentNavigation('file:///private.txt', 'file:///app/index.html')).toBe(false)
})
