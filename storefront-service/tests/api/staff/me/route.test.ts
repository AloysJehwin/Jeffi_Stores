import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireStaff = vi.hoisted(() => vi.fn())
const hasPlanScope = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/staff-auth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireStaff, isStaffDenied: (x: unknown) => x instanceof NextResponse }
})
vi.mock('@/lib/auth/plan-gate', () => ({ hasPlanScope }))

import { GET } from '@storefront/app/api/(public)/staff/me/route'

const get = () => GET(new NextRequest('http://localhost/api/staff/me'))

describe('GET /api/staff/me', () => {
  beforeEach(() => {
    requireStaff.mockResolvedValue({ session: { email: 's@x.test', name: 'Ravi', role: 'staff', scopes: ['customers:read'] } })
    hasPlanScope.mockResolvedValue(true)
  })

  it('returns the guard denial (401/403) as is', async () => {
    requireStaff.mockResolvedValue(NextResponse.json({ error: 'Sign in required' }, { status: 401 }))
    expect((await get()).status).toBe(401)
    expect(requireStaff).toHaveBeenCalledWith(expect.anything(), 'customers:read')
  })

  it('returns the identity and whether the plan lets them write', async () => {
    expect(await (await get()).json()).toEqual({ email: 's@x.test', name: 'Ravi', canWrite: true })
    expect(hasPlanScope).toHaveBeenCalledWith('staff', ['customers:read'], 'customers:write')
  })

  it('reports read-only staff', async () => {
    hasPlanScope.mockResolvedValue(false)
    expect((await (await get()).json()).canWrite).toBe(false)
  })
})
