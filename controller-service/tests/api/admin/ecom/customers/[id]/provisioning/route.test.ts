import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const query = vi.hoisted(() => vi.fn())
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ ...reg, controlPlanePool: () => ({ query }) }))
vi.mock('@controller/lib/provisioning/steps', () => ({ STEPS: ['a', 'b'] }))
const view = vi.hoisted(() => ({ describePipeline: vi.fn() }))
vi.mock('@controller/lib/provisioning/pipeline-view', () => view)

import { GET } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/provisioning/route'

const call = () => GET(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/provisioning'), { params: Promise.resolve({ id: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: ['ecom_customers:read'] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', status: 'active', rds_endpoint: 'db.x', s3_bucket: 'b', region: 'ap-south-1' })
  view.describePipeline.mockReturnValue({ steps: [] })
})

describe('GET /api/admin/ecom/customers/[id]/provisioning', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('returns null job and pipeline when the tenant has never been provisioned', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const body = await (await call()).json()
    expect(body).toMatchObject({ job: null, pipeline: null, events: [], steps: ['a', 'b'] })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns the latest job with its step events', async () => {
    const row = { id: 'j-1', step: 'create_db', status: 'running', attempts: 1, pipeline: ['x'] }
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ step: 'create_db', status: 'started' }] })
    const body = await (await call()).json()
    expect(body.job).toEqual({ id: 'j-1', step: 'create_db', status: 'running', attempts: 1 })
    expect(body.events).toEqual([{ step: 'create_db', status: 'started' }])
    expect(body.tenant).toMatchObject({ slug: 'acme', s3_bucket: 'b' })
    expect(view.describePipeline).toHaveBeenCalledWith(row, body.events)
    expect(query.mock.calls[1][1]).toEqual(['j-1'])
  })

  it('still answers when the events query fails', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'j-1', pipeline: [] }] }).mockRejectedValueOnce(new Error('no table'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).events).toEqual([])
  })
})
