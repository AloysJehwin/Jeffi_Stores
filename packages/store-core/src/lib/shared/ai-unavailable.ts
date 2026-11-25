import { AiClientError } from '@/lib/shared/ai-client'

// What an assistant says when no model can answer. Never a scripted stand-in for the model's reply.
export const ASSISTANT_UNAVAILABLE = 'The assistant is unavailable right now. Please try again in a few minutes.'

const DOWN_RE = /no credits|unreachable|fallback disabled|billing|quota|rate limit|timeout|abort|ECONNREFUSED|fetch failed|providers failed|not configured/i

/** True when the error means the gateway or every provider in the store's order failed. */
export function isAiUnavailable(err: unknown): boolean {
  if (err instanceof AiClientError) return true
  return DOWN_RE.test(String((err as Error)?.message ?? err ?? ''))
}

/** An agent's reply for a failed turn: an explicit 503 when no model could answer, else the error. */
export function assistantFailure(err: unknown): { status: number; body: { error: string; unavailable?: true } } {
  if (isAiUnavailable(err)) return { status: 503, body: { error: ASSISTANT_UNAVAILABLE, unavailable: true } }
  return { status: 502, body: { error: String((err as Error)?.message || 'AI request failed') } }
}
