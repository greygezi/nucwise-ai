export const VECTOR_RECALL_TOP_K = 20
export const VECTOR_RESULT_TOP_K = 8
export const RERANK_RESULT_TOP_K = 5
export const KNOWLEDGE_CONTEXT_CHARACTER_BUDGET = 128_000

type ScoredText = {
  score: number
  text?: unknown
}

export function applyKnowledgeContextBudget<T extends ScoredText>(
  results: T[],
  maxResults: number,
  characterBudget = KNOWLEDGE_CONTEXT_CHARACTER_BUDGET
) {
  const selected: T[] = []
  let usedCharacters = 0

  for (const result of results.slice(0, maxResults)) {
    const text = typeof result.text === 'string' ? result.text : ''
    const remaining = characterBudget - usedCharacters
    if (remaining <= 0) break
    if (text.length <= remaining) {
      selected.push(result)
      usedCharacters += text.length
      continue
    }
    if (selected.length === 0) {
      selected.push({ ...result, text: `${text.slice(0, remaining)}\n[片段因上下文预算已截断]` } as T)
    }
    break
  }

  return selected
}

export function selectVectorResults<T extends ScoredText>(
  results: T[],
  characterBudget = KNOWLEDGE_CONTEXT_CHARACTER_BUDGET
) {
  if (!results.length) return []
  const sorted = [...results].sort((left, right) => right.score - left.score)
  const bestScore = sorted[0].score
  const adaptiveThreshold = Math.max(0.25, bestScore - 0.18)
  const relevant = sorted.filter((result) => result.score >= adaptiveThreshold)
  const candidates = relevant.length >= 3 ? relevant : sorted.slice(0, 3)
  return applyKnowledgeContextBudget(candidates, VECTOR_RESULT_TOP_K, characterBudget)
}
