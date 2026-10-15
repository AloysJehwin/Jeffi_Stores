// Bank account capture for Razorpay Route settlements.
//
// The account entered here becomes the settlement destination on the store's Route linked
// account. Razorpay validates it for real at configureRouteSettlement — that is the check that
// decides whether the store can be paid.
//
// Fund Account Validation (FAV) can additionally confirm the holder's name up front with a ₹1
// penny-drop, but it debits that ₹1 from a RazorpayX balance and so needs
// RAZORPAYX_ACCOUNT_NUMBER. This platform uses Route, not RazorpayX. The header here used to
// claim "no RazorpayX required", which is untrue, and the code threw when the variable was
// unset — blocking onboarding outright, because hasVerifiedBank() gates it.
//
// So FAV is now optional: used when a RazorpayX account is configured, skipped when it is not.
// Without it the details are format-checked and recorded as 'unverified' — honest about what
// was and was not confirmed — and onboarding proceeds to the check that actually matters.
//
// Flow:
// 1. POST /api/ecom/bank/verify → calls verifyBankAccount() → returns verified name
// 2. Owner sees "Verified — <name>" immediately

import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { controlPlanePool, saveBankVerification } from '@/lib/tenant-registry'

export interface BankDetails {
  accountNumber?: string
  ifsc?: string
  holderName?: string
  upiId?: string
}

export interface BankVerifyResult {
  /** 'unverified' = format is valid, but no penny-drop ran to confirm the holder name. */
  status: 'verified' | 'unverified' | 'failed' | 'initiated'
  verifiedName?: string
  ref?: string
  reason?: string
}

export interface BankVerifier {
  verify(details: BankDetails): Promise<BankVerifyResult>
}

// ── Real Razorpay FAV verifier ────────────────────────────────────────────────

export async function verifyBankAccountFAV(ownerId: string, details: BankDetails): Promise<BankVerifyResult> {
  // FAV needs a RazorpayX balance to take the ₹1 from. On a Route-only setup there is none, so
  // record the details and let Route validate them for real at settlement configuration.
  const sourceAccount = process.env.RAZORPAYX_ACCOUNT_NUMBER
  if (!sourceAccount?.trim()) {
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
      // This row is the only record that the account was given — unlike the FAV path there is no
      // Razorpay-side validation to reconcile from. Reporting success would strand the owner at
      // the go-live gate with nothing to explain it, so surface the failure and let them retry.
      return { status: 'failed', reason: 'Could not save your bank details. Please try again.' }
    }
    return fmt
  }

  const rz = getRazorpayInstance()
  const pool = controlPlanePool()

  try {
    const fav = await (rz as any).api.post({
      url: '/fund_accounts/validations',
      data: {
        account_number: sourceAccount,
        fund_account: {
          account_type: 'bank_account',
          bank_account: {
            name: details.holderName ?? '',
            ifsc: details.ifsc ?? '',
            account_number: details.accountNumber ?? '',
          },
          contact: {
            name: details.holderName ?? '',
            type: 'vendor',
            reference_id: `ow_${ownerId.slice(-16)}`,
          },
        },
        amount: 100,
        currency: 'INR',
      },
    })

    // FAV status: created → processing → completed/failed
    // For instant sync response, check results.account_status
    const accountStatus = fav.results?.account_status
    const registeredName = fav.results?.registered_name ?? fav.fund_account?.bank_account?.name ?? details.holderName

    if (accountStatus === 'invalid') {
      await pool
        .query(
          `UPDATE tenant_bank_accounts SET verification_status='failed', verification_ref=$1, updated_at=now() WHERE owner_id=$2`,
          [fav.id, ownerId]
        )
        .catch(() => {})
      return { status: 'failed', reason: 'Bank account not found or invalid' }
    }

    await saveBankVerification({
      ownerId,
      ...details,
      status: 'verified',
      ref: fav.id,
      verifiedName: registeredName,
    }).catch(() => {})

    return { status: 'verified', verifiedName: registeredName ?? details.holderName, ref: fav.id }
  } catch (err: any) {
    const reason = err?.error?.description ?? err?.message ?? 'Verification failed'
    return { status: 'failed', reason }
  }
}

/** Format check used when FAV cannot run. Catches typos, not a wrong-but-well-formed account. */
export function validateBankFormat(d: BankDetails): BankVerifyResult {
  if (d.upiId) {
    return /^[\w.\-]{2,}@[a-z]{2,}$/i.test(d.upiId)
      ? { status: 'unverified', verifiedName: d.holderName, ref: 'format_ok' }
      : { status: 'failed', reason: 'That UPI ID does not look valid' }
  }
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

// Legacy penny-drop functions kept for reference — replaced by FAV above
export async function initiateDoublepennyDrop(): Promise<{ initiated: boolean; error?: string }> {
  return { initiated: false, error: 'Use verifyBankAccountFAV instead' }
}
export async function confirmDoublepennyDrop(): Promise<BankVerifyResult> {
  return { status: 'failed', reason: 'Use verifyBankAccountFAV instead' }
}
