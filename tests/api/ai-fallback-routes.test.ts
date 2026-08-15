import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock global fetch (the Ollama call) before importing the routes.
const mockFetch = vi.fn()
global.fetch = mockFetch as any

import { POST as recapPOST } from '@/app/api/ai-recap/route'
import { POST as cartPOST } from '@/app/api/ai-cart-insight/route'
import { POST as affirmPOST } from '@/app/api/ai-affirmation/route'

function req(url: string, body: unknown, { badJson = false } = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: badJson ? '{not json' : JSON.stringify(body),
  })
}

function ollamaOk(text: string) {
  return { ok: true, json: async () => ({ message: { content: JSON.stringify({ text }) } }) }
}
function ollamaHttpFail(status = 500) {
  return { ok: false, status, text: async () => 'err', json: async () => ({}) }
}

const CART = [{ name: 'M8 Bolt', qty: 4, brand: 'Unbrako', category: 'Fasteners' }]

beforeEach(() => vi.clearAllMocks())

describe('POST /api/ai-recap', () => {
  it('returns { text } on success', async () => {
    mockFetch.mockResolvedValueOnce(ollamaOk('A solid fastener kit.'))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART, total: 100, itemCount: 4 }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('A solid fastener kit.')
  })
  it('400 on invalid JSON', async () => {
    const res = await recapPOST(req('http://localhost/api/ai-recap', {}, { badJson: true }))
    expect(res.status).toBe(400)
  })
  it('400 when cart is empty', async () => {
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: [] }))
    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('503 when Ollama is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART }))
    expect(res.status).toBe(503)
  })
  it('503 when Ollama returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce(ollamaHttpFail(500))
    const res = await recapPOST(req('http://localhost/api/ai-recap', { cart: CART }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/ai-cart-insight', () => {
  it('returns { text } on success', async () => {
    mockFetch.mockResolvedValueOnce(ollamaOk('Building a steel frame.'))
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: CART }))
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('Building a steel frame.')
  })
  it('400 on invalid JSON', async () => {
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', {}, { badJson: true }))
    expect(res.status).toBe(400)
  })
  it('400 when cart is empty', async () => {
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: [] }))
    expect(res.status).toBe(400)
  })
  it('503 when Ollama is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('down'))
    const res = await cartPOST(req('http://localhost/api/ai-cart-insight', { cart: CART }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/ai-affirmation', () => {
  it('returns { text } on success', async () => {
    mockFetch.mockResolvedValueOnce(ollamaOk('Great pick for the job.'))
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
  it('502 when Ollama returns unparseable content', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: { content: 'not json at all' } }) })
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: ['X'] }))
    expect(res.status).toBe(502)
  })
  it('503 when Ollama is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('down'))
    const res = await affirmPOST(req('http://localhost/api/ai-affirmation', { itemNames: ['X'] }))
    expect(res.status).toBe(503)
  })
})
