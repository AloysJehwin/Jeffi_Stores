import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeDescriptorForPrompt: vi.fn(async () => 'Test Store, an online store') }))

import { POST as recapPOST } from '@/app/api/ai-recap/route'
import { POST as cartPOST } from '@/app/api/ai-cart-insight/route'
import { POST as affirmPOST } from '@/app/api/ai-affirmation/route'
import { aiChat } from '@/lib/shared/ai-client'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'

const mockAiChat = vi.mocked(aiChat)
const mockGate = vi.mocked(currentTenantPlanGate)

function req(url: string, body: unknown, { badJson = false } = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: badJson ? '{not json' : JSON.stringify(body),
  })
}

function aiOk(text: string) {
  return { content: JSON.stringify({ text }), provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false } as any
}

const CART = [{ name: 'M8 Bolt', qty: 4, brand: 'Unbrako', category: 'Fasteners' }]

beforeEach(() => {
  vi.clearAllMocks()
  mockGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
})

describe('POST /api/ai-recap', () => {
  it('returns { text } on success', async () => {
    mockAiChat.mockResolvedValueOnce(aiOk('A solid fastener kit.'))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART, total: 100, itemCount: 4 }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('A solid fastener kit.')
    expect(mockGate).toHaveBeenCalledWith('ai:storefront')
  })
  it('403 when the store plan has no storefront AI, without calling the model', async () => {
    mockGate.mockResolvedValueOnce({ allowed: false, plan: 'basic', upgradeRequired: 'pro' })
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART }))
    expect(res.status).toBe(403)
    expect((await res.json()).upgradeRequired).toBe('pro')
    expect(mockAiChat).not.toHaveBeenCalled()
  })
  it('400 on invalid JSON', async () => {
    const res = await recapPOST(req('http://localhost/api/ai-recap', {}, { badJson: true }))
    expect(res.status).toBe(400)
  })
  it('400 when cart is empty', async () => {
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: [] }))
    expect(res.status).toBe(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })
  it('503 when the gateway is unreachable', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART }))
    expect(res.status).toBe(503)
  })
  it('503 when the gateway returns an error status', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('AI gateway HTTP 500: err'))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/ai-cart-insight', () => {
  it('returns { text } on success', async () => {
    mockAiChat.mockResolvedValueOnce(aiOk('Kitting out a steel frame.'))
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: CART }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('Kitting out a steel frame.')
    const prompt = mockAiChat.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('Test Store, an online store')
    expect(prompt).not.toMatch(/building or working on/)
  })
  it('403 when the store plan has no storefront AI', async () => {
    mockGate.mockResolvedValueOnce({ allowed: false, plan: 'basic', upgradeRequired: 'pro' })
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: CART }))
    expect(res.status).toBe(403)
    expect(mockAiChat).not.toHaveBeenCalled()
  })
  it('400 on invalid JSON', async () => {
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', {}, { badJson: true }))
    expect(res.status).toBe(400)
  })
  it('400 when cart is empty', async () => {
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: [] }))
    expect(res.status).toBe(400)
  })
  it('503 when the gateway is unreachable', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('down'))
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: CART }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/ai-affirmation', () => {
  it('returns { text } on success', async () => {
    mockAiChat.mockResolvedValueOnce(aiOk('Great pick for the job.'))
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: ['M8 Bolt', 'Washer'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('Great pick for the job.')
  })
  it('400 on invalid JSON', async () => {
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', {}, { badJson: true }))
    expect(res.status).toBe(400)
  })
  it('400 when itemNames is empty', async () => {
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: [] }))
    expect(res.status).toBe(400)
  })
  it('502 when the model returns unparseable content', async () => {
    mockAiChat.mockResolvedValueOnce({
      content: 'not json at all',
      provider: 'ollama',
      model: 'm',
      latencyMs: 1,
      fallbackUsed: false,
    } as any)
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: ['X'] }))
    expect(res.status).toBe(502)
  })
  it('503 when the gateway is unreachable', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('down'))
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: ['X'] }))
    expect(res.status).toBe(503)
  })
})
