import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import * as route from '@admin/app/api/(admin)/admin/settings/providers/credentials/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'

const { GET } = route
const url = 'http://localhost/api/admin/settings/providers/credentials'
const KEY = 'exotel-key-AAAA1111'
const CLAUDE = 'sk-ant-env-secret-7777'

describe('/api/admin/settings/providers/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('ANTHROPIC_API_KEY', CLAUDE)
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', email: 'ops@x', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('has no way to write a credential', () => {
    expect(Object.keys(route).filter(k => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(k))).toEqual([])
  })

  it('is 401 without a session', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
  })

  it('is 403 for a non-owner and for a store admin', async () => {
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue('33333333-3333-3333-3333-333333333333')
    expect((await GET(new NextRequest(url))).status).toBe(403)
  })

  it('returns the config and secret names with presence, never a value', async () => {
    const g = await GET(new NextRequest(url))
    expect(g.status).toBe(200)
    expect(g.headers.get('cache-control')).toBe('no-store')
    const text = await g.text()
    for (const s of [KEY, CLAUDE]) expect(text).not.toContain(s)
    const j = JSON.parse(text)
    expect(j.secrets).toContainEqual({ name: 'EXOTEL_API_KEY', group: 'calling', present: true })
    expect(j.secrets).toContainEqual({ name: 'ANTHROPIC_API_KEY', group: 'voice', present: true })
    expect(j.secrets).toContainEqual({ name: 'SARVAM_API_KEY', group: 'voice', present: false })
    expect(j.voice).toMatchObject({ provider: 'exotel', ready: false, parts: { claude: true, exotel: false } })
    expect(j.dlt).toMatchObject({ entityId: null, senderIds: [] })
  })

  it('is 500 when the config cannot be read', async () => {
    query.mockRejectedValue(new Error('db down'))
    const r = await GET(new NextRequest(url))
    expect(r.status).toBe(500)
    expect(await r.text()).not.toContain('db down')
  })
})
