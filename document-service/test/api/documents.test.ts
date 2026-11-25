import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth, boot, dbQuery, dbClient, docRow, PDF, resetFakes, storage, wallet } from './harness'
import { sampleRequest } from '../../src/designs/sample'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('@jeffi/tenancy', async orig => (await import('./harness')).tenancyMock(orig as any))
vi.mock('@jeffi/bulk', async () => (await import('./harness')).bulk)
vi.mock('@jeffi/wallet', async () => (await import('./harness')).wallet)
vi.mock('../../src/storage.js', async () => (await import('./harness')).storage)
vi.mock('../../src/designs/settings.js', async () => (await import('./harness')).settings)
vi.mock('../../src/tenant/public.js', () => ({ publicRoutes: async () => {} }))
vi.mock('../../src/admin/index.js', () => ({ adminRoutes: async () => {} }))

beforeEach(() => resetFakes())

describe('GET /healthz', () => {
  it('is open and names the service', async () => {
    const app = await boot()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, service: 'documents' })
  })
})

describe('POST /documents/:type', () => {
  const post = async (type: string, payload: unknown, headers: Record<string, string> = auth()) =>
    (await boot()).inject({ method: 'POST', url: `/documents/${type}`, headers, payload: payload as any })

  it('renders, stores a PDF, debits the wallet and returns the document', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    const res = await post('invoice', sampleRequest('invoice'))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'd1', type: 'invoice', price_inr: 1.5, view_url: 'https://api.test/d/tok1', pdf_url: 'https://api.test/d/tok1/pdf' })
    expect(res.json().totals.total).toBe(118)
    expect(wallet.debit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', category: 'document' }))
    const [key, pdf] = storage.putPdf.mock.calls[0]
    expect(key).toMatch(/^t1\/invoice\/.+\.pdf$/)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(dbClient.query.mock.calls.map(c => String(c[0]).split(/\s/)[0])).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
  })

  it('rejects a missing or bad service token with 401', async () => {
    expect((await post('invoice', sampleRequest('invoice'), {})).statusCode).toBe(401)
    expect((await post('invoice', sampleRequest('invoice'), { authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect(wallet.debit).not.toHaveBeenCalled()
  })

  it('400s on an unknown document type and on a body that is not a render request', async () => {
    const badType = await post('invoicee', sampleRequest('invoice'))
    expect(badType.statusCode).toBe(400)
    expect(badType.json().error).toBe('validation_error')
    const badBody = await post('invoice', { items: 'nope' })
    expect(badBody.statusCode).toBe(400)
    expect(badBody.json().error).toBe('validation_error')
  })

  it('400s on an unknown template before debiting', async () => {
    const res = await post('invoice', { ...sampleRequest('invoice'), template: 'no-such-design' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('unknown_template')
    expect(wallet.debit).not.toHaveBeenCalled()
  })

  it('402s when the wallet is short', async () => {
    wallet.debit.mockResolvedValueOnce({ ok: false, balance: 0.5, needed: 1 })
    const res = await post('invoice', sampleRequest('invoice'))
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toBe('insufficient_balance')
    expect(storage.putPdf).not.toHaveBeenCalled()
  })

  it('rolls back and refunds the debit when storing the PDF fails', async () => {
    storage.putPdf.mockRejectedValueOnce(new Error('s3 down'))
    const res = await post('invoice', sampleRequest('invoice'))
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('internal_error')
    expect(dbClient.query.mock.calls.map(c => String(c[0]))).toContain('ROLLBACK')
    expect(wallet.trueUp).toHaveBeenCalledWith(expect.objectContaining({ amountInr: 0 }))
    expect(dbClient.release).toHaveBeenCalled()
  })
})

describe('GET /documents/:id', () => {
  it('returns the document scoped to the caller tenant', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/d1', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'd1', number: 'INV/26-27/0001', reference: 'R1' })
    expect(dbQuery.mock.calls[0][1]).toEqual(['d1', 't1'])
  })

  it('404s for an unknown document and 401s without a token', async () => {
    const app = await boot()
    const missing = await app.inject({ method: 'GET', url: '/documents/nope', headers: auth() })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('not_found')
    expect((await app.inject({ method: 'GET', url: '/documents/d1' })).statusCode).toBe(401)
  })
})

describe('GET /documents/:id/pdf', () => {
  it('streams the stored PDF with the PDF content type and header', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/d1/pdf', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('INV-26-27-0001.pdf')
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
    expect(storage.getPdf).toHaveBeenCalledWith('t1/invoice/d1.pdf')
  })

  it('404s when absent and 401s without a token', async () => {
    const app = await boot()
    expect((await app.inject({ method: 'GET', url: '/documents/nope/pdf', headers: auth() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/documents/d1/pdf' })).statusCode).toBe(401)
  })
})

describe('GET /documents', () => {
  it('lists the tenant documents with a cursor when the page is full', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow({ id: 'a' }), docRow({ id: 'b', created_at: '2026-10-01T00:00:00.000Z' })] })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents?limit=2&type=invoice', headers: auth() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items.map((d: any) => d.id)).toEqual(['a', 'b'])
    expect(body.next_cursor).toBe('2026-10-01T00:00:00.000Z')
    expect(dbQuery.mock.calls[0][1]).toEqual(['t1', 'invoice', null, 2])
  })

  it('has no cursor on a short page, and 401s without a token', async () => {
    const app = await boot()
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    expect((await app.inject({ method: 'GET', url: '/documents', headers: auth() })).json().next_cursor).toBeNull()
    expect((await app.inject({ method: 'GET', url: '/documents' })).statusCode).toBe(401)
  })
})

describe('GET /view/:token and /view/:token/pdf (token only, no service token)', () => {
  it('serves the HTML viewer for a known token, escaping the number', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow({ number: 'INV<1>' })] })
    const res = await (await boot()).inject({ method: 'GET', url: '/view/tok1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Invoice · INV&#60;1&#62;')
    expect(res.body).toContain('/d/tok1/pdf')
  })

  it('serves the PDF for a known token', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    const res = await (await boot()).inject({ method: 'GET', url: '/view/tok1/pdf' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
    expect(PDF.length).toBeGreaterThan(0)
  })

  it('404s an unknown token on both', async () => {
    const app = await boot()
    const html = await app.inject({ method: 'GET', url: '/view/nope' })
    expect(html.statusCode).toBe(404)
    expect(html.body).toContain('Document not found')
    expect((await app.inject({ method: 'GET', url: '/view/nope/pdf' })).statusCode).toBe(404)
  })
})
