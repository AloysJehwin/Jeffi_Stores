import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/controls/jobs/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { NextRequest } from 'next/server'

const ADMIN = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['controls:read'] }
const req = () => new NextRequest('http://localhost/api/admin/controls/jobs/job1')
const params = Promise.resolve({ id: 'job1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('GET /api/admin/controls/jobs/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(req(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 without controls:read scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the job does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await GET(req(), { params })
    expect(res.status).toBe(404)
  })

  it('returns the job status', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      id: 'job1',
      status: 'running',
      operation: 'set_images',
      total: 5,
      done: 2,
      skipped: 1,
      log_id: null,
      error: null,
    } as any)
    const res = await GET(req(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.job.id).toBe('job1')
    expect(json.job.done).toBe(2)
    expect(json.job.total).toBe(5)
  })
})
