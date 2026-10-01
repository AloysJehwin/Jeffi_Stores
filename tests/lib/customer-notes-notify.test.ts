import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendAuditedMail = vi.fn()
const mockOwnerAdminEmails = vi.fn()
const mockListNotesSince = vi.fn()

vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: (...a: unknown[]) => mockSendAuditedMail(...a) }))
vi.mock('@/lib/catalog/brand', () => ({
  adminMailFrom: () => '"Jeffi Stores" <admin@jeffistores.in>',
  currentBrandNameAsync: async () => 'Jeffi Stores',
  currentAdminBaseUrl: () => 'https://admin.jeffistores.in/admin',
}))
vi.mock('@/lib/shared/customer-notes', () => ({
  ownerAdminEmails: (...a: unknown[]) => mockOwnerAdminEmails(...a),
  listNotesSince: (...a: unknown[]) => mockListNotesSince(...a),
}))

import { notifyOwnersOfNote, sendNotesDigest } from '@/lib/shared/customer-notes-notify'

const note = {
  id: 'n1',
  userId: 'u1',
  orderNumber: 'JS-1001',
  adminUsername: 'priya',
  source: 'staff_form',
  createdAt: '2026-09-24T10:00:00.000Z',
  sharedWithCustomer: false,
  title: 'Wants <M8> bolts',
  body: 'Asked for 200 pcs & a quote',
  tags: ['quote'],
  attachments: [],
  customerName: 'Rahul & Co',
} as never

describe('customer note mails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendAuditedMail.mockResolvedValue({ messageId: 'm1' })
    mockOwnerAdminEmails.mockResolvedValue([{ email: 'owner@example.com' }])
  })

  it('owner alert uses the standard store mail template', async () => {
    await notifyOwnersOfNote(note, { email: 'priya@example.com', name: 'Priya' })
    expect(mockSendAuditedMail).toHaveBeenCalledOnce()
    const opts = mockSendAuditedMail.mock.calls[0][0]
    expect(opts).toMatchObject({
      to: 'owner@example.com',
      kind: 'admin_notification',
      templateName: 'customer_note_created',
      entityType: 'customer_note',
      entityId: 'n1',
    })
    expect(opts.html).toContain('font-size:28px;font-weight:bold;color:#2563eb')
    expect(opts.html).toContain('<h2>New Customer Note</h2>')
    expect(opts.html).toContain('Priya added a note from the staff form')
    expect(opts.html).toContain('Wants &lt;M8&gt; bolts')
    expect(opts.html).toContain('Rahul &amp; Co')
    expect(opts.html).toContain('https://admin.jeffistores.in/admin/customers/u1')
    expect(opts.html).not.toContain('linear-gradient')
  })

  it('digest counts the notes and sends one mail per owner', async () => {
    mockListNotesSince.mockResolvedValue([note, { ...(note as object), id: 'n2', title: null, body: null, tags: [] }])
    mockOwnerAdminEmails.mockResolvedValue([{ email: 'a@example.com' }, { email: 'b@example.com' }])
    const count = await sendNotesDigest(24)
    expect(count).toBe(2)
    expect(mockSendAuditedMail).toHaveBeenCalledTimes(2)
    const opts = mockSendAuditedMail.mock.calls[0][0]
    expect(opts.subject).toBe('2 customer notes added today - Jeffi Stores')
    expect(opts.html).toContain('<h2>Customer Notes Digest</h2>')
    expect(opts.html).toContain('2 customer notes added in the last 24 hours')
  })

  it('digest sends nothing when there are no notes', async () => {
    mockListNotesSince.mockResolvedValue([])
    expect(await sendNotesDigest(24)).toBe(0)
    expect(mockSendAuditedMail).not.toHaveBeenCalled()
  })
})
