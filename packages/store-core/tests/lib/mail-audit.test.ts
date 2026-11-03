import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mocks must be declared before imports
const mockSendMail = vi.fn()

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

import * as db from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'

const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>

describe('sendAuditedMail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMail.mockResolvedValue({ messageId: 'msg-123' })
    mockQueryOne.mockResolvedValue({ id: 'log-1' })
  })

  it('sends mail and returns messageId', async () => {
    const result = await sendAuditedMail({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      kind: 'order',
      entityType: 'orders',
      entityId: 'order-1',
      userId: 'user-1',
      templateName: 'test_template',
    })

    expect(result.messageId).toBe('msg-123')
    expect(mockSendMail).toHaveBeenCalledOnce()
  })

  it('logs success with correct fields', async () => {
    await sendAuditedMail({
      to: 'user@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      kind: 'order',
      entityType: 'orders',
      entityId: 'order-1',
      userId: 'user-1',
      templateName: 'test_template',
    })

    expect(mockQueryOne).toHaveBeenCalledOnce()
    const [, insertArgs] = mockQueryOne.mock.calls[0]
    expect(insertArgs).toContain('sent')
    expect(insertArgs).toContain('user@example.com')
    expect(insertArgs).toContain('msg-123')
  })

  it('resolves array recipients into comma-separated string in log', async () => {
    await sendAuditedMail({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Multi',
      html: '<p>hi</p>',
      kind: 'campaign',
    })

    const [, insertArgs] = mockQueryOne.mock.calls[0]
    expect(insertArgs).toContain('a@example.com, b@example.com')
  })

  it('handles cc and bcc as arrays', async () => {
    await sendAuditedMail({
      to: 'main@example.com',
      subject: 'With CC',
      html: '<p>cc</p>',
      kind: 'transactional',
      cc: ['cc1@example.com', 'cc2@example.com'],
      bcc: 'bcc@example.com',
    })

    const [, insertArgs] = mockQueryOne.mock.calls[0]
    expect(insertArgs).toContain('cc1@example.com, cc2@example.com')
    expect(insertArgs).toContain('bcc@example.com')
  })

  it('throws on sendMail failure and logs failed status', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP error'))

    await expect(
      sendAuditedMail({
        to: 'fail@example.com',
        subject: 'Will fail',
        html: '<p>nope</p>',
        kind: 'order',
      })
    ).rejects.toThrow('SMTP error')

    expect(mockQueryOne).toHaveBeenCalledOnce()
    const [, insertArgs] = mockQueryOne.mock.calls[0]
    expect(insertArgs).toContain('failed')
    expect(insertArgs).toContain('SMTP error')
  })

  it('does not throw if audit log INSERT fails (swallowed)', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB down'))

    const result = await sendAuditedMail({
      to: 'user@example.com',
      subject: 'No audit',
      html: '<p>ok</p>',
      kind: 'order',
    })

    expect(result.messageId).toBe('msg-123')
  })

  it('uses default FROM when no from option provided', async () => {
    await sendAuditedMail({
      to: 'test@example.com',
      subject: 'From test',
      kind: 'order',
    })

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining('Jeffi'),
      })
    )
  })

  it('uses provided from override', async () => {
    await sendAuditedMail({
      from: '"Custom" <custom@example.com>',
      to: 'test@example.com',
      subject: 'Custom From',
      kind: 'order',
    })

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: '"Custom" <custom@example.com>' }))
  })

  it('serializes metadata to JSON in log', async () => {
    await sendAuditedMail({
      to: 'meta@example.com',
      subject: 'Meta',
      kind: 'order',
      metadata: { orderId: '123', amount: 500 },
    })

    const [, insertArgs] = mockQueryOne.mock.calls[0]
    const metaArg = insertArgs[insertArgs.length - 1]
    expect(metaArg).toContain('orderId')
    expect(metaArg).toContain('123')
  })

  it('passes null metadata when not provided', async () => {
    await sendAuditedMail({
      to: 'nometa@example.com',
      subject: 'No meta',
      kind: 'order',
    })

    const [, insertArgs] = mockQueryOne.mock.calls[0]
    expect(insertArgs[insertArgs.length - 1]).toBeNull()
  })

  it('passes through text body to sendMail', async () => {
    await sendAuditedMail({
      to: 'txt@example.com',
      subject: 'Text only',
      text: 'plain text body',
      kind: 'order',
    })

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ text: 'plain text body' }))
  })

  it('passes attachments through to sendMail', async () => {
    const attachments = [{ filename: 'file.pdf', content: Buffer.from('data') }]

    await sendAuditedMail({
      to: 'attach@example.com',
      subject: 'With attachment',
      html: '<p>see attached</p>',
      kind: 'invoice',
      attachments,
    })

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ attachments }))
  })

  it('truncates long error messages to 2000 chars in log', async () => {
    const longError = 'e'.repeat(3000)
    mockSendMail.mockRejectedValue(new Error(longError))

    await expect(
      sendAuditedMail({
        to: 'long@example.com',
        subject: 'Long error',
        kind: 'order',
      })
    ).rejects.toThrow()

    const [, insertArgs] = mockQueryOne.mock.calls[0]
    const errorArg = insertArgs.find((a: unknown) => typeof a === 'string' && a.length <= 2000 && a.length > 0)
    expect(errorArg).toBeDefined()
    expect(errorArg!.length).toBeLessThanOrEqual(2000)
  })
})
