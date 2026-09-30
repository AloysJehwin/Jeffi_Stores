import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/ai-client', () => ({
  aiChat: vi.fn(),
  AiClientError: class AiClientError extends Error {},
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/reviews/generate/route'
import { aiChat } from '@/lib/ai-client'

const mockAiChat = vi.mocked(aiChat)

function makeRequest(body: object) {
  return new Request('http://localhost/api/reviews/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/reviews/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when productName is missing', async () => {
    const res = await POST(makeRequest({ rating: 5, tags: [] }) as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when rating is out of range', async () => {
    const res = await POST(makeRequest({ productName: 'Bolt', rating: 6, tags: [] }) as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when tags array is too large', async () => {
    const res = await POST(makeRequest({ productName: 'Bolt', rating: 4, tags: Array(9).fill('tag') }) as any)
    expect(res.status).toBe(400)
  })

  it('returns generated review text on success', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: '  Great bolt, really strong na!  ',
      provider: 'openai',
      model: 'gpt-4o-mini',
    } as any)

    const res = await POST(
      makeRequest({ productName: 'Hex Bolt M6', rating: 5, tags: ['durable', 'good quality'] }) as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.review).toBe('Great bolt, really strong na!') // trimmed
  })

  it('calls aiChat with correct parameters', async () => {
    mockAiChat.mockResolvedValueOnce({ content: 'Nice product', provider: 'openai', model: 'gpt-4o-mini' } as any)

    await POST(makeRequest({ productName: 'Socket Screw', rating: 4, tags: ['strong'] }) as any)

    expect(mockAiChat).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.9,
        maxTokens: 150,
        modelHint: 'copy',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('Socket Screw') }),
        ]),
      })
    )
  })

  it('includes tag line in prompt when tags provided', async () => {
    mockAiChat.mockResolvedValueOnce({ content: 'Good product', provider: 'openai', model: 'gpt-4o-mini' } as any)

    await POST(makeRequest({ productName: 'Bolt', rating: 3, tags: ['average quality', 'delivered fast'] }) as any)

    const promptArg = mockAiChat.mock.calls[0][0].messages[0].content
    expect(promptArg).toContain('average quality')
    expect(promptArg).toContain('delivered fast')
  })

  it('does not include tag line when tags is empty', async () => {
    mockAiChat.mockResolvedValueOnce({ content: 'Ok product', provider: 'openai', model: 'gpt-4o-mini' } as any)

    await POST(makeRequest({ productName: 'Nut', rating: 3, tags: [] }) as any)

    const promptArg = mockAiChat.mock.calls[0][0].messages[0].content
    expect(promptArg).not.toContain('The customer selected these aspects')
  })

  it('uses correct feel text for each rating', async () => {
    const feels: Record<number, string> = {
      1: 'very disappointed',
      2: 'not impressed',
      3: 'okay, mixed feelings',
      4: 'quite happy',
      5: 'really happy',
    }
    for (const [rating, feel] of Object.entries(feels)) {
      vi.clearAllMocks()
      mockAiChat.mockResolvedValueOnce({ content: 'test', provider: 'openai', model: 'gpt-4o-mini' } as any)
      await POST(makeRequest({ productName: 'Bolt', rating: Number(rating), tags: [] }) as any)
      const prompt = mockAiChat.mock.calls[0][0].messages[0].content
      expect(prompt).toContain(feel)
    }
  })

  it('returns 500 when aiChat throws', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('AI down'))

    const res = await POST(makeRequest({ productName: 'Bolt', rating: 4, tags: [] }) as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed to generate review')
  })
})
