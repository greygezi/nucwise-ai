import { describe, expect, it } from 'vitest'
import { chatSessionSettings, getDefaultPrompt, newConfigs, pictureSessionSettings, settings } from './defaults'
import { type SessionSettings, type Settings, Theme } from './types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('defaults', () => {
  it('settings() returns expected default values', () => {
    const result: Settings = settings()

    expect(result.theme).toBe(Theme.Dark)
    expect(result.language).toBe('zh-Hans')
    expect(result.fontSize).toBe(14)
    expect(result.spellCheck).toBe(true)
    expect(result.showWordCount).toBe(false)
    expect(result.showTokenCount).toBe(false)
    expect(result.showTokenUsed).toBe(true)
  })

  it('settings() disables reporting and tracking by default', () => {
    expect(settings().allowReportingAndTracking).toBe(false)
  })

  it('settings() returns enableMarkdownRendering as true', () => {
    expect(settings().enableMarkdownRendering).toBe(true)
  })

  it('settings() returns shortcuts object with expected keys', () => {
    const result = settings().shortcuts

    expect(Object.keys(result).sort()).toEqual(
      [
        'quickToggle',
        'selectionAssistant',
        'inputBoxFocus',
        'inputBoxWebBrowsingMode',
        'newChat',
        'newPictureChat',
        'sessionListNavNext',
        'sessionListNavPrev',
        'sessionListNavTargetIndex',
        'dialogOpenSearch',
        'inputBoxSendMessage',
        'inputBoxSendMessageWithoutResponse',
        'optionNavUp',
        'optionNavDown',
        'optionSelect',
      ].sort()
    )
  })

  it('newConfigs() returns object with uuid string', () => {
    const result = newConfigs()

    expect(typeof result.uuid).toBe('string')
    expect(result.uuid).toMatch(UUID_REGEX)
  })

  it('getDefaultPrompt() returns expected string', () => {
    expect(getDefaultPrompt()).toBe('You are a helpful assistant.')
  })

  it('chatSessionSettings() does not preselect a remote provider', () => {
    const result: SessionSettings = chatSessionSettings()

    expect(result.provider).toBeUndefined()
    expect(result.modelId).toBeUndefined()
  })

  it('pictureSessionSettings() keeps image options without preselecting a provider', () => {
    const result: SessionSettings = pictureSessionSettings()

    expect(result.provider).toBeUndefined()
    expect(result.modelId).toBeUndefined()
    expect(result.dalleStyle).toBe('vivid')
    expect(result.imageGenerateNum).toBe(1)
  })
})
