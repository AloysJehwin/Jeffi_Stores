import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const layout = vi.hoisted(() => ({ reconcileLayout: vi.fn() }))
vi.mock('@controller/lib/provisioning/layout-switch', () => layout)

import { POST } from '@controller/app/api/(internal)/internal/provisioning/switch-layout/route'

const call = (qs = '?slug=acme', auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest(`http://localhost/api/internal/provisioning/switch-layout${qs}`, { method: 'POST', headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  vi.stubEnv('PROVISIONING_COMPUTE', 'k8s')
  query.mockResolvedValue({ rows: [{ id: 't-1' }] })
  layout.reconcileLayout.mockResolvedValue({ ok: true, status: 'services' })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/provisioning/switch-layout', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call('?slug=acme', null)).status).toBe(401)
    expect((await call('?slug=acme', 'Bearer x')).status).toBe(401)
    expect(layout.reconcileLayout).not.toHaveBeenCalled()
  })

  it('refuses outside k8s mode', async () => {
    vi.stubEnv('PROVISIONING_COMPUTE', 'ec2')
    expect((await call()).status).toBe(400)
  })

  it('needs a slug', async () => {
    const res = await call('')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'slug is required' })
  })

  it('404s for an unknown store', async () => {
    query.mockResolvedValue({ rows: [] })
    expect((await call()).status).toBe(404)
    expect(layout.reconcileLayout).not.toHaveBeenCalled()
  })

  it('advances the move one step, retrying a failed one', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, slug: 'acme', ok: true, status: 'services' })
    expect(layout.reconcileLayout).toHaveBeenCalledWith('t-1', { retry: true })
  })
})
