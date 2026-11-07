/**
 * Tests for src/lib/bank-verify.ts: the format-checked 'unverified' record and the dev stub verifier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveBankVerification = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({
  saveBankVerification: (a: unknown) => saveBankVerification(a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  saveBankVerification.mockResolvedValue({ id: 'bank-1' })
})

describe('recordBankAccount', () => {
  it('records a well-formed account as unverified', async () => {
    const { recordBankAccount } = await import('@controller/lib/payments/bank-verify')
    const r = await recordBankAccount('owner-1', { accountNumber: '001122334455', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r).toEqual({ status: 'unverified', verifiedName: 'A', ref: 'format_ok' })
    expect(saveBankVerification).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', status: 'unverified', ref: 'route_pending' })
    )
  })

  it('rejects a malformed account without saving', async () => {
    const { recordBankAccount } = await import('@controller/lib/payments/bank-verify')
    const r = await recordBankAccount('owner-1', { accountNumber: '123', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('failed')
    expect(saveBankVerification).not.toHaveBeenCalled()
  })

  // The stored row is the only evidence the account exists, so a failed write must not be reported
  // as success: the owner would hit the go-live gate with no explanation.
  it('reports failure when the record cannot be saved', async () => {
    saveBankVerification.mockRejectedValue(new Error('db down'))
    const { recordBankAccount } = await import('@controller/lib/payments/bank-verify')
    const r = await recordBankAccount('owner-1', { accountNumber: '001122334455', ifsc: 'HDFC0001234', holderName: 'A' })
    expect(r.status).toBe('failed')
    expect(r.reason).toMatch(/try again/i)
  })
})

// ── StubBankVerifier / getBankVerifier ──────────────────────────────────────

describe('StubBankVerifier via getBankVerifier', () => {
  it('verifies a well-formed UPI id', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'john.doe@okhdfc', holderName: 'John' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'John', ref: 'stub_vpa_ok' })
  })

  it('defaults the UPI holder name when none given', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'user@ybl' })
    expect(r.verifiedName).toBe('UPI Holder')
  })

  it('fails a malformed UPI id', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ upiId: 'not-a-vpa' })
    expect(r).toEqual({ status: 'failed', reason: 'Invalid UPI ID format' })
  })

  it('verifies a valid account number + IFSC', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'hdfc0001234', holderName: 'Acme' })
    expect(r).toEqual({ status: 'verified', verifiedName: 'Acme', ref: 'stub_penny_ok' })
  })

  it('defaults the account holder name when none given', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'HDFC0001234' })
    expect(r.verifiedName).toBe('Account Holder')
  })

  it('fails when account number is too short', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '123', ifsc: 'HDFC0001234' })
    expect(r).toEqual({ status: 'failed', reason: 'Account number or IFSC looks invalid' })
  })

  it('fails when IFSC is malformed', async () => {
    const { getBankVerifier } = await import('@controller/lib/payments/bank-verify')
    const r = await getBankVerifier().verify({ accountNumber: '00112233445', ifsc: 'XX' })
    expect(r.status).toBe('failed')
  })

  it('caches the verifier instance across calls', async () => {
    const mod = await import('@controller/lib/payments/bank-verify')
    expect(mod.getBankVerifier()).toBe(mod.getBankVerifier())
  })
})
