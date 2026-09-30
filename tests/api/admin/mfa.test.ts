import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/auth/mfa', () => ({
  verifyMfaTicket: vi.fn(),
  generateTotpSecret: vi.fn(),
  buildOtpauthUrl: vi.fn(),
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  verifyTotp: vi.fn(),
  hashRecoveryCode: vi.fn(),
}))

vi.mock('@/lib/auth/admin-session', () => ({
  issueAdminSession: vi.fn(),
}))

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockImplementation(() => Promise.resolve('data:image/png;base64,QR==')),
  },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as enrollStart } from '@/app/api/admin/mfa/enroll-start/route'
import { POST as enrollConfirm } from '@/app/api/admin/mfa/enroll-confirm/route'
import { POST as mfaVerify } from '@/app/api/admin/mfa/verify/route'
import {
  verifyMfaTicket,
  generateTotpSecret,
  buildOtpauthUrl,
  encryptSecret,
  generateRecoveryCodes,
  verifyTotp,
  decryptSecret,
  hashRecoveryCode,
} from '@/lib/auth/mfa'
import { queryOne, query } from '@/lib/shared/db'
import { issueAdminSession } from '@/lib/auth/admin-session'
import { NextResponse } from 'next/server'

const mockVerifyTicket = vi.mocked(verifyMfaTicket)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockIssueAdminSession = vi.mocked(issueAdminSession)
const mockGenerateSecret = vi.mocked(generateTotpSecret)
const mockBuildUrl = vi.mocked(buildOtpauthUrl)
const mockEncryptSecret = vi.mocked(encryptSecret)
const mockGenerateCodes = vi.mocked(generateRecoveryCodes)
const mockVerifyTotp = vi.mocked(verifyTotp)
const mockDecryptSecret = vi.mocked(decryptSecret)
const mockHashRecoveryCode = vi.mocked(hashRecoveryCode)

function makePostRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validTicketPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  purpose: 'enroll' as const,
}

const validVerifyTicketPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  purpose: 'verify' as const,
}

const adminRow = {
  id: 'admin-1',
  username: 'testadmin',
  first_name: 'Test',
  last_name: 'Admin',
  role: 'admin',
  scopes: ['products'],
  mfa_enabled: false,
  mfa_secret_enc: null,
}

// ── enroll-start ──────────────────────────────────────────────────────────────

describe('POST /api/admin/mfa/enroll-start', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when ticket is missing', async () => {
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-start', {})
    const res = await enrollStart(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing ticket/i)
  })

  it('returns 401 for invalid ticket', async () => {
    mockVerifyTicket.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-start', { ticket: 'bad-ticket' })
    const res = await enrollStart(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid/i)
  })

  it('returns 404 when admin not found', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockQueryOne.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-start', { ticket: 'valid-ticket' })
    const res = await enrollStart(req)
    expect(res.status).toBe(404)
  })

  it('returns 400 when already enrolled', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockQueryOne.mockResolvedValue({ ...adminRow, mfa_enabled: true })
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-start', { ticket: 'valid-ticket' })
    const res = await enrollStart(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already enrolled/i)
  })

  it('returns QR code and secret on success', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockQueryOne.mockResolvedValue(adminRow)
    mockGenerateSecret.mockResolvedValue('TOTP_SECRET_BASE32')
    mockBuildUrl.mockResolvedValue('otpauth://totp/testadmin?secret=TOTP_SECRET_BASE32')

    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-start', { ticket: 'valid-ticket' })
    const res = await enrollStart(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.secret).toBe('TOTP_SECRET_BASE32')
    expect(body.otpauth_url).toContain('otpauth://')
    expect(body.qr_data_url).toMatch(/^data:image/)
  })
})

// ── enroll-confirm ────────────────────────────────────────────────────────────

