/**
 * Tests for src/lib/bank-verify.ts — Razorpay Fund Account Validation (penny-drop)
 * plus the dev stub verifier.
 *
 * The Razorpay client and the control-plane pool are mocked. We drive:
 *   - missing RAZORPAYX_ACCOUNT_NUMBER → format-checked 'unverified' fallback
 *   - FAV invalid → 'failed' + UPDATE
 *   - FAV valid → 'verified' + UPSERT (registered_name / fallback name chains)
 *   - thrown Razorpay error (error.description vs message)
 *   - the StubBankVerifier UPI + bank-account branches
 *   - the legacy no-op helpers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rzPost = vi.fn()
const rz = { api: { post: rzPost } }
const getRazorpayInstance = vi.fn(() => rz)
vi.mock('@/lib/razorpay', () => ({ getRazorpayInstance: () => getRazorpayInstance() }))

const poolQuery = vi.fn()
const controlPlanePool = vi.fn(() => ({ query: poolQuery }))
const saveBankVerification = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => controlPlanePool(),
  saveBankVerification: (a: unknown) => saveBankVerification(a),
}))

const REAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...REAL_ENV, RAZORPAYX_ACCOUNT_NUMBER: '2323230000000000' }
  poolQuery.mockResolvedValue({ rows: [] })
  saveBankVerification.mockResolvedValue({ id: 'bank-1' })
})

// ── verifyBankAccountFAV ────────────────────────────────────────────────────

describe('verifyBankAccountFAV', () => {
  // Route-only setup: no RazorpayX balance to fund the penny-drop, so the account is
  // format-checked and stored 'unverified' rather than blocking the owner outright.
  it('records unverified without calling FAV when RAZORPAYX_ACCOUNT_NUMBER is not configured', async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '001122334455', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'unverified', verifiedName: 'A', ref: 'format_ok' })
    expect(rzPost).not.toHaveBeenCalled()
    expect(saveBankVerification).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1', status: 'unverified', ref: 'route_pending',
    }))
  })

  it('treats an empty RAZORPAYX_ACCOUNT_NUMBER as unconfigured', async () => {
    process.env.RAZORPAYX_ACCOUNT_NUMBER = '   '
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '001122334455', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('unverified')
    expect(rzPost).not.toHaveBeenCalled()
  })

  it('rejects a malformed account without saving when FAV is unavailable', async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '123', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('failed')
    expect(saveBankVerification).not.toHaveBeenCalled()
  })

  // The stored row is the only evidence the account exists on this path, so a failed write must
  // not be reported as success — the owner would hit the go-live gate with no explanation.
  it('reports failure when the unverified record cannot be saved', async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER
    saveBankVerification.mockRejectedValue(new Error('db down'))
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '001122334455', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('failed')
    expect(r.reason).toMatch(/try again/i)
  })

  it('returns failed and marks status failed when account_status is invalid', async () => {
    rzPost.mockResolvedValue({ id: 'fav_1', results: { account_status: 'invalid' } })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '999', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'failed', reason: 'Bank account not found or invalid' })
    // the UPDATE ... failed query fired
    expect(poolQuery.mock.calls[0][0]).toMatch(/verification_status='failed'/)
    expect(poolQuery.mock.calls[0][1]).toEqual(['fav_1', 'owner-1'])
  })

  it('verifies and upserts using results.registered_name', async () => {
    rzPost.mockResolvedValue({ id: 'fav_2', results: { account_status: 'valid', registered_name: 'JOHN DOE' } })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-2', { accountNumber: '111', ifsc: 'HDFC0001234', holderName: 'John' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'JOHN DOE', ref: 'fav_2' })
    expect(saveBankVerification).toHaveBeenCalledWith({
      ownerId: 'owner-2', accountNumber: '111', ifsc: 'HDFC0001234', holderName: 'John',
      status: 'verified', ref: 'fav_2', verifiedName: 'JOHN DOE',
    })
  })

  it('falls back to fund_account bank_account name when registered_name absent', async () => {
    rzPost.mockResolvedValue({
      id: 'fav_3',
      results: { account_status: 'valid' },
      fund_account: { bank_account: { name: 'ACME LTD' } },
    })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-3', { accountNumber: '222', ifsc: 'HDFC0001234', holderName: 'Acme' })
    expect(r.verifiedName).toBe('ACME LTD')
  })

  it('falls back to details.holderName when both name sources absent', async () => {
    rzPost.mockResolvedValue({ id: 'fav_4', results: {} })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-4', { accountNumber: '333', ifsc: 'HDFC0001234', holderName: 'Fallback' })
    expect(r.status).toBe('verified')
    expect(r.verifiedName).toBe('Fallback')
  })

  it('handles missing detail fields (nullish → empty strings)', async () => {
    rzPost.mockResolvedValue({ id: 'fav_5', results: { account_status: 'valid', registered_name: 'X' } })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-5', {})
    expect(r.status).toBe('verified')
    // request body used empty strings for name/ifsc/account_number
    const sent = rzPost.mock.calls[0][0]
    expect(sent.data.fund_account.bank_account).toEqual({ name: '', ifsc: '', account_number: '' })
    expect(sent.data.amount).toBe(100)
  })

  it('returns failed with error.description when Razorpay throws a structured error', async () => {
    rzPost.mockRejectedValue({ error: { description: 'IFSC invalid' } })
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-6', { accountNumber: '444', ifsc: 'BAD', holderName: 'A' })
    expect(r).toEqual({ status: 'failed', reason: 'IFSC invalid' })
  })

  it('returns failed with message when error has no description', async () => {
    rzPost.mockRejectedValue(new Error('network down'))
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-7', { accountNumber: '555', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'failed', reason: 'network down' })
  })

  it('returns generic failed reason when error is empty', async () => {
    rzPost.mockRejectedValue({})
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-8', { accountNumber: '666', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'failed', reason: 'Verification failed' })
  })

  it('still returns verified when the upsert rejects (swallowed .catch)', async () => {
    rzPost.mockResolvedValue({ id: 'fav_9', results: { account_status: 'valid', registered_name: 'Y' } })
    saveBankVerification.mockRejectedValue(new Error('db down'))
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-9', { accountNumber: '777', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'Y', ref: 'fav_9' })
  })

  it('still returns failed when the invalid-status UPDATE rejects (swallowed .catch)', async () => {
    rzPost.mockResolvedValue({ id: 'fav_10', results: { account_status: 'invalid' } })
    poolQuery.mockRejectedValue(new Error('db down'))
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-10', { accountNumber: '888', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'failed', reason: 'Bank account not found or invalid' })
  })
})

// ── StubBankVerifier / getBankVerifier ──────────────────────────────────────

describe('StubBankVerifier via getBankVerifier', () => {
  it('verifies a well-formed UPI id', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'john.doe@okhdfc', holderName: 'John' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'John', ref: 'stub_vpa_ok' })
  })

  it('defaults the UPI holder name when none given', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'user@ybl' })
    expect(r.verifiedName).toBe('UPI Holder')
  })

  it('fails a malformed UPI id', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'not-a-vpa' })
    expect(r).toEqual({ status: 'failed', reason: 'Invalid UPI ID format' })
  })

  it('verifies a valid account number + IFSC', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'hdfc0001234', holderName: 'Acme' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'Acme', ref: 'stub_penny_ok' })
  })

  it('defaults the account holder name when none given', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'HDFC0001234' })
    expect(r.verifiedName).toBe('Account Holder')
  })

  it('fails when account number is too short', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '123', ifsc: 'HDFC0001234' })
    expect(r).toEqual({ status: 'failed', reason: 'Account number or IFSC looks invalid' })
  })

  it('fails when IFSC is malformed', async () => {
    const { getBankVerifier } = await import('@/lib/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'XX' })
    expect(r.status).toBe('failed')
  })

  it('caches the verifier instance across calls', async () => {
    const mod = await import('@/lib/bank-verify')
    expect(mod.getBankVerifier()).toBe(mod.getBankVerifier())
  })
})

// ── legacy no-op helpers ─────────────────────────────────────────────────────

describe('legacy penny-drop helpers', () => {
  it('initiateDoublepennyDrop is a no-op that points to FAV', async () => {
    const { initiateDoublepennyDrop } = await import('@/lib/bank-verify')
    await expect(initiateDoublepennyDrop()).resolves.toEqual({ initiated: false, error: 'Use verifyBankAccountFAV instead' })
  })

  it('confirmDoublepennyDrop is a no-op that points to FAV', async () => {
    const { confirmDoublepennyDrop } = await import('@/lib/bank-verify')
    await expect(confirmDoublepennyDrop()).resolves.toEqual({ status: 'failed', reason: 'Use verifyBankAccountFAV instead' })
  })
})
