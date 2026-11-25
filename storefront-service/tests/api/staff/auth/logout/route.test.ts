import { describe, it, expect, vi } from 'vitest'
import { NextResponse } from 'next/server'

const clearStaffCookie = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/staff-session', () => ({ clearStaffCookie }))

import { POST } from '@storefront/app/api/(public)/staff/auth/logout/route'

describe('POST /api/staff/auth/logout', () => {
  it('clears the staff cookie on an ok response', async () => {
    clearStaffCookie.mockImplementation((res: NextResponse) => {
      res.headers.set('set-cookie', 'staff_session=; Max-Age=0')
      return res
    })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(clearStaffCookie).toHaveBeenCalledTimes(1)
  })
})
