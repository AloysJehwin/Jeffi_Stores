import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const submitAddressChange = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))
vi.mock('@/lib/orders/address-change-request', () => ({ ORDER_ADDRESS_SELECT: 'SELECT o.* FROM orders o', submitAddressChange }))

import { POST, DELETE } from '@storefront/app/api/(public)/orders/[id]/address-change/route'

const ADDR = '11111111-1111-4111-8111-111111111111'
const ctx = { params: Promise.resolve({ id: 'o1' }) }
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('http://localhost/api/orders/o1/address-change', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    ctx
  )
const del = () => DELETE(new NextRequest('http://localhost/api/orders/o1/address-change', { method: 'DELETE' }), ctx)

describe('POST /api/orders/[id]/address-change', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    queryOne.mockResolvedValue({ id: 'o1' })
    submitAddressChange.mockResolvedValue({ ok: true, request: { id: 'r1', status: 'pending' } })
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post({ addressId: ADDR })).status).toBe(401)
  })

  it('400s on an invalid address id', async () => {
    expect((await post({ addressId: 'nope' })).status).toBe(400)
    expect(submitAddressChange).not.toHaveBeenCalled()
  })

  it('404s when the caller does not own the order', async () => {
    queryOne.mockResolvedValue(null)
    expect((await post({ addressId: ADDR })).status).toBe(404)
    expect(queryOne.mock.calls[0][1]).toEqual(['o1', 'u1'])
  })

  it('submits the change request for the owner', async () => {
    const res = await post({ addressId: ADDR })
    expect(await res.json()).toEqual({ success: true, request: { id: 'r1', status: 'pending' } })
    expect(submitAddressChange).toHaveBeenCalledWith({ id: 'o1' }, ADDR, 'u1')
  })

  it('also matches business-sourced orders by contact for the business portal', async () => {
    queryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM users') ? { email: 'b@x.test', phone: '99' } : { id: 'o1' }
    )
    await post({ addressId: ADDR }, { 'x-auth-portal': 'business' })
    const [sql, args] = queryOne.mock.calls[1]
    expect(sql).toContain("o.source = 'business'")
    expect(args).toEqual(['o1', 'u1', 'b@x.test', '99'])
  })

  it('passes the service refusal through, flagging an unserviceable pincode', async () => {
    submitAddressChange.mockResolvedValue({ ok: false, status: 422, error: 'We do not deliver there', unserviceable: true })
    const res = await post({ addressId: ADDR })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'We do not deliver there', unserviceable: true })
  })

  it('500s when submission throws', async () => {
    submitAddressChange.mockRejectedValue(new Error('db'))
    const res = await post({ addressId: ADDR })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db')
  })
})

describe('DELETE /api/orders/[id]/address-change', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await del()).status).toBe(401)
  })

  it('404s when nothing is pending', async () => {
    queryOne.mockResolvedValue(null)
    expect((await del()).status).toBe(404)
  })

  it('cancels only the caller own pending request', async () => {
    queryOne.mockResolvedValue({ id: 'r1' })
    const res = await del()
    expect(await res.json()).toEqual({ success: true })
    const [sql, args] = queryOne.mock.calls[0]
    expect(sql).toContain("status = 'cancelled'")
    expect(args).toEqual(['o1', 'u1'])
  })

  it('500s on a database error', async () => {
    queryOne.mockRejectedValue(new Error('db'))
    expect((await del()).status).toBe(500)
  })
})
