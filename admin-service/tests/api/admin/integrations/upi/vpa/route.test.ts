import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/payments/upi/settings', () => ({ handleUpiVpaPut: vi.fn() }))

import { PUT } from '@admin/app/api/(admin)/admin/integrations/upi/vpa/route'
import { handleUpiVpaPut } from '@/lib/payments/upi/settings'

const req = () => new NextRequest('http://localhost/api/admin/integrations/upi/vpa', { method: 'PUT', body: JSON.stringify({ vpa: 'shop@upi' }) })

describe('PUT integrations/upi/vpa', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates to the VPA handler', async () => {
    vi.mocked(handleUpiVpaPut).mockResolvedValue(NextResponse.json({ ok: true }))
    const r = req()
    expect(await (await PUT(r)).json()).toEqual({ ok: true })
    expect(handleUpiVpaPut).toHaveBeenCalledWith(r)
  })

  it('passes through owner-only and validation failures', async () => {
    vi.mocked(handleUpiVpaPut).mockResolvedValueOnce(NextResponse.json({ error: 'Only the owner' }, { status: 403 }))
    expect((await PUT(req())).status).toBe(403)
    vi.mocked(handleUpiVpaPut).mockResolvedValueOnce(NextResponse.json({ error: 'Bad VPA' }, { status: 400 }))
    expect((await PUT(req())).status).toBe(400)
  })
})
