import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ storeBaseUrlAsync: vi.fn(), campaignMailFromAsync: vi.fn() }))
vi.mock('@/lib/templates/variables', () => ({ resolveTemplateVariables: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))
vi.mock('@/lib/messaging/broadcast-shared', () => ({ broadcastScenario: vi.fn(() => ({})), hasEmailContent: vi.fn() }))
vi.mock('@/lib/messaging/broadcast-email', () => ({
  loadAttachments: vi.fn(),
  loadBroadcastCoupon: vi.fn(),
  loadBroadcastTemplate: vi.fn(),
  renderBroadcastEmail: vi.fn(),
}))

import { POST } from '@admin/app/api/(admin)/admin/mailer/test/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { storeBaseUrlAsync, campaignMailFromAsync } from '@/lib/catalog/brand'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { hasEmailContent } from '@/lib/messaging/broadcast-shared'
import { loadAttachments, loadBroadcastCoupon, loadBroadcastTemplate, renderBroadcastEmail } from '@/lib/messaging/broadcast-email'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/mailer/test', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { subject: 'Hello', channels: { email: { reply_to: 'r@x.in', attachments: [] } } }

describe('POST mailer/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [], email: 'me@x.in', first_name: 'Me' } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(hasEmailContent).mockReturnValue(true as any)
    vi.mocked(loadBroadcastTemplate).mockResolvedValue({ template: { slug: 'promo' }, missing: false } as any)
    vi.mocked(loadBroadcastCoupon).mockResolvedValue(null as any)
    vi.mocked(loadAttachments).mockResolvedValue([])
    vi.mocked(resolveTemplateVariables).mockResolvedValue({} as any)
    vi.mocked(storeBaseUrlAsync).mockResolvedValue('https://shop.in')
    vi.mocked(campaignMailFromAsync).mockResolvedValue('Shop <hi@shop.in>')
    vi.mocked(renderBroadcastEmail).mockReturnValue({ subject: 'Rendered', html: '<p>hi</p>' } as any)
  })

  it('401s, 403s (mailer:write) and 400s without an admin email', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [], email: 'me@x.in' } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'mailer:write')
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    expect((await POST(req(good))).status).toBe(400)
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('400s when there is no email content', async () => {
    vi.mocked(hasEmailContent).mockReturnValue(false as any)
    expect((await POST(req(good))).status).toBe(400)
    expect((await POST(req('bad json'))).status).toBe(400)
  })

  it('404s when the template is gone and 400s on a bad attachment', async () => {
    vi.mocked(loadBroadcastTemplate).mockResolvedValue({ template: null, missing: true } as any)
    expect((await POST(req(good))).status).toBe(404)
    vi.mocked(loadBroadcastTemplate).mockResolvedValue({ template: null, missing: false } as any)
    vi.mocked(loadAttachments).mockRejectedValue(new Error('Attachment not allowed'))
    const res = await POST(req(good))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Attachment not allowed' })
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('sends the rendered test mail to the admin only', async () => {
    const res = await POST(req(good))
    expect(await res.json()).toEqual({ ok: true, to: 'me@x.in' })
    expect(sendAuditedMail).toHaveBeenCalledWith({ from: 'Shop <hi@shop.in>', to: 'me@x.in', subject: '[Test] Rendered', html: '<p>hi</p>', kind: 'campaign_test', templateName: 'promo', replyTo: 'r@x.in' })
  })

  it('includes attachments and falls back to the custom template name', async () => {
    vi.mocked(loadBroadcastTemplate).mockResolvedValue({ template: null, missing: false } as any)
    vi.mocked(loadAttachments).mockResolvedValue([{ filename: 'a.pdf' }] as any)
    await POST(req(good))
    expect(sendAuditedMail).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'messaging/custom', attachments: [{ filename: 'a.pdf' }] }))
  })

  it('502s when the mail send fails', async () => {
    vi.mocked(sendAuditedMail).mockRejectedValue(new Error('smtp'))
    const res = await POST(req(good))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Send failed: smtp' })
  })
})
