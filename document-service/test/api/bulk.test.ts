import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auth, boot, bulk, dbQuery, docRow, resetFakes, storage } from './harness'
import { sampleRequest } from '../../src/designs/sample'

vi.mock('fastify', async orig => (await import('./harness')).fastifyCapture(orig as any))
vi.mock('@jeffi/tenancy', async orig => (await import('./harness')).tenancyMock(orig as any))
vi.mock('@jeffi/bulk', async () => (await import('./harness')).bulk)
vi.mock('@jeffi/wallet', async () => (await import('./harness')).wallet)
vi.mock('../../src/storage.js', async () => (await import('./harness')).storage)
vi.mock('../../src/designs/settings.js', async () => (await import('./harness')).settings)
vi.mock('../../src/tenant/public.js', () => ({ publicRoutes: async () => {} }))
vi.mock('../../src/admin/index.js', () => ({ adminRoutes: async () => {} }))

const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', status: 'completed', succeeded: 3, ...over })

beforeEach(() => {
  resetFakes()
  bulk.getJob.mockResolvedValue(job())
})

describe('POST /documents/bulk', () => {
  const post = async (payload: unknown, headers: Record<string, string> = auth()) =>
    (await boot()).inject({ method: 'POST', url: '/documents/bulk', headers, payload: payload as any })

  it('validates every item up front and queues a job (202) with its zip link', async () => {
    bulk.createJob.mockResolvedValueOnce(job({ status: 'queued', succeeded: 0 }))
    const res = await post({ type: 'invoice', reference: 'batch-1', items: [sampleRequest('invoice'), sampleRequest('invoice')] })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ id: 'j1', status: 'queued' })
    expect(res.json().zip_url).toBeUndefined()
    expect(bulk.createJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'documents', tenantId: 't1', reference: 'batch-1', inputs: expect.any(Array) }))
    expect(bulk.createJob.mock.calls[0][1].inputs).toHaveLength(2)
  })

  it('400s with per-item details when an item has no type or an unknown template', async () => {
    const res = await post({ items: [sampleRequest('invoice'), { ...sampleRequest('invoice'), type: 'invoice', template: 'nope' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_error')
    expect(res.json().details.map((d: any) => d.index)).toEqual([0, 1])
    expect(bulk.createJob).not.toHaveBeenCalled()
  })

  it('400s when the request has no items', async () => {
    const res = await post({ type: 'invoice', items: [] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_error')
  })

  it('401s without a token', async () => {
    expect((await post({ type: 'invoice', items: [sampleRequest('invoice')] }, {})).statusCode).toBe(401)
  })
})

describe('GET /documents/bulk', () => {
  it('lists the tenant jobs, adding zip_url where documents exist', async () => {
    bulk.listJobs.mockResolvedValueOnce({ items: [job({ id: 'a' }), job({ id: 'b', succeeded: 0 })], next_cursor: null })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/bulk?limit=5', headers: auth() })
    expect(res.statusCode).toBe(200)
    const [a, b] = res.json().items
    expect(a.zip_url).toBe('/documents/bulk/a/zip')
    expect(b.zip_url).toBeUndefined()
    expect(bulk.listJobs).toHaveBeenCalledWith(expect.anything(), 't1', 'documents', expect.objectContaining({ limit: 5 }))
  })

  it('401s without a token', async () => {
    expect((await (await boot()).inject({ method: 'GET', url: '/documents/bulk' })).statusCode).toBe(401)
  })
})

describe('GET /documents/bulk/:id', () => {
  it('returns the job with its zip url', async () => {
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/bulk/j1', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'j1', status: 'completed', zip_url: '/documents/bulk/j1/zip' })
    expect(bulk.getJob).toHaveBeenCalledWith(expect.anything(), 't1', 'documents', 'j1')
  })

  it('404s for an unknown job and 401s without a token', async () => {
    const app = await boot()
    bulk.getJob.mockResolvedValueOnce(null)
    const missing = await app.inject({ method: 'GET', url: '/documents/bulk/nope', headers: auth() })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('not_found')
    expect((await app.inject({ method: 'GET', url: '/documents/bulk/j1' })).statusCode).toBe(401)
  })
})

describe('GET /documents/bulk/:id/items', () => {
  it('pages the job items with their rendered documents', async () => {
    bulk.listItems.mockResolvedValueOnce({
      rows: [{ seq: 1, status: 'done', error: null, input: { body: { reference: 'R1' } }, result_id: 'd1' }, { seq: 2, status: 'failed', error: 'bad', input: {}, result_id: null }],
      next_cursor: 'c2',
    })
    dbQuery.mockResolvedValueOnce({ rows: [docRow()] })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/bulk/j1/items?status=done&limit=2', headers: auth() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.next_cursor).toBe('c2')
    expect(body.items[0]).toMatchObject({ seq: 1, status: 'done', reference: 'R1', result: { id: 'd1' } })
    expect(body.items[1]).toMatchObject({ seq: 2, error: 'bad', result: null })
    expect(bulk.listItems).toHaveBeenCalledWith(expect.anything(), 'j1', expect.objectContaining({ status: 'done', limit: 2 }))
  })

  it('404s for an unknown job and 401s without a token', async () => {
    const app = await boot()
    bulk.getJob.mockResolvedValueOnce(null)
    expect((await app.inject({ method: 'GET', url: '/documents/bulk/nope/items', headers: auth() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/documents/bulk/j1/items' })).statusCode).toBe(401)
  })
})

describe('POST /documents/bulk/:id/cancel and /retry', () => {
  it('cancel and retry return the updated job', async () => {
    const app = await boot()
    bulk.cancelJob.mockResolvedValueOnce(job({ status: 'cancelled' }))
    bulk.retryJob.mockResolvedValueOnce(job({ status: 'queued', succeeded: 0 }))
    const cancel = await app.inject({ method: 'POST', url: '/documents/bulk/j1/cancel', headers: auth() })
    expect(cancel.statusCode).toBe(200)
    expect(cancel.json()).toMatchObject({ id: 'j1', status: 'cancelled' })
    const retry = await app.inject({ method: 'POST', url: '/documents/bulk/j1/retry', headers: auth() })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ status: 'queued' })
  })

  it('404 for an unknown job; 401 without a token', async () => {
    const app = await boot()
    bulk.getJob.mockResolvedValue(null)
    expect((await app.inject({ method: 'POST', url: '/documents/bulk/nope/cancel', headers: auth() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/documents/bulk/nope/retry', headers: auth() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/documents/bulk/j1/cancel' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/documents/bulk/j1/retry' })).statusCode).toBe(401)
  })
})

describe('GET /documents/bulk/:id/zip', () => {
  it('streams a ZIP of the finished PDFs, de-duplicating clashing numbers', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [docRow({ id: 'aaaaaaaa1' }), docRow({ id: 'bbbbbbbb2' })] })
    const res = await (await boot()).inject({ method: 'GET', url: '/documents/bulk/j1/zip', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toContain('documents-j1.zip')
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK')
    const names = res.rawPayload.toString('latin1')
    expect(names).toContain('INV-26-27-0001.pdf')
    expect(names).toContain('INV-26-27-0001-bbbbbb.pdf')
    expect(storage.getPdf).toHaveBeenCalledTimes(2)
  })

  it('404s while the job has no finished documents, and 401s without a token', async () => {
    const app = await boot()
    const none = await app.inject({ method: 'GET', url: '/documents/bulk/j1/zip', headers: auth() })
    expect(none.statusCode).toBe(404)
    expect(none.json().message).toContain('No documents')
    expect((await app.inject({ method: 'GET', url: '/documents/bulk/j1/zip' })).statusCode).toBe(401)
  })
})
