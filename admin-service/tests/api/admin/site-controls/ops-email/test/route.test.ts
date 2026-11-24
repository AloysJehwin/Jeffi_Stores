import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/redis', () => ({ getRedisClient: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenantId: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))
vi.mock('@/lib/shared/daily-briefing', () => ({ briefingFromAsync: vi.fn(async () => 'Briefing <b@x.in>') }))
vi.mock('@/lib/shared/ops-email-config', () => ({ parseOpsEmailInput: vi.fn() }))
vi.mock('@/lib/shared/ops-email', () => ({ buildOpsEmail: vi.fn(), loadOpsEmail: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/site-controls/ops-email/test/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { getRedisClient } from '@/lib/shared/redis'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { parseOpsEmailInput } from '@/lib/shared/ops-email-config'
import { buildOpsEmail, loadOpsEmail } from '@/lib/shared/ops-email'

const call = () => POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ config: {} }) }))
const set = vi.fn()
const planHas = vi.fn()

describe('POST /api/admin/site-controls/ops-email/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(parseOpsEmailInput).mockReturnValue({ ok: true, value: { cfg: 1 } } as never)
    vi.mocked(queryOne).mockResolvedValue({ email: 'me@x.in' })
    vi.mocked(getRedisClient).mockReturnValue({ set } as never)
    set.mockResolvedValue('OK')
    vi.mocked(getCurrentTenantId).mockReturnValue('t1' as never)
    vi.mocked(loadOpsEmail).mockResolvedValue({ planHas } as never)
    planHas.mockReturnValue(true)
    vi.mocked(buildOpsEmail).mockResolvedValue({ subject: 'Daily', html: '<p>x</p>', attachments: [{ filename: 'a.csv' }], note: 'n' } as never)
    vi.mocked(sendAuditedMail).mockResolvedValue(undefined as never)
  })

  it('returns the auth failure (needs settings:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid config or an admin without an email', async () => {
    vi.mocked(parseOpsEmailInput).mockReturnValueOnce({ ok: false, error: 'Bad' } as never)
    expect((await call()).status).toBe(400)
    vi.mocked(queryOne).mockResolvedValue({ email: null })
    expect((await call()).status).toBe(400)
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call()).status).toBe(400)
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('returns 429 when a test was sent in the last minute', async () => {
    set.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(429)
    expect(set).toHaveBeenCalledWith('opsemail:test:t1:a1', '1', 'EX', 60, 'NX')
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('sends the test to the admin only, with the attachments', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ sentTo: 'me@x.in', note: 'n' })
    expect(buildOpsEmail).toHaveBeenCalledWith({ cfg: { cfg: 1 }, planHas }, { ai: true, attachments: true })
    expect(sendAuditedMail).toHaveBeenCalledWith({
      from: 'Briefing <b@x.in>',
      to: 'me@x.in',
      subject: '[Test] Daily',
      html: '<p>x</p>',
      attachments: [{ filename: 'a.csv' }],
      kind: 'daily_briefing',
    })
  })

  it('does not rate limit when redis is unavailable', async () => {
    set.mockRejectedValue(new Error('redis'))
    expect((await call()).status).toBe(200)
  })

  it('returns 502 with the reason when the mail cannot be sent', async () => {
    vi.mocked(sendAuditedMail).mockRejectedValue(new Error('SES rejected'))
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('SES rejected')
  })
})
