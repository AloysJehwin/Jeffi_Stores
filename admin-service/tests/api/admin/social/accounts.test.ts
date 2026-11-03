import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ saveTenantSocialAccount: vi.fn(), deleteTenantSocialAccount: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: (s: string) => `enc:${s}` }))
vi.mock('@/lib/catalog/meta', () => ({ getPageInfo: vi.fn() }))

import { POST, DELETE } from '@admin/app/api/(admin)/admin/social/accounts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { saveTenantSocialAccount, deleteTenantSocialAccount } from '@/lib/tenant-registry'
import { getPageInfo } from '@/lib/catalog/meta'

const TOKEN = 'EAAG' + 'x'.repeat(40)
const req = (method: string, body?: unknown) =>
  new NextRequest('https://admin-acme.jeffistores.in/api/admin/social/accounts', {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't-acme' } as any)
  vi.mocked(getPageInfo).mockResolvedValue({ pageId: '1234567', pageName: 'Acme', igUserId: '7654321' })
})

describe('manual Meta Page token', () => {
  it('verifies the token against the Page and stores FB + the linked IG account', async () => {
    const res = (await POST(req('POST', { page_id: '1234567', access_token: TOKEN })))!
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, page_name: 'Acme', instagram: true })
    expect(getPageInfo).toHaveBeenCalledWith('1234567', TOKEN)
    const rows = vi.mocked(saveTenantSocialAccount).mock.calls.map(c => c[0])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      tenantId: 't-acme',
      provider: 'facebook',
      pageId: '1234567',
      accessTokenEnc: `enc:${TOKEN}`,
    })
    expect(rows[1]).toMatchObject({ provider: 'instagram', igUserId: '7654321' })
  })

  it('uses an explicit IG account id and clears IG when there is none', async () => {
    await POST(req('POST', { page_id: '1234567', access_token: TOKEN, ig_user_id: '999999' }))
    expect(vi.mocked(saveTenantSocialAccount).mock.calls[1][0].igUserId).toBe('999999')
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't-acme' } as any)
    vi.mocked(getPageInfo).mockResolvedValue({ pageId: '1234567', pageName: 'Acme', igUserId: null })
    await POST(req('POST', { page_id: '1234567', access_token: TOKEN }))
    expect(saveTenantSocialAccount).toHaveBeenCalledTimes(1)
    expect(deleteTenantSocialAccount).toHaveBeenCalledWith('t-acme', 'instagram')
  })

  it('rejects a token Meta refuses, without storing it', async () => {
    vi.mocked(getPageInfo).mockRejectedValue(new Error('Meta GET 1234567 failed (400): Invalid OAuth access token'))
    const res = (await POST(req('POST', { page_id: '1234567', access_token: TOKEN })))!
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid OAuth access token/)
    expect(saveTenantSocialAccount).not.toHaveBeenCalled()
  })

  it.each([
    [{ page_id: 'acme', access_token: TOKEN }, /numeric/],
    [{ page_id: '1234567', access_token: 'short' }, /Page access token/],
    [{ page_id: '1234567', access_token: TOKEN, ig_user_id: 'ig' }, /numeric/],
  ])('validates input %#', async (body, msg) => {
    const res = (await POST(req('POST', body)))!
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(getPageInfo).not.toHaveBeenCalled()
  })

  it('disconnect removes both rows for the current tenant', async () => {
    expect((await DELETE(req('DELETE')))!.status).toBe(200)
    expect(deleteTenantSocialAccount).toHaveBeenCalledWith('t-acme')
  })
})
