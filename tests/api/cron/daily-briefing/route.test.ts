import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))
vi.mock('@/lib/shared/daily-briefing', () => ({
  briefingFromAsync: vi.fn(async () => 'briefing@example.com'),
  istToday: vi.fn(() => '2026-10-30'),
  istHour: vi.fn(() => 8),
}))
vi.mock('@/lib/shared/ops-email', () => ({ loadOpsEmail: vi.fn(), buildOpsEmail: vi.fn(), opsEmailRecipients: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/daily-briefing/route'
import { query, queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { istHour } from '@/lib/shared/daily-briefing'
import { buildOpsEmail, loadOpsEmail, opsEmailRecipients } from '@/lib/shared/ops-email'
import { defaultOpsEmail } from '@/lib/shared/ops-email-config'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockSendMail = vi.mocked(sendAuditedMail)
const mockHour = vi.mocked(istHour)
const mockLoad = vi.mocked(loadOpsEmail)
const mockBuild = vi.mocked(buildOpsEmail)
const mockRecipients = vi.mocked(opsEmailRecipients)

const mail = (over = {}) =>
  ({
    subject: 'Brief',
    html: '<p>hi</p>',
    narration: '',
    attachments: [],
    note: '',
    data: { yesterday: { revenue: 100, count: 5 }, stuck_shipments: [], low_stock: [] },
    ...over,
  }) as any

function makeRequest(auth?: string, force = false) {
  const url = `http://localhost/api/cron/daily-briefing${force ? '?force=1' : ''}`
  return new NextRequest(url, { headers: auth ? { authorization: auth } : {} })
}
const AUTH = 'Bearer test-cron-secret'

describe('GET /api/cron/daily-briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    mockHour.mockReturnValue(8)
    mockLoad.mockResolvedValue({ cfg: defaultOpsEmail(true), planHas: () => true })
    mockQuery.mockResolvedValue(undefined as any)
  })

  it('returns 401 without auth', async () => {
    expect((await GET(makeRequest() as any)).status).toBe(401)
  })

  it('returns 401 with wrong auth', async () => {
    expect((await GET(makeRequest('Bearer wrong') as any)).status).toBe(401)
  })

  it('skips when the store has it off', async () => {
    mockLoad.mockResolvedValueOnce({ cfg: defaultOpsEmail(false), planHas: () => true })
    const json = await (await GET(makeRequest(AUTH) as any)).json()
    expect(json).toMatchObject({ skipped: true, reason: 'disabled' })
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('skips outside the chosen hour and its catch-up window', async () => {
    mockHour.mockReturnValueOnce(7)
    expect(await (await GET(makeRequest(AUTH) as any)).json()).toMatchObject({ reason: 'not_the_hour' })
    mockHour.mockReturnValueOnce(11)
    expect(await (await GET(makeRequest(AUTH) as any)).json()).toMatchObject({ reason: 'not_the_hour' })
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('skips when the day is already claimed', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const json = await (await GET(makeRequest(AUTH) as any)).json()
    expect(json).toMatchObject({ skipped: true, reason: 'already_sent' })
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('force=1 skips the hour and the claim', async () => {
    mockHour.mockReturnValue(3)
    mockBuild.mockResolvedValueOnce(mail())
    mockRecipients.mockResolvedValueOnce(['admin@example.com'])
    mockSendMail.mockResolvedValueOnce(undefined as any)
    const res = await GET(makeRequest(AUTH, true) as any)
    expect(res.status).toBe(200)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('returns 500 when building the email throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'log1' })
    mockBuild.mockRejectedValueOnce(new Error('collect failed'))
    const res = await GET(makeRequest(AUTH) as any)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Data collection failed')
  })

  it('returns 500 when nobody is chosen', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'log1' })
    mockBuild.mockResolvedValueOnce(mail())
    mockRecipients.mockResolvedValueOnce([])
    const res = await GET(makeRequest(AUTH) as any)
    expect(res.status).toBe(500)
  })

  it('sends to every recipient with the attachments and records the count', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'log1' })
    const pdf = { filename: 'x.pdf', content: Buffer.from('x'), contentType: 'application/pdf' }
    mockBuild.mockResolvedValueOnce(mail({ attachments: [pdf] }))
    mockRecipients.mockResolvedValueOnce(['a1@example.com', 'a2@example.com'])
    mockSendMail.mockResolvedValue(undefined as any)
    const json = await (await GET(makeRequest(AUTH) as any)).json()
    expect(json).toMatchObject({ success: true, sent: 2, failed: 0 })
    expect(mockSendMail.mock.calls[0][0]).toMatchObject({ attachments: [pdf], kind: 'daily_briefing' })
    expect(mockQuery.mock.calls.at(-1)?.[1]?.slice(0, 2)).toEqual(['2026-10-30', 2])
  })

  it('counts failed sends', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'log1' })
    mockBuild.mockResolvedValueOnce(mail())
    mockRecipients.mockResolvedValueOnce(['a@example.com'])
    mockSendMail.mockRejectedValueOnce(new Error('smtp fail'))
    const json = await (await GET(makeRequest(AUTH) as any)).json()
    expect(json).toMatchObject({ failed: 1, sent: 0 })
  })
})
