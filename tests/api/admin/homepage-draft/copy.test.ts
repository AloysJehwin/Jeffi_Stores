import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeHomepageDraftDb, sectionRow, slideRow } from '../../../helpers/homepage-draft-db'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const fake = makeHomepageDraftDb()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => fake.db.query(...(a as [string, any[]])),
  queryOne: (...a: any[]) => fake.db.queryOne(...(a as [string])),
  queryMany: (...a: any[]) => fake.db.queryMany(...(a as [string])),
  withTransaction: (fn: any) => fake.db.withTransaction(fn),
}))

// Draft-lock bookkeeping is out of scope here: with no actor the writes run unlocked.
vi.mock('@/lib/admin/draft-locks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/admin/draft-locks')>()),
  actorOf: () => null,
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { POST } from '@/app/api/(admin)/admin/homepage-draft/copy/route'

const admin = { adminId: '33333333-3333-4333-8333-333333333333', role: 'super_admin', scopes: [] }
const A = 'eeeeeeee-0000-4000-8000-000000000001'
const B = 'eeeeeeee-0000-4000-8000-000000000002'
const S = 'ffffffff-0000-4000-8000-000000000001'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/homepage-draft/copy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
  fake.reset({ sections: [sectionRow(A, 0), sectionRow(B, 1, { type: 'trust_strip' })], heroSlides: [slideRow(S, 0)] })
})

describe('POST /api/admin/homepage-draft/copy', () => {
  it('401 / 403 / 400 guards', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null as any)
    expect((await POST(req({ to: 'app' }))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await POST(req({ to: 'app' }))).status).toBe(403)
    expect((await POST(req({ to: 'print' }))).status).toBe(400)
    expect((await POST(req({ from: 'app', to: 'app' }))).status).toBe(400)
    expect(fake.state.draft).toBeNull()
  })

  it('copies the website rows onto the app surface in the draft with new ids, leaving live alone', async () => {
    const res = await POST(req({ to: 'app' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ copied: { sections: 2, slides: 1, replaced: 0 } })
    const draft = fake.state.draft!
    const app = draft.sections.filter((s: any) => s.surface === 'app')
    expect(app.map((s: any) => s.type)).toEqual(['promo_banner', 'trust_strip'])
    expect(app.every((s: any) => ![A, B].includes(s.id))).toBe(true)
    expect(draft.sections.filter((s: any) => s.surface !== 'app').map((s: any) => s.id)).toEqual([A, B])
    expect(draft.hero_slides.filter((s: any) => s.surface === 'app')).toHaveLength(1)
    expect(fake.state.live.sections).toHaveLength(2)
  })

  it('409s once the app has rows, unless replace is set', async () => {
    expect((await POST(req({ to: 'app' }))).status).toBe(200)
    const again = await POST(req({ to: 'app' }))
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('not_empty')
    const replaced = await POST(req({ to: 'app', replace: true }))
    expect(replaced.status).toBe(200)
    expect((await replaced.json()).copied.replaced).toBe(3)
    expect(fake.state.draft!.sections.filter((s: any) => s.surface === 'app')).toHaveLength(2)
  })
})
