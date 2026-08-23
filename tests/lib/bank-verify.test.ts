/**
 * Tests for src/lib/bank-verify.ts — Razorpay Fund Account Validation (penny-drop)
 * plus the dev stub verifier.
 *
 * The Razorpay client and the control-plane pool are mocked. We drive:
 *   - missing RAZORPAYX_ACCOUNT_NUMBER
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
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => controlPlanePool() }))

const REAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...REAL_ENV, RAZORPAYX_ACCOUNT_NUMBER: '2323230000000000' }
  poolQuery.mockResolvedValue({ rows: [] })
})

// ── verifyBankAccountFAV ────────────────────────────────────────────────────

describe('verifyBankAccountFAV', () => {
  it('fails when RAZORPAYX_ACCOUNT_NUMBER is not configured', async () => {
    delete process.env.RAZORPAYX_ACCOUNT_NUMBER
    const { verifyBankAccountFAV } = await import('@/lib/bank-verify')
    const r = await verifyBankAccountFAV('owner-1', { accountNumber: '123', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('failed')
    expect(r.reason).toMatch(/RAZORPAYX_ACCOUNT_NUMBER/)
    expect(rzPost).not.toHaveBeenCalled()
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
    expect(poolQuery.mock.calls[0][0]).toMatch(/INSERT INTO tenant_bank_accounts/)
    expect(poolQuery.mock.calls[0][1]).toEqual(['owner-2', '111', 'HDFC0001234', 'John', 'fav_2', 'JOHN DOE'])
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

  it('still returns verified when the upsert query rejects (swallowed .catch)', async () => {
    rzPost.mockResolvedValue({ id: 'fav_9', results: { account_status: 'valid', registered_name: 'Y' } })
    poolQuery.mockRejectedValue(new Error('db down'))
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
