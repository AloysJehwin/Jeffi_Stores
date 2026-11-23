import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))
vi.mock('@jeffi/mail-shell', () => ({
  sesConnections: () => 5,
  sesSend: vi.fn(async (fn: () => Promise<any>) => fn()),
}))

import { sendEmail, emailConfigured } from '../src/providers/email'
import { sesSend } from '@jeffi/mail-shell'

describe('email provider', () => {
  beforeEach(() => {
    createTransport.mockClear()
    sendMail.mockReset()
    vi.mocked(sesSend).mockClear()
    process.env.SES_SMTP_USER = 'u'
    process.env.SES_SMTP_PASSWORD = 'p'
  })
  afterEach(() => { delete process.env.SES_SMTP_USER; delete process.env.SES_SMTP_PASSWORD })

  // First, before any send caches the transport: the uninitialized path throws without credentials.
  it('throws when the SMTP credentials are missing', async () => {
    delete process.env.SES_SMTP_PASSWORD
    await expect(sendEmail({ to: 'a@b.com', from: 'f@b.com', subject: 'S', html: 'x' })).rejects.toThrow(/SES_SMTP/)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('emailConfigured reflects the SES SMTP env', () => {
    expect(emailConfigured()).toBe(true)
    delete process.env.SES_SMTP_USER
    expect(emailConfigured()).toBe(false)
  })

  it('strips HTML to a text part and returns the SES id parsed from the 250 response', async () => {
    sendMail.mockResolvedValue({ response: '250 Ok 0100-abc', messageId: '<x@local>' })
    const id = await sendEmail({ to: 'a@b.com', from: 'f@b.com', subject: 'Hi', html: '<p>Hello <b>world</b></p>' })
    expect(id).toBe('0100-abc')
    const mail = sendMail.mock.calls[0][0]
    expect(mail.text).toBe('Hello world')
    expect(mail.to).toBe('a@b.com')
    // transactional share by default; first real send builds the transport
    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sesSend).mock.calls[0][1]).toBe('transactional')
  })

  it('falls back to the nodemailer message id and uses the bulk share when asked', async () => {
    sendMail.mockResolvedValue({ response: 'queued', messageId: '<fallback@local>' })
    const id = await sendEmail({ to: 'a@b.com', from: 'f@b.com', subject: 'S', html: '<p>x</p>', bulk: true })
    expect(id).toBe('<fallback@local>')
    expect(vi.mocked(sesSend).mock.calls[0][1]).toBe('bulk')
  })

  it('sets In-Reply-To/References when replying, and reuses the cached transport', async () => {
    sendMail.mockResolvedValue({ response: '250 Ok id2' })
    await sendEmail({ to: 'a@b.com', from: 'f@b.com', subject: 'S', html: '<p>x</p>', inReplyTo: '<m1@ses>' })
    expect(sendMail.mock.calls[0][0]).toMatchObject({ inReplyTo: '<m1@ses>', references: '<m1@ses>' })
    expect(createTransport).not.toHaveBeenCalled() // transport cached from an earlier send
  })
})
