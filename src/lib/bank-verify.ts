// Bank account verification — penny-drop (Razorpay Fund Account Validation).
//
// Interface + stub so the flow is built now; the real Razorpay validation is
// swapped in once Route/RazorpayX is active (PROVISIONING_PROVIDER/BANK_VERIFY=razorpay).
// Penny-drop: a ₹1 deposit whose beneficiary-name readback confirms the account
// exists AND the holder name matches.

export interface BankDetails {
  accountNumber?: string
  ifsc?: string
  holderName?: string
  upiId?: string
}

export interface BankVerifyResult {
  status: 'verified' | 'failed'
  verifiedName?: string
  ref?: string
  reason?: string
}

export interface BankVerifier {
  verify(details: BankDetails): Promise<BankVerifyResult>
}

// Stub: verifies any well-formed account; rejects obviously invalid input so the
// UI's failure path is exercised too. A test account (0000...) always verifies.
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
  // if (process.env.BANK_VERIFY === 'razorpay') { cached = new RazorpayBankVerifier(); return cached }
  cached = new StubBankVerifier()
  return cached
}
