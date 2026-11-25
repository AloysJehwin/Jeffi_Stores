import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/mail-template', () => ({ applyMailTheme: vi.fn((html: string, theme: unknown) => `${html}|${JSON.stringify(theme)}`) }))
vi.mock('@/lib/catalog/brand', () => ({ storeMailTheme: vi.fn(async () => ({ accent: 'red' })) }))
vi.mock('@/lib/shared/ops-email-config', () => ({ parseOpsEmailInput: vi.fn() }))
vi.mock('@/lib/shared/ops-email', () => ({ buildOpsEmail: vi.fn(), loadOpsEmail: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-controls/ops-email/preview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parseOpsEmailInput } from '@/lib/shared/ops-email-config'
import { buildOpsEmail, loadOpsEmail } from '@/lib/shared/ops-email'

const call = (body: unknown, qs = '') =>
  POST(new NextRequest(`http://localhost/x${qs}`, { method: 'POST', body: JSON.stringify(body) }))
const planHas = vi.fn()

describe('POST /api/admin/site-controls/ops-email/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(parseOpsEmailInput).mockReturnValue({ ok: true, value: { cfg: 1 } } as never)
    vi.mocked(loadOpsEmail).mockResolvedValue({ planHas } as never)
    vi.mocked(buildOpsEmail).mockResolvedValue({ subject: 'S', html: '<p>x</p>', note: 'n' } as never)
    planHas.mockReturnValue(true)
  })

  it('returns the auth failure (needs settings:read)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call({ config: {} })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
    expect(buildOpsEmail).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid config', async () => {
    vi.mocked(parseOpsEmailInput).mockReturnValue({ ok: false, error: 'Bad hour' } as never)
    const res = await call({ config: {} })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Bad hour')
  })

  it('renders a themed preview with a placeholder headline by default', async () => {
    const body = await (await call({ config: { a: 1 } })).json()
    expect(body).toEqual({ subject: 'S', html: '<p>x</p>|{"accent":"red"}', note: 'n' })
    expect(buildOpsEmail).toHaveBeenCalledWith({ cfg: { cfg: 1 }, planHas }, { ai: 'placeholder', attachments: 'summary' })
  })

  it('uses the real AI headline only with ?ai=1 and the agent plan', async () => {
    await call({ config: {} }, '?ai=1')
    expect(vi.mocked(buildOpsEmail).mock.calls[0][1]).toMatchObject({ ai: true })
    planHas.mockReturnValue(false)
    await call({ config: {} }, '?ai=1')
    expect(vi.mocked(buildOpsEmail).mock.calls[1][1]).toMatchObject({ ai: 'placeholder' })
  })

  it('propagates a build failure', async () => {
    vi.mocked(buildOpsEmail).mockRejectedValue(new Error('build'))
    await expect(call({ config: {} })).rejects.toThrow('build')
  })
})
