import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const searchOrdersForCustomer = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/shared/customer-notes', () => ({ searchOrdersForCustomer }))

import { GET } from '@storefront/app/api/(public)/staff/orders/search/route'

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const get = (qs = '') => GET(new NextRequest(`http://localhost/api/staff/orders/search${qs}`))

describe('GET /api/staff/orders/search', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: {} })
    searchOrdersForCustomer.mockResolvedValue([{ id: 'o1' }])
  })

  it('returns the guard denial as is', async () => {
    requireStaff.mockResolvedValue(NextResponse.json({ error: 'Sign in required' }, { status: 401 }))
    expect((await get(`?customerId=${CUSTOMER}`)).status).toBe(401)
    expect(searchOrdersForCustomer).not.toHaveBeenCalled()
  })

  it('400s without a valid customerId', async () => {
    expect((await get()).status).toBe(400)
    expect((await get('?customerId=nope')).status).toBe(400)
  })

  it('searches the customer orders with the query', async () => {
    expect(await (await get(`?customerId=${CUSTOMER}&q=ORD-1`)).json()).toEqual({ orders: [{ id: 'o1' }] })
    expect(searchOrdersForCustomer).toHaveBeenCalledWith(CUSTOMER, 'ORD-1')
  })
})
