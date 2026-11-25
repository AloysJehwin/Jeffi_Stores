// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// runStudioWithModel moves the studio's site-writing calls (the 'deep' hint) to another model for its scope; calls
// that name their own hint (copy work) keep it, and outside the scope nothing changes.

const m = vi.hoisted(() => ({ aiChat: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: m.aiChat }))
vi.mock('@/lib/ai/billing', () => ({ platformFunding: () => null, runPlatformFunded: (_l: string, _b: number, fn: () => unknown) => fn() }))
vi.mock('@/lib/ai/cost-meter', () => ({ metered: () => null }))
vi.mock('@/lib/site/ai-status', () => ({ AI_UNAVAILABLE_MESSAGE: 'down', noteSiteAiDown: vi.fn(), siteAiKnownDown: () => false }))

import { chat, runStudioWithModel } from '@/lib/site/studio/ai'

describe('runStudioWithModel', () => {
  it('swaps the deep hint inside its scope only', async () => {
    m.aiChat.mockResolvedValue({ content: 'ok', provider: 'anthropic', usage: { costInr: 0 } })
    await chat([{ role: 'user', content: 'x' }], { maxTokens: 10 })
    await runStudioWithModel('agent', async () => {
      await chat([{ role: 'user', content: 'x' }], { maxTokens: 10 })
      await chat([{ role: 'user', content: 'x' }], { maxTokens: 10, modelHint: 'copy' })
    })
    expect(m.aiChat.mock.calls.map(c => c[0].modelHint)).toEqual(['deep', 'agent', 'copy'])
  })
})
