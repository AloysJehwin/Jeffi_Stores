import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))

vi.mock('@/lib/marketplace-ads/console', () => ({ MADS_TABS: ['overview'], loadMadsTab: vi.fn() }))
vi.mock('@/lib/marketplace-ads/import', () => ({
  MAX_BYTES: 10 * 1024 * 1024,
  ReportError: class ReportError extends Error {},
  commitImport: vi.fn(),
  previewImport: vi.fn(),
}))

import { POST } from '@admin/app/api/(admin)/admin/flipkart-ads/import/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ReportError, commitImport, previewImport } from '@/lib/marketplace-ads/import'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

function post(step: string | null, fields: Record<string, string> = {}, file: File | null = new File(['a,b\n1,2'], 'report.csv')) {
  const form = new FormData()
  if (file) form.set('file', file)
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return POST(new NextRequest(`http://localhost/api/admin/flipkart-ads/import${step ? `?step=${step}` : ''}`, { method: 'POST', body: form }))
}

describe('POST /api/admin/flipkart-ads/import', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post('preview')).status).toBe(401)
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('403 without the flipkart_ads:write scope', async () => {
    deny(403)
    expect((await post('preview')).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'flipkart_ads:write')
  })

  it('403 when the plan gate refuses', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
    const res = await post('preview')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro' })
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('400 for an unknown step', async () => {
    expect((await post('nope')).status).toBe(400)
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('400 when no report file is sent', async () => {
    const res = await post('preview', {}, null)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Choose a report file/)
  })

  it('400 for a file over 10 MB', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv')
    const res = await post('preview', {}, big)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10 MB/)
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('previews the file for this market with the parsed column mapping', async () => {
    vi.mocked(previewImport).mockResolvedValue({ rows: 1 } as any)
    const res = await post('preview', { mapping: JSON.stringify({ campaign: 'Campaign Name', bogus: 'x' }), from: '2026-01-01', to: '2026-01-31' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { rows: 1 } })
    const input = vi.mocked(previewImport).mock.calls[0][0]
    expect(input).toMatchObject({ market: 'flipkart', fileName: 'report.csv', period: { from: '2026-01-01', to: '2026-01-31' } })
    expect(input.mapping).not.toHaveProperty('bogus')
    expect(commitImport).not.toHaveBeenCalled()
  })

  it('defaults to preview when no step is given', async () => {
    vi.mocked(previewImport).mockResolvedValue({} as any)
    expect((await post(null)).status).toBe(200)
    expect(previewImport).toHaveBeenCalledTimes(1)
  })

  it('commit replaces the period, attributed to the admin, and returns 400 when not ok', async () => {
    vi.mocked(commitImport).mockResolvedValueOnce({ ok: true, imported: 3 } as any)
    const ok = await post('commit', { allowErrors: 'true' })
    expect(ok.status).toBe(200)
    expect(commitImport).toHaveBeenCalledWith(expect.objectContaining({ market: 'flipkart', allowErrors: true }), { adminId: 'a1', email: 'a@x.in' })
    vi.mocked(commitImport).mockResolvedValueOnce({ ok: false, errors: ['bad row'] } as any)
    expect((await post('commit')).status).toBe(400)
  })

  it('400 with the message when the report is unreadable', async () => {
    vi.mocked(previewImport).mockRejectedValue(new ReportError('Not a report'))
    const res = await post('preview')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Not a report' })
  })

  it('500 when the import fails unexpectedly', async () => {
    vi.mocked(commitImport).mockRejectedValue(new Error('boom'))
    expect((await post('commit')).status).toBe(500)
  })
})
