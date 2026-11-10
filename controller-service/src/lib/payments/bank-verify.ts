// Bank account capture for Razorpay Route settlements.
//
// The account entered here becomes the settlement destination on the store's Route linked
// account. Razorpay validates it for real at configureRouteSettlement — that is the check that
// decides whether the store can be paid. Here the details are format-checked and recorded
// 'unverified'. (A ₹1 penny-drop used to confirm the holder name, but it needed a RazorpayX
// balance and RazorpayX is no longer used.)

import { saveBankVerification } from '@/lib/tenant-registry'

export interface BankDetails {
  accountNumber?: string
  ifsc?: string
  holderName?: string
  upiId?: string
}

export interface BankVerifyResult {
  /** 'unverified' = format is valid; Route validates the account when settlement is configured. */
  status: 'verified' | 'unverified' | 'failed' | 'initiated'
  verifiedName?: string
  ref?: string
  reason?: string
}

export interface BankVerifier {
  verify(details: BankDetails): Promise<BankVerifyResult>
}

export async function recordBankAccount(ownerId: string, details: BankDetails): Promise<BankVerifyResult> {
  const fmt = validateBankFormat(details)
  if (fmt.status === 'failed') return fmt
  try {
    await saveBankVerification({
      ownerId,
      ...details,
      status: 'unverified',
      ref: 'route_pending',
      verifiedName: details.holderName,
    })
  } catch {
    // This row is the only record that the account was given. Reporting success would strand the
    // owner at the go-live gate with nothing to explain it, so surface the failure and let them retry.
    return { status: 'failed', reason: 'Could not save your bank details. Please try again.' }
  }
  return fmt
}

/** Catches typos, not a wrong-but-well-formed account. */
export function validateBankFormat(d: BankDetails): BankVerifyResult {
  if (d.upiId && !/^[\w.\-]{2,}@[a-z]{2,}$/i.test(d.upiId)) {
    return { status: 'failed', reason: 'That UPI ID does not look valid' }
  }
  // A UPI ID alone is a complete payout detail; with bank fields given, those are checked too.
  if (d.upiId && !d.accountNumber && !d.ifsc) return { status: 'unverified', verifiedName: d.holderName, ref: 'format_ok' }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test((d.ifsc || '').toUpperCase())) {
    return { status: 'failed', reason: 'That IFSC code does not look valid' }
  }
  const acct = (d.accountNumber || '').replace(/\s/g, '')
  if (acct.length < 9 || acct.length > 18) {
    return { status: 'failed', reason: 'Account number should be 9-18 digits' }
  }
  return { status: 'unverified', verifiedName: d.holderName, ref: 'format_ok' }
}

// ── Stub verifier (dev without live Razorpay) ──────────────────────────────────

class StubBankVerifier implements BankVerifier {
  async verify(d: BankDetails): Promise<BankVerifyResult> {
    if (d.upiId) {
      if (/^[\w.\-]{2,}@[a-z]{2,}$/i.test(d.upiId)) {
        return { status: 'verified', verifiedName: d.holderName || 'UPI Holder', ref: 'stub_vpa_ok' }
      }
      return { status: 'failed', reason: 'Invalid UPI ID format' }
    }
    const acct = (d.accountNumber || '').replace(/\s/g, '')
    const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test((d.ifsc || '').toUpperCase())
    if (acct.length >= 9 && acct.length <= 18 && ifscOk) {
      return { status: 'verified', verifiedName: d.holderName || 'Account Holder', ref: 'stub_penny_ok' }
    }
    return { status: 'failed', reason: 'Account number or IFSC looks invalid' }
  }
}

let cached: BankVerifier | null = null
export function getBankVerifier(): BankVerifier {
  if (cached) return cached
  cached = new StubBankVerifier()
  return cached
}
