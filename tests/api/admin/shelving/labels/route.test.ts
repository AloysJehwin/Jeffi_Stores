import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

vi.mock('@/lib/label-pdf', () => ({
  generateShelfLabelPDF: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/shelving/labels/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { generateShelfLabelPDF } from '@/lib/label-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generateShelfLabelPDF)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['inventory'],
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/shelving/labels', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

const fakePdfBuffer = Buffer.from('fake-pdf-content')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/shelving/labels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ location_ids: ['loc-1'] }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when inventory scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ location_ids: ['loc-1'] }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/forbidden/i)
  })

  it('returns 400 when no location_ids and no direct items', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/location_ids required/i)
  })

  it('returns 400 when location_ids is empty array', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ location_ids: [] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/location_ids required/i)
  })

  it('returns 400 when too many location_ids (>100)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const ids = Array.from({ length: 101 }, (_, i) => `loc-${i}`)
    const res = await POST(makeRequest({ location_ids: ids }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/maximum 100/i)
  })

  it('returns 404 when no DB rows found for location_ids', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeRequest({ location_ids: ['loc-missing'] }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/no locations found/i)
  })

  it('generates PDF from DB rows and returns it', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([{ display_code: 'A-01-01', warehouse_name: 'Main WH' }] as any)
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)
    const res = await POST(makeRequest({ location_ids: ['loc-1'] }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/shelf-labels/)
    expect(mockGeneratePDF).toHaveBeenCalledWith([{ displayCode: 'A-01-01', warehouseName: 'Main WH' }], 1)
  })

  it('uses direct items when provided instead of DB query', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)
    const directItems = [{ displayCode: 'B-02-01', warehouseName: 'East WH' }]
    const res = await POST(makeRequest({ items: directItems, copies: 3 }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).not.toHaveBeenCalled()
    expect(mockGeneratePDF).toHaveBeenCalledWith(directItems, 3)
  })

  it('clamps copies to min 1 and max 50', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)
    const directItems = [{ displayCode: 'C-01-01', warehouseName: 'WH' }]
    await POST(makeRequest({ items: directItems, copies: 999 }))
    expect(mockGeneratePDF).toHaveBeenCalledWith(directItems, 50)
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)
    await POST(makeRequest({ items: directItems, copies: -5 }))
    expect(mockGeneratePDF).toHaveBeenCalledWith(directItems, 1)
  })

  it('returns 500 when PDF generation throws', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGeneratePDF.mockRejectedValue(new Error('PDF generation error'))
    const directItems = [{ displayCode: 'D-01-01', warehouseName: 'WH' }]
    const res = await POST(makeRequest({ items: directItems }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('PDF generation error')
  })
})
