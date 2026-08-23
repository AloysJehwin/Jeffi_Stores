/**
 * Tests for src/lib/social/content.ts — caption + hashtag generation.
 *
 * Pins: caption falls back to a deterministic string when the LLM is down (never throws);
 * hashtags come back as space-joined '#tag' tokens, respect `max`, and are reach-ranked via
 * the IG Hashtag Search API only when an IG account is supplied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductForPost } from '@/lib/social/content'

// aiChat is the LLM seam.
const ai = { aiChat: vi.fn() }
vi.mock('@/lib/ai-client', () => ai)

// meta.ts provides the reach-ranking call.
const meta = { searchHashtagReach: vi.fn() }
vi.mock('@/lib/meta', () => meta)

const PRODUCT: ProductForPost = {
  name: 'Torque Wrench Pro',
  category: 'Hand Tools',
  brand: 'Unbrako',
  description: 'A precise clicking torque wrench.',
  attributes: { size: '1/2 inch', grade: '12.9' },
}

describe('social/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateCaption', () => {
    it('returns the LLM caption when aiChat succeeds', async () => {
      ai.aiChat.mockResolvedValue({ content: 'Grip it and rip it 🔧' })
      const { generateCaption } = await import('@/lib/social/content')
      expect(await generateCaption(PRODUCT, 'Jeffi Stores')).toBe('Grip it and rip it 🔧')
    })

    it('falls back to a deterministic caption when aiChat throws', async () => {
      ai.aiChat.mockRejectedValue(new Error('ollama down'))
      const { generateCaption } = await import('@/lib/social/content')
      const caption = await generateCaption(PRODUCT, 'Jeffi Stores')
      expect(caption).toBe('Torque Wrench Pro — now available at Jeffi Stores. Shop today!')
    })

    it('falls back when the LLM returns empty content', async () => {
      ai.aiChat.mockResolvedValue({ content: '   ' })
      const { generateCaption } = await import('@/lib/social/content')
      const caption = await generateCaption(PRODUCT, 'Jeffi Stores')
      expect(caption).toContain('now available at Jeffi Stores')
    })
  })

  describe('generateHashtags', () => {
    it('returns #-prefixed, space-joined tags from the default provider', async () => {
      const { generateHashtags } = await import('@/lib/social/content')
      const out = await generateHashtags(PRODUCT)
      expect(meta.searchHashtagReach).not.toHaveBeenCalled()
      expect(out.split(' ').every((t) => t.startsWith('#'))).toBe(true)
      expect(out).toContain('#torquewrenchpro')
      expect(out).toContain('#onlineshopping')
    })

    it('respects the max option', async () => {
      const { generateHashtags } = await import('@/lib/social/content')
      const out = await generateHashtags(PRODUCT, { max: 3 })
      expect(out.split(' ')).toHaveLength(3)
    })

    it('reach-ranks via searchHashtagReach when igUserId + accessToken are given', async () => {
      // Higher reach should sort first.
      meta.searchHashtagReach.mockImplementation(async (_ig: string, tag: string) =>
        tag === 'sale' ? 9999 : 1,
      )
      const { generateHashtags } = await import('@/lib/social/content')
      const out = await generateHashtags(PRODUCT, { igUserId: 'ig_1', accessToken: 'tok', max: 2 })
      expect(meta.searchHashtagReach).toHaveBeenCalled()
      expect(meta.searchHashtagReach).toHaveBeenCalledWith('ig_1', expect.any(String), 'tok')
      expect(out.split(' ')[0]).toBe('#sale')
    })

    it('uses a custom provider when supplied', async () => {
      const provider = { suggest: vi.fn().mockResolvedValue(['alpha', 'beta']) }
      const { generateHashtags } = await import('@/lib/social/content')
      const out = await generateHashtags(PRODUCT, { provider })
      expect(provider.suggest).toHaveBeenCalledWith(PRODUCT)
      expect(out).toBe('#alpha #beta')
    })
  })
})
