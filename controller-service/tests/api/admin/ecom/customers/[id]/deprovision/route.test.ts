import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(() => true) }))
const query = vi.hoisted(() => vi.fn())
const reg = vi.hoisted(() => ({
  getTenant: vi.fn(),
  controlPlanePool: () => ({ query }),
  KEEP_ALL: { database: true, media: true, config: true },
  archiveRetentionDays: () => 30,
  parseArchiveKeep: (raw: any) =>
    raw && typeof raw.database === 'boolean' && typeof raw.media === 'boolean' && typeof raw.config === 'boolean'
      ? { database: raw.database, media: raw.media, config: raw.config }
      : null,
}))
vi.mock('@/lib/tenant-registry', () => reg)
const trigger = vi.hoisted(() => ({ triggerProvisioning: vi.fn() }))
vi.mock('@controller/lib/provisioning/trigger', () => trigger)

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/deprovision/route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/deprovision', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't-1' }),
  })

describe('POST /api/admin/ecom/customers/[id]/deprovision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.authenticateAdmin.mockResolvedValue({ id: 'a-1', email: 'admin@example.com', role: 'admin', scopes: [] })
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'basic' })
    query.mockResolvedValue({ rows: [{ owner_id: 'o-1' }] })
    trigger.triggerProvisioning.mockResolvedValue({ ok: true, archiveId: 'arch-1' })
  })

  it('needs an explicit confirm', async () => {
    const res = await post({ keep: { database: true, media: true, config: true } })
    expect(res.status).toBe(400)
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('passes on exactly what the administrator chose to keep', async () => {
    const keep = { database: true, media: false, config: true }
    const res = await post({ confirm: true, keep })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, kept: keep, archiveId: 'arch-1', retentionDays: 30 })
    expect(trigger.triggerProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deprovision', tenantId: 't-1', ownerId: 'o-1', keep, requestedBy: 'admin@example.com' })
    )
  })

  it('refuses a choice that leaves an item undecided, and deletes nothing', async () => {
    const res = await post({ confirm: true, keep: { database: true, media: false } })
    expect(res.status).toBe(400)
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('keeps everything when no choice is sent (the CLI before this option)', async () => {
    await post({ confirm: true })
    expect(trigger.triggerProvisioning).toHaveBeenCalledWith(expect.objectContaining({ keep: { database: true, media: true, config: true } }))
  })
})
