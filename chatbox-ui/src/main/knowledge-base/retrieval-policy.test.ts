import { describe, expect, it } from 'vitest'
import {
  applyKnowledgeContextBudget,
  KNOWLEDGE_CONTEXT_CHARACTER_BUDGET,
  selectVectorResults,
  VECTOR_RESULT_TOP_K,
} from './retrieval-policy'

describe('knowledge base retrieval policy', () => {
  it('limits vector-only retrieval by score and result count', () => {
    const results = Array.from({ length: 20 }, (_, index) => ({
      id: index,
      score: 0.92 - index * 0.04,
      text: `chunk-${index}`,
    }))
    const selected = selectVectorResults(results)
    expect(selected.length).toBeLessThanOrEqual(VECTOR_RESULT_TOP_K)
    expect(selected.map((item) => item.id)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps a minimum of three candidates when scores are weak', () => {
    const selected = selectVectorResults([
      { id: 1, score: 0.2, text: 'a' },
      { id: 2, score: 0.1, text: 'b' },
      { id: 3, score: 0.05, text: 'c' },
      { id: 4, score: 0.01, text: 'd' },
    ])
    expect(selected.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('enforces the configured context character budget', () => {
    const selected = applyKnowledgeContextBudget(
      [
        { id: 1, score: 0.9, text: 'a'.repeat(60_000) },
        { id: 2, score: 0.8, text: 'b'.repeat(60_000) },
        { id: 3, score: 0.7, text: 'c'.repeat(60_000) },
      ],
      5
    )
    expect(selected).toHaveLength(2)
    expect(selected.reduce((total, item) => total + String(item.text).length, 0)).toBeLessThanOrEqual(
      KNOWLEDGE_CONTEXT_CHARACTER_BUDGET
    )
  })
})
