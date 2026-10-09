import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adaptDesktopAssistantMessages,
  buildDesktopAssistantMessages,
  buildDesktopAssistantSessionTitle,
  buildDesktopAssistantSessionTurns,
  DesktopAssistantStreamTimeoutError,
  enqueueDesktopAssistantCompose,
  nextDesktopAssistantStreamPart,
  subscribeDesktopAssistantCompose,
} from './desktopAssistant'

afterEach(() => vi.useRealTimers())

describe('desktop assistant messages', () => {
  it('keeps fallback conversation history for multi-round requests', () => {
    const messages = buildDesktopAssistantMessages({
      requestId: 'request-1',
      text: '原文',
      action: { user_request: '总结' },
      conversation: [
        { role: 'assistant', content: '首轮回答' },
        { role: 'user', content: '请补充第二点' },
      ],
      followupText: '再简短一点',
      messages: [],
    })

    expect(messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: '总结\n\n原文' },
      { role: 'assistant', content: '首轮回答' },
      { role: 'user', content: '请补充第二点' },
      { role: 'user', content: '再简短一点' },
    ])
  })

  it('does not duplicate a follow-up already present in fallback history', () => {
    const messages = buildDesktopAssistantMessages({
      requestId: 'request-2',
      text: '原文',
      action: { user_request: '总结' },
      conversation: [{ role: 'user', content: '再简短一点' }],
      followupText: '再简短一点',
      messages: [],
    })

    expect(messages.filter((message) => message.content === '再简短一点')).toHaveLength(1)
  })

  it('falls back to user messages for models without system-message support', () => {
    expect(adaptDesktopAssistantMessages([{ role: 'system', content: '规则' }], false)).toEqual([
      { role: 'user', content: '规则' },
    ])
  })

  it('builds readable persisted turns and a compact session title', () => {
    const request = {
      requestId: 'request-3',
      text: '  这是一段   很长的原文内容  ',
      action: { label: '总结' },
      conversation: [],
      followupText: '',
      messages: [],
    }

    expect(buildDesktopAssistantSessionTitle(request)).toBe('总结 · 这是一段 很长的原文内容')
    expect(buildDesktopAssistantSessionTurns(request, '摘要')).toEqual([
      { role: 'user', content: '操作：总结\n\n原文：\n这是一段   很长的原文内容' },
      { role: 'assistant', content: '摘要' },
    ])
  })

  it('rebuilds a deleted session from the floating conversation without duplicating the follow-up', () => {
    const request = {
      requestId: 'request-4',
      sessionId: 'deleted-session',
      text: '原文',
      action: { label: '总结' },
      conversation: [
        { role: 'user', content: '总结', initial_action: true },
        { role: 'assistant', content: '首轮回答' },
        { role: 'user', content: '再解释一下' },
      ],
      followupText: '再解释一下',
      messages: [],
    }

    expect(buildDesktopAssistantSessionTurns(request, '补充回答', true)).toEqual([
      { role: 'user', content: '操作：总结\n\n原文：\n原文' },
      { role: 'assistant', content: '首轮回答' },
      { role: 'user', content: '再解释一下' },
      { role: 'assistant', content: '补充回答' },
    ])
    expect(buildDesktopAssistantSessionTurns(request, '补充回答')).toEqual([
      { role: 'user', content: '再解释一下' },
      { role: 'assistant', content: '补充回答' },
    ])
    expect(buildDesktopAssistantSessionTurns(request, '补充回答')).toEqual([
      { role: 'user', content: '再解释一下' },
      { role: 'assistant', content: '补充回答' },
    ])
  })

  it('queues compose drafts until the chat input is mounted', () => {
    const events: Array<{ text: string }> = []
    expect(enqueueDesktopAssistantCompose('待交付草稿')).toBe(false)
    const unsubscribe = subscribeDesktopAssistantCompose((event) => events.push({ text: event.text }))

    expect(events).toEqual([{ text: '待交付草稿' }])
    expect(enqueueDesktopAssistantCompose('立即交付')).toBe(true)
    expect(events).toEqual([{ text: '待交付草稿' }, { text: '立即交付' }])
    unsubscribe()
  })

  it('defers a route-transition draft instead of delivering it to a stale input', () => {
    const stale: string[] = []
    const active: string[] = []
    const unsubscribeStale = subscribeDesktopAssistantCompose((event) => stale.push(event.text))
    expect(enqueueDesktopAssistantCompose('切换页面草稿', undefined, true)).toBe(false)
    expect(stale).toEqual([])
    unsubscribeStale()

    const unsubscribeActive = subscribeDesktopAssistantCompose((event) => active.push(event.text))
    expect(active).toEqual(['切换页面草稿'])
    unsubscribeActive()
  })

  it('clears the stream watchdog after a normal next without aborting', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const abort = vi.spyOn(controller, 'abort')
    const iterator = {
      next: vi.fn().mockResolvedValue({ done: false, value: { type: 'text-delta', text: '答复' } }),
      return: vi.fn(),
    }

    await expect(
      nextDesktopAssistantStreamPart(iterator, 1000, 'first-response', controller)
    ).resolves.toEqual({ done: false, value: { type: 'text-delta', text: '答复' } })
    vi.advanceTimersByTime(1001)

    expect(abort).not.toHaveBeenCalled()
    expect(iterator.return).not.toHaveBeenCalled()
  })

  it.each([
    ['first-response', '主对话模型未及时开始响应。'],
    ['idle', '主对话模型响应长时间没有进展。'],
  ] as const)('aborts and closes the iterator on %s timeout', async (phase, message) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const abort = vi.spyOn(controller, 'abort')
    const iterator = {
      next: vi.fn().mockReturnValue(new Promise(() => undefined)),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    }
    const pending = nextDesktopAssistantStreamPart(iterator, 1000, phase, controller)

    const assertion = expect(pending).rejects.toMatchObject({
      name: 'DesktopAssistantStreamTimeoutError',
      phase,
      message,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion

    expect(abort).toHaveBeenCalledOnce()
    expect(iterator.return).toHaveBeenCalledOnce()
    expect(pending).rejects.toBeInstanceOf(DesktopAssistantStreamTimeoutError)
  })
})
