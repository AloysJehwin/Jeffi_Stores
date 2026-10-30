import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'

// The quotation routes forward to document-service through @/lib/documents/proxy; the handler
// logic (and its tests) live in document-service. These cover auth + what gets forwarded.

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
}))

import { GET as quotationsGET, POST as quotationsPOST } from '@controller/app/api/(admin)/admin/quotations/route'
import {
  GET as quotationByIdGET,
  PATCH as quotationByIdPATCH,
  DELETE as quotationByIdDELETE,
} from '@controller/app/api/(admin)/admin/quotations/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['quotations'] }
const QUOTE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const LIST = 'http://localhost/api/admin/quotations'
const ONE = `${LIST}/${QUOTE_ID}`
const ctx = { params: Promise.resolve({ id: QUOTE_ID }) }

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  )
}

const ok = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })

let fetchMock: MockInstance<typeof fetch>

beforeEach(() => {
  process.env.SERVICE_AUTH_SECRET = 'test-secret'
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
})

/** [path forwarded to document-service, method] of every fetch, in order. */
const forwarded = () =>
  fetchMock.mock.calls.map(([url, init]) => [String(url).replace(/^.*?\/admin\//, '/admin/'), init?.method])

describe('quotation routes forward to document-service', () => {
  it('GET list needs quotations:read and keeps the query string', async () => {
    const res = await quotationsGET(req(`${LIST}?status=draft&q=acme&page=2&pageSize=50`))
    expect(res.status).toBe(200)
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, 'quotations:read')
    expect(forwarded()).toEqual([['/admin/quotations?status=draft&q=acme&page=2&pageSize=50', 'GET']])
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('POST create needs quotations:write and forwards the body', async () => {
    const body = { consignee_name: 'Acme', items: [{ description: 'Bolt M6', quantity: 10, rate: 50 }] }
    const res = await quotationsPOST(req(LIST, 'POST', body))
    expect(res.status).toBe(200)
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, 'quotations:write')
    expect(forwarded()).toEqual([['/admin/quotations', 'POST']])
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(body))
  })

  it('GET / PATCH / DELETE by id forward to /admin/quotations/{id} with the right scope', async () => {
    await quotationByIdGET(req(ONE), ctx)
    await quotationByIdPATCH(req(ONE, 'PATCH', { status: 'final' }), ctx)
    await quotationByIdDELETE(req(ONE, 'DELETE'), ctx)
    expect(forwarded()).toEqual([
      [`/admin/quotations/${QUOTE_ID}`, 'GET'],
      [`/admin/quotations/${QUOTE_ID}`, 'PATCH'],
      [`/admin/quotations/${QUOTE_ID}`, 'DELETE'],
    ])
    expect(vi.mocked(hasScope).mock.calls.map(c => c[2])).toEqual(['quotations:read', 'quotations:write', 'quotations:write'])
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ status: 'final' }))
  })

  it('passes document-service status and body through', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"Quotation not found"}', { status: 404, headers: { 'content-type': 'application/json' } })
    )
    const res = await quotationByIdGET(req(ONE), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Quotation not found' })
  })

  it.each([
    ['GET list', () => quotationsGET(req(LIST))],
    ['POST create', () => quotationsPOST(req(LIST, 'POST', {}))],
    ['GET by id', () => quotationByIdGET(req(ONE), ctx)],
    ['PATCH by id', () => quotationByIdPATCH(req(ONE, 'PATCH', {}), ctx)],
    ['DELETE by id', () => quotationByIdDELETE(req(ONE, 'DELETE'), ctx)],
  ])('%s returns 401 when unauthenticated and 403 when scope missing', async (_name, call) => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await call()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
