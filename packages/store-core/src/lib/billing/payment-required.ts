// Whether a store pays before it is built: the platform administrator's choice at KYC approval
// (tenants.payment_required). Client-safe.

/** Mandatory (true): checkout link, and the first charge starts the build. Optional (false): approval starts it. Unknown: true. */
export function paymentRequired(tenant: { payment_required?: boolean | null } | null | undefined): boolean {
  return tenant?.payment_required !== false
}
