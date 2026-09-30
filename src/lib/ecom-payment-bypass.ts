// ============================================================================
// TEMPORARY - INTERNAL TESTING ONLY. REMOVE BEFORE REAL CUSTOMERS.
//
// Lets a named owner complete onboarding without paying, so the provisioning
// engine can be exercised end to end on live infrastructure without moving real
// money through Razorpay (which is on LIVE keys).
//
// To remove: delete this file and the two blocks that reference it, both marked
//   "TEMPORARY payment bypass"
//   - src/app/api/admin/ecom/kyc/[tenantId]/approve/route.ts
//
// The allow-list is env-driven (ECOM_PAYMENT_BYPASS_EMAILS, comma-separated) so
// it can be emptied in Secrets Manager immediately, without a deploy.
// ============================================================================

const DEFAULT_ALLOWED = 'aloysjehwin@gmail.com'

function allowed(): string[] {
  const raw = process.env.ECOM_PAYMENT_BYPASS_EMAILS ?? DEFAULT_ALLOWED
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isPaymentBypassed(email: string | null | undefined): boolean {
  if (!email) return false
  return allowed().includes(email.trim().toLowerCase())
}

export function bypassAuditNote(email: string): string {
  return `PAYMENT BYPASSED (temporary internal testing allow-list) for ${email}`
}
