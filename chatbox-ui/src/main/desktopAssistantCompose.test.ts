import { describe, expect, it } from 'vitest'
import { buildDesktopAssistantComposeText } from './desktopAssistantCompose'

describe('desktop assistant compose draft', () => {
  it('includes the source text, action and answer in the chat draft', () => {
    expect(
      buildDesktopAssistantComposeText({
        text: '原文内容',
        action: { label: '总结' },
        result: '回答内容',
        followupText: '请再简短一点',
      })
    ).toBe('操作：总结\n\n原文：\n原文内容\n\n回答：\n回答内容\n\n追问：\n请再简短一点')
  })
})
