import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/google-sheets', () => ({ syncAllProductsToSheet: vi.fn() }))

import { POST } from '@/app/api/admin/merchant/sheet-sync/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { syncAllProductsToSheet } from '@/lib/shared/google-sheets'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockSync = vi.mocked(syncAllProductsToSheet)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }

function makeRequest(body: object = {}) {
  return new NextRequest('http://localhost/api/admin/merchant/sheet-sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRequestInvalidJson() {
  return new NextRequest('http://localhost/api/admin/merchant/sheet-sync', {
    method: 'POST',
    body: 'not-json',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/admin/merchant/sheet-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('syncs all products and returns result', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSync.mockResolvedValue({ synced: 150, errors: 0 } as any)

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.synced).toBe(150)
    expect(mockSync).toHaveBeenCalledWith(undefined)
  })

  it('passes testLimit when provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSync.mockResolvedValue({ synced: 5, errors: 0 } as any)

    const res = await POST(makeRequest({ testLimit: 5 }))
    expect(res.status).toBe(200)
    expect(mockSync).toHaveBeenCalledWith(5)
  })

  it('handles invalid JSON body gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSync.mockResolvedValue({ synced: 0, errors: 0 } as any)

    const res = await POST(makeRequestInvalidJson())
    expect(res.status).toBe(200)
    expect(mockSync).toHaveBeenCalledWith(undefined)
  })

  it('returns 500 on sync error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSync.mockRejectedValue(new Error('Google Sheets API error'))

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Google Sheets API error')
  })
})
