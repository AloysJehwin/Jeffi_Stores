import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/payments/upi/settings', () => ({ handleUpiSettingsGet: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/integrations/upi/route'
import { handleUpiSettingsGet } from '@/lib/payments/upi/settings'

const req = () => new NextRequest('http://localhost/api/admin/integrations/upi')

describe('GET integrations/upi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates to the UPI settings handler', async () => {
    vi.mocked(handleUpiSettingsGet).mockResolvedValue(NextResponse.json({ provider: 'vpa' }))
    const r = req()
    expect(await (await GET(r)).json()).toEqual({ provider: 'vpa' })
    expect(handleUpiSettingsGet).toHaveBeenCalledWith(r)
  })

  it('passes through an auth rejection', async () => {
    vi.mocked(handleUpiSettingsGet).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
  })
})
