import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const storefrontAiGate = vi.hoisted(() => vi.fn())
const storefrontAiField = vi.hoisted(() => vi.fn())
vi.mock('@/lib/shared/storefront-ai', () => ({ storefrontAiGate, storefrontAiField }))

import { POST } from '@storefront/app/api/(public)/ai-pitch/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/ai-pitch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('POST /api/ai-pitch', () => {
  beforeEach(() => {
    storefrontAiGate.mockResolvedValue(null)
    storefrontAiField.mockResolvedValue(NextResponse.json({ pitch: 'A sturdy drill.' }))
  })

  it('is blocked when the plan has no storefront AI', async () => {
    storefrontAiGate.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await post({ productName: 'Drill' })).status).toBe(403)
    expect(storefrontAiField).not.toHaveBeenCalled()
  })

  it('400s on invalid JSON and a missing or short product name', async () => {
    expect((await post('{bad')).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ productName: ' a ' })).status).toBe(400)
    expect((await post({ productName: 42 })).status).toBe(400)
  })

  it('builds the prompt from the product context and returns the pitch', async () => {
    const res = await post({ productName: ' Drill ', brand: 'Bosch', category: null })
    expect(await res.json()).toEqual({ pitch: 'A sturdy drill.' })
    const [prompt, field] = storefrontAiField.mock.calls[0]
    expect(field).toBe('pitch')
    expect(prompt).toContain('Product: Drill, Bosch')
  })

  it('passes an AI failure response through', async () => {
    storefrontAiField.mockResolvedValue(NextResponse.json({ error: 'Bad AI response' }, { status: 502 }))
    expect((await post({ productName: 'Drill' })).status).toBe(502)
  })
})
