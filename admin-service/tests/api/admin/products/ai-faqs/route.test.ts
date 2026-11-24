import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/auth/ai-scope', () => ({ aiDenial: vi.fn(), parseAiJson: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeDescriptorForPrompt: vi.fn(async () => 'a shop') }))

import { POST } from '@admin/app/api/(admin)/admin/products/ai-faqs/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiChat } from '@/lib/shared/ai-client'
import { aiDenial, parseAiJson } from '@/lib/auth/ai-scope'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/admin/products/ai-faqs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(aiDenial).mockReturnValue(null as never)
    vi.mocked(aiChat).mockResolvedValue({ content: '{}' } as never)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ context: 'Shoe' })).status).toBe(401)
  })

  it('returns 403 when the AI scope denies', async () => {
    vi.mocked(aiDenial).mockReturnValue('No AI' as never)
    const res = await call({ context: 'Shoe' })
    expect(res.status).toBe(403)
    expect(aiDenial).toHaveBeenCalledWith('admin', [], 'products:write')
    expect(aiChat).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing or tiny context', async () => {
    expect((await call({ context: 'ab' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
  })

  it('returns trimmed FAQs, dropping duplicates of existing questions and capping the count', async () => {
    vi.mocked(parseAiJson).mockReturnValue({
      faqs: [
        { question: ' Is it waterproof? ', answer: ' No. ' },
        { question: 'Already asked', answer: 'x' },
        { question: 'Empty answer', answer: '' },
        { question: 'Q3', answer: 'A3' },
      ],
    } as never)
    const res = await call({ context: 'Shoe', existing: ['already asked'], count: 2 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      faqs: [
        { question: 'Is it waterproof?', answer: 'No.' },
        { question: 'Q3', answer: 'A3' },
      ],
    })
    const arg = vi.mocked(aiChat).mock.calls[0][0] as { messages: { content: string }[] }
    expect(arg.messages[0].content).toMatch(/Write 2 questions/)
    expect(arg.messages[1].content).toMatch(/Already answered:\n- already asked/)
  })

  it('returns 502 when nothing usable comes back', async () => {
    vi.mocked(parseAiJson).mockReturnValue({ faqs: [] } as never)
    expect((await call({ context: 'Shoe' })).status).toBe(502)
  })

  it('maps a provider error to its status, defaulting to 503', async () => {
    vi.mocked(aiChat).mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }))
    expect((await call({ context: 'Shoe' })).status).toBe(429)
    vi.mocked(aiChat).mockRejectedValueOnce(new Error('down'))
    expect((await call({ context: 'Shoe' })).status).toBe(503)
  })
})
