import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/email-campaigns', () => ({
  sendCampaign: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/mailer/[id]/send/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { sendCampaign } from '@/lib/email-campaigns'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockSendCampaign = vi.mocked(sendCampaign)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['mailer'],
}

function makeRequest(id = 'campaign-1', body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/admin/mailer/${id}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const draftCampaign = { status: 'draft', scheduled_at: null }
const futureCampaign = {
  status: 'draft',
  scheduled_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/mailer/[id]/send', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when campaign not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest('bad-id'), { params: Promise.resolve({ id: 'bad-id' }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when campaign already sent', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sent', scheduled_at: null })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already sent/i)
  })

  it('returns 400 when campaign is currently sending', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ status: 'sending', scheduled_at: null })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(400)
  })

  it('schedules the campaign when scheduled_at is in the future and dispatchNow is false', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(futureCampaign)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest('campaign-1', { dispatchNow: false }), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scheduled).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'scheduled'"),
      ['campaign-1'],
    )
  })

  it('dispatches immediately when dispatchNow is true even with future scheduled_at', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(futureCampaign)
    mockSendCampaign.mockResolvedValue({ sent: 50, failed: 2 })

    const res = await POST(makeRequest('campaign-1', { dispatchNow: true }), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(50)
    expect(body.failed).toBe(2)
  })

  it('dispatches draft campaign without scheduled_at', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(draftCampaign)
    mockSendCampaign.mockResolvedValue({ sent: 100, failed: 0 })

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'campaign-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(100)
    expect(mockSendCampaign).toHaveBeenCalledWith('campaign-1')
  })
})
