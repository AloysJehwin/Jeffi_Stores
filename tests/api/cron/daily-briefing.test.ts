import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

vi.mock('@/lib/email', () => ({
  transporter: { sendMail: vi.fn() },
}))
vi.mock('@/lib/daily-briefing', () => ({
  collectBriefingData: vi.fn(),
  narrate: vi.fn(),
  renderBriefingEmail: vi.fn(),
  BRIEFING_FROM: 'briefing@example.com',
}))

import { GET } from '@/app/api/cron/daily-briefing/route'
import { query, queryOne, queryMany } from '@/lib/db'
import { transporter } from '@/lib/email'
import { sendAuditedMail } from '@/lib/mail-audit'
import { collectBriefingData, narrate, renderBriefingEmail } from '@/lib/daily-briefing'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
// Mail now goes through the audited chokepoint, not the raw transport.
const mockSendMail = vi.mocked(sendAuditedMail)
const mockCollect = vi.mocked(collectBriefingData)
const mockNarrate = vi.mocked(narrate)
const mockRender = vi.mocked(renderBriefingEmail)

function makeRequest(auth?: string, force = false) {
  const url = `http://localhost/api/cron/daily-briefing${force ? '?force=1' : ''}`
  return new NextRequest(url, {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/daily-briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns 401 without auth', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong auth', async () => {
    const res = await GET(makeRequest('Bearer wrong') as any)
    expect(res.status).toBe(401)
  })

  it('skips if already sent today', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'log1' })
    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.skipped).toBe(true)
    expect(json.reason).toBe('already_sent')
  })

  it('skips check when force=1', async () => {
    mockCollect.mockResolvedValueOnce({ yesterday: { revenue: 100, count: 5 }, stuck_shipments: [], low_stock: [] } as any)
    mockNarrate.mockResolvedValueOnce('narration')
    mockRender.mockReturnValueOnce({ subject: 'Brief', html: '<p>hi</p>' })
    mockQueryMany.mockResolvedValueOnce([{ username: 'admin', email: 'admin@example.com' }])
    mockSendMail.mockResolvedValueOnce(undefined as any)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret', true) as any)
    expect(res.status).toBe(200)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('returns 500 when collectBriefingData throws', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockCollect.mockRejectedValueOnce(new Error('collect failed'))
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Data collection failed')
  })

  it('returns 500 when no active admins with email', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockCollect.mockResolvedValueOnce({ yesterday: { revenue: 0, count: 0 }, stuck_shipments: [], low_stock: [] } as any)
    mockNarrate.mockResolvedValueOnce('')
    mockRender.mockReturnValueOnce({ subject: 'Brief', html: '<p>hi</p>' })
    mockQueryMany.mockResolvedValueOnce([])
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('No active admins with email')
  })

  it('sends emails to all admins and returns success', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockCollect.mockResolvedValueOnce({ yesterday: { revenue: 500, count: 3 }, stuck_shipments: [], low_stock: [] } as any)
    mockNarrate.mockResolvedValueOnce('some narration')
    mockRender.mockReturnValueOnce({ subject: 'Daily Brief', html: '<p>brief</p>' })
    mockQueryMany.mockResolvedValueOnce([
      { username: 'admin1', email: 'a1@example.com' },
      { username: 'admin2', email: 'a2@example.com' },
    ])
    mockSendMail.mockResolvedValue(undefined as any)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.sent).toBe(2)
    expect(json.failed).toBe(0)
  })

  it('counts failed email sends', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockCollect.mockResolvedValueOnce({ yesterday: { revenue: 0, count: 0 }, stuck_shipments: [], low_stock: [] } as any)
    mockNarrate.mockResolvedValueOnce('')
    mockRender.mockReturnValueOnce({ subject: 'Brief', html: '<p>hi</p>' })
    mockQueryMany.mockResolvedValueOnce([{ username: 'admin', email: 'a@example.com' }])
    mockSendMail.mockRejectedValueOnce(new Error('smtp fail'))
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    const json = await res.json()
    expect(json.failed).toBe(1)
    expect(json.sent).toBe(0)
  })

  it('filters out admins with no valid email', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockCollect.mockResolvedValueOnce({ yesterday: { revenue: 0, count: 0 }, stuck_shipments: [], low_stock: [] } as any)
    mockNarrate.mockResolvedValueOnce('')
    mockRender.mockReturnValueOnce({ subject: 'Brief', html: '' })
    mockQueryMany.mockResolvedValueOnce([
      { username: 'admin1', email: null },
      { username: 'admin2', email: 'notanemail' },
    ])
    mockQuery.mockResolvedValue(undefined as any)

    const res = await GET(makeRequest('Bearer test-cron-secret') as any)
    expect(res.status).toBe(500)
  })
})
