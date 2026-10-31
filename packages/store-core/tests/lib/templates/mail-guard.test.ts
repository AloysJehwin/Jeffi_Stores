import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMail = vi.fn()
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStoreIdentity: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  customerMailFromAsync: vi.fn(async () => 'noreply@acme.in'),
  currentBrandNameAsync: vi.fn(async () => 'Acme Tools'),
  storeBaseUrlAsync: vi.fn(async () => 'https://acme.in'),
}))

import { queryMany } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { sendAuditedMail } from '@/lib/shared/mail-audit'

describe('sendAuditedMail token guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMail.mockResolvedValue({ messageId: 'm1' })
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(getStoreIdentity).mockResolvedValue({
      name: 'Acme Tools',
      email: '',
      phone: '',
      web: 'acme.in',
      logoUrl: '',
      emailAccent: '',
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('substitutes a leaked registered token before sending and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sendAuditedMail({
      to: 'a@b.in',
      subject: 'From {store_name}',
      html: '<div>{{ store_name }}</div>',
      text: 'Visit {store_web}',
      kind: 'campaign',
    })
    const sent = sendMail.mock.calls[0][0]
    expect(sent.subject).toBe('From Acme Tools')
    expect(sent.html).toBe('<div>Acme Tools</div>')
    expect(sent.text).toBe('Visit acme.in')
    expect(warn).toHaveBeenCalled()
  })

  it('leaves token-free mail untouched without loading variables', async () => {
    await sendAuditedMail({ to: 'a@b.in', subject: 'Hi', html: '<p>x</p>', kind: 'order' })
    expect(sendMail.mock.calls[0][0].subject).toBe('Hi')
    expect(getStoreIdentity).not.toHaveBeenCalled()
  })
})
