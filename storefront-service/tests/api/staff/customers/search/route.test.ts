import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const searchCustomers = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/shared/customer-notes', () => ({ searchCustomers }))

import { GET } from '@storefront/app/api/(public)/staff/customers/search/route'

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/staff/customers/search${qs}`))

describe('GET /api/staff/customers/search', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: {} })
    searchCustomers.mockResolvedValue([{ id: 'c1', name: 'Asha' }])
  })

  it('returns the guard denial as is and searches nothing', async () => {
    requireStaff.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await get('?q=a')).status).toBe(403)
    expect(searchCustomers).not.toHaveBeenCalled()
  })

  it('searches with the query', async () => {
    expect(await (await get('?q=asha')).json()).toEqual({ customers: [{ id: 'c1', name: 'Asha' }] })
    expect(searchCustomers).toHaveBeenCalledWith('asha')
    expect(requireStaff).toHaveBeenCalledWith(expect.anything(), 'customers:read')
  })

  it('uses an empty query when none is given', async () => {
    await get()
    expect(searchCustomers).toHaveBeenCalledWith('')
  })
})