describe('POST /api/admin/mfa/enroll-confirm', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 400 when fields are missing', async () => {
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', { ticket: 't' })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 401 for invalid ticket', async () => {
    mockVerifyTicket.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', {
      ticket: 'bad',
      secret: 'SEC',
      code: '123456',
    })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid TOTP code', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockVerifyTotp.mockResolvedValue(false)
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', {
      ticket: 'valid',
      secret: 'SEC',
      code: '000000',
    })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid verification code/i)
  })

  it('returns 404 when admin not found after TOTP valid', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockVerifyTotp.mockResolvedValue(true)
    mockQueryOne.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', {
      ticket: 'valid',
      secret: 'SEC',
      code: '123456',
    })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(404)
  })

  it('returns 400 when already enrolled at confirm step', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockVerifyTotp.mockResolvedValue(true)
    mockQueryOne.mockResolvedValue({ ...adminRow, mfa_enabled: true })
    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', {
      ticket: 'valid',
      secret: 'SEC',
      code: '123456',
    })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already enrolled/i)
  })

  it('issues session with recovery codes on valid enrollment', async () => {
    mockVerifyTicket.mockResolvedValue(validTicketPayload)
    mockVerifyTotp.mockResolvedValue(true)
    mockQueryOne.mockResolvedValue(adminRow)
    mockEncryptSecret.mockReturnValue('encrypted-secret')
    mockGenerateCodes.mockReturnValue([
      { plain: 'AAAAA-BBBBB', hash: 'hash1' },
      { plain: 'CCCCC-DDDDD', hash: 'hash2' },
    ])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const sessionResponse = NextResponse.json({
      success: true,
      admin: { name: 'Test Admin', email: 'testadmin@example.com', role: 'admin' },
      recovery_codes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
    })
    mockIssueAdminSession.mockResolvedValue(sessionResponse)

    const req = makePostRequest('http://localhost/api/admin/mfa/enroll-confirm', {
      ticket: 'valid',
      secret: 'SEC',
      code: '123456',
    })
    const res = await enrollConfirm(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.recovery_codes).toHaveLength(2)
    expect(mockQuery).toHaveBeenCalled()
  })
})

// ── mfa/verify ────────────────────────────────────────────────────────────────

describe('POST /api/admin/mfa/verify', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 400 when fields are missing', async () => {
    const req = makePostRequest('http://localhost/api/admin/mfa/verify', { ticket: 't' })
    const res = await mfaVerify(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 401 for invalid ticket', async () => {
    mockVerifyTicket.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/verify', {
      ticket: 'bad',
      code: '123456',
    })
    const res = await mfaVerify(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when MFA not enrolled', async () => {
    mockVerifyTicket.mockResolvedValue(validVerifyTicketPayload)
    mockQueryOne.mockResolvedValue(null)
    const req = makePostRequest('http://localhost/api/admin/mfa/verify', {
      ticket: 'valid',
      code: '123456',
    })
    const res = await mfaVerify(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not enrolled/i)
  })

  it('returns 401 for invalid TOTP code', async () => {
    mockVerifyTicket.mockResolvedValue(validVerifyTicketPayload)
    mockQueryOne.mockResolvedValue({ ...adminRow, mfa_enabled: true, mfa_secret_enc: 'encrypted' })
    mockDecryptSecret.mockReturnValue('PLAIN_SECRET')
    mockVerifyTotp.mockResolvedValue(false)

    const req = makePostRequest('http://localhost/api/admin/mfa/verify', {
      ticket: 'valid',
      code: '000000',
    })
    const res = await mfaVerify(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid code/i)
  })

  it('issues session on valid TOTP code', async () => {
    mockVerifyTicket.mockResolvedValue(validVerifyTicketPayload)
    mockQueryOne.mockResolvedValue({ ...adminRow, mfa_enabled: true, mfa_secret_enc: 'encrypted' })
    mockDecryptSecret.mockReturnValue('PLAIN_SECRET')
    mockVerifyTotp.mockResolvedValue(true)

    const sessionResponse = NextResponse.json({
      success: true,
      admin: { name: 'Test Admin', email: 'testadmin@example.com', role: 'admin' },
    })
    mockIssueAdminSession.mockResolvedValue(sessionResponse)

    const req = makePostRequest('http://localhost/api/admin/mfa/verify', {
      ticket: 'valid',
      code: '123456',
    })
    const res = await mfaVerify(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('issues session on valid recovery code', async () => {
    mockVerifyTicket.mockResolvedValue(validVerifyTicketPayload)
    const adminWithMfa = { ...adminRow, mfa_enabled: true, mfa_secret_enc: 'encrypted' }
    mockQueryOne
      .mockResolvedValueOnce(adminWithMfa) // admin fetch
      .mockResolvedValueOnce({ id: 'rcode-1' }) // recovery code lookup

    mockHashRecoveryCode.mockReturnValue('code-hash-abc')
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const sessionResponse = NextResponse.json({
      success: true,
      admin: { name: 'Test Admin', email: 'testadmin@example.com', role: 'admin' },
    })
    mockIssueAdminSession.mockResolvedValue(sessionResponse)

    // Recovery code format: AAAAA-BBBBB (not 6 digits)
    const req = makePostRequest('http://localhost/api/admin/mfa/verify', {
      ticket: 'valid',
      code: 'AAAAA-BBBBB',
    })
    const res = await mfaVerify(req)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('used_at'), expect.arrayContaining(['rcode-1']))
  })
})
