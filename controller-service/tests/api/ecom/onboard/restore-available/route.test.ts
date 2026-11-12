import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
const session = vi.hoisted(() => ({ OWNER_COOKIE: 'owner', resolveOwnerSession: vi.fn() }))
vi.mock('@/lib/auth/owner-session', () => session)
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
const backup = vi.hoisted(() => ({ findLatestBackup: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-backup-store', () => backup)
const reg = vi.hoisted(() => ({ findOwnerArchive: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)

import { GET } from '@controller/app/api/(ecom)/ecom/onboard/restore-available/route'

// A slug in the query must never widen the lookup beyond the signed-in owner.
const get = () => GET(new NextRequest('http://localhost/api/ecom/onboard/restore-available?slug=someone-elses-store'))

describe('GET /api/ecom/onboard/restore-available', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.resolveOwnerSession.mockResolvedValue({ id: 'o-1' })
    reg.findOwnerArchive.mockResolvedValue(null)
    backup.findLatestBackup.mockResolvedValue(null)
  })

  it('needs a signed-in owner', async () => {
    session.resolveOwnerSession.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })

  it('lists what the deprovision kept for this owner', async () => {
    reg.findOwnerArchive.mockResolvedValue({
      id: 'arch-1',
      slug: 'acme',
      display_name: 'Acme',
      created_at: '2026-11-01T00:00:00Z',
      expires_at: '2026-12-01T00:00:00Z',
      keep_database: true,
      keep_media: false,
      keep_config: true,
      media_objects: 0,
      media_bytes: '0',
    })
    const body = await (await get()).json()
    expect(reg.findOwnerArchive).toHaveBeenCalledWith('o-1')
    expect(body).toMatchObject({
      available: true,
      archive: { id: 'arch-1', slug: 'acme', database: true, media: false, config: true, expiresAt: '2026-12-01T00:00:00Z' },
    })
  })

  it('offers an older backup as database only, looked up by owner and never by store name', async () => {
    backup.findLatestBackup.mockResolvedValue({ key: 'tenant-backups/by-owner/o-1/x.sql.gz', capturedAt: '2026-10-01T00:00:00.000Z' })
    const body = await (await get()).json()
    expect(backup.findLatestBackup).toHaveBeenCalledWith({ ownerId: 'o-1' })
    expect(body).toMatchObject({ available: true, capturedAt: '2026-10-01T00:00:00.000Z' })
    expect(body.archive).toBeUndefined()
  })

  it('says so when nothing was kept', async () => {
    expect(await (await get()).json()).toEqual({ available: false })
  })
})
