import { describe, it, expect } from 'vitest'
import { AiClientError } from '@/lib/shared/ai-client'
import { ASSISTANT_UNAVAILABLE, assistantFailure, isAiUnavailable } from '@/lib/shared/ai-unavailable'

describe('assistant unavailable', () => {
  it('treats any gateway/provider failure as unavailable', () => {
    expect(isAiUnavailable(new AiClientError('AI gateway HTTP 503: all text providers failed', 'gateway'))).toBe(true)
    expect(isAiUnavailable(new Error('fetch failed'))).toBe(true)
    expect(isAiUnavailable(new Error('no text provider in the requested order is not configured'))).toBe(true)
    expect(isAiUnavailable(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })

  it('maps a dead model to an explicit 503, never provider internals', () => {
    expect(assistantFailure(new AiClientError('AI gateway HTTP 502: {"error":"anthropic 529"}', 'gateway'))).toEqual({
      status: 503,
      body: { error: ASSISTANT_UNAVAILABLE, unavailable: true },
    })
  })

  it('keeps a programming error as a 502 with its message', () => {
    expect(assistantFailure(new Error('tool table missing'))).toEqual({ status: 502, body: { error: 'tool table missing' } })
  })
})
