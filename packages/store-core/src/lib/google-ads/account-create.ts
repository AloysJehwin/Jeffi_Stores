import { queryOne } from '@/lib/shared/db'
import { normalizeCustomerId, type GoogleAdsClient } from './client'

// New Google Ads accounts for a store, created under the platform manager account
// (CustomerService.CreateCustomerClient), and the billing state Google exposes for an account.
// Currency and time zone are immutable after creation. Jeffi never creates a billing setup: the
// API only does that for monthly invoicing with a payments account, which the store must own, so
// the store adds its own payment method in Google Ads.

export const NEW_ACCOUNT_CURRENCY = 'INR'
export const NEW_ACCOUNT_TIME_ZONE = 'Asia/Kolkata'
const MAX_NAME = 100

export interface NewAccountResult {
  customerId: string
  name: string
  invitation: { email: string; sent: boolean; error: string | null } | null
}

export const accountName = (storeName: string) => (storeName.trim() || 'Store').replace(/\s+/g, ' ').slice(0, MAX_NAME)

/**
 * validateOnly (checks the manager is allowed to create accounts), then the real create (never
 * retried), then an Admin invitation for the store's Google user so they can open the account
 * and add billing. A failed invitation does not undo the account.
 */
export async function createStoreAccount(
  mgr: GoogleAdsClient,
  input: { name: string; inviteEmail?: string | null },
  opts: { preview?: boolean } = {}
): Promise<NewAccountResult | { preview: true }> {
  const body = {
    customerClient: { descriptiveName: accountName(input.name), currencyCode: NEW_ACCOUNT_CURRENCY, timeZone: NEW_ACCOUNT_TIME_ZONE },
  }
  await mgr.post(':createCustomerClient', { ...body, validateOnly: true })
  if (opts.preview) return { preview: true }
  const res = await mgr.withRetryDelays([]).post<{ resourceName?: string }>(':createCustomerClient', body)
  const customerId = normalizeCustomerId(String(res?.resourceName ?? '').split('/').pop())
  if (!/^\d{10}$/.test(customerId)) throw new Error('Google created the account but returned no customer id. Check the manager account in Google Ads.')

  let invitation: NewAccountResult['invitation'] = null
  const email = input.inviteEmail?.trim()
  if (email) {
    try {
      await mgr
        .forCustomer(customerId, mgr.customerId)
        .withRetryDelays([])
        .post('/customerUserAccessInvitations:mutate', { operation: { create: { emailAddress: email, accessRole: 'ADMIN' } } })
      invitation = { email, sent: true, error: null }
    } catch (e) {
      invitation = { email, sent: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { customerId, name: body.customerClient.descriptiveName, invitation }
}

export type BillingState = 'APPROVED' | 'APPROVED_HELD' | 'PENDING' | 'CANCELLED' | 'NONE'

export interface BillingStatus {
  status: BillingState
  paymentsAccountName: string | null
}

const RANK: Record<string, number> = { APPROVED: 4, APPROVED_HELD: 3, PENDING: 2, CANCELLED: 1 }

/**
 * Billing setups visible to the API. Google returns them for monthly invoicing; an account paying
 * by card (automatic payments) shows none here, so NONE means "check Billing in Google Ads".
 */
export async function billingStatus(ads: GoogleAdsClient): Promise<BillingStatus> {
  const rows = await ads.searchStream(
    `SELECT billing_setup.id, billing_setup.status, billing_setup.payments_account_info.payments_account_name
     FROM billing_setup`
  )
  const best = rows
    .map(r => r.billingSetup ?? {})
    .filter(b => RANK[b.status])
    .sort((a, b) => RANK[b.status] - RANK[a.status])[0]
  if (!best) return { status: 'NONE', paymentsAccountName: null }
  return { status: best.status as BillingState, paymentsAccountName: best.paymentsAccountInfo?.paymentsAccountName ?? null }
}

/** Mirror the billing state onto the account row (no-op before the first sync created it). */
export async function saveBillingStatus(b: BillingStatus): Promise<void> {
  await queryOne(
    `UPDATE ads_account SET billing_status = $1, billing_account_name = $2, billing_checked_at = now() WHERE id = 1`,
    [b.status, b.paymentsAccountName]
  ).catch(() => null)
}

/** Billing in the Google Ads UI (Google opens the account picker when needed). */
export const BILLING_URL = 'https://ads.google.com/aw/billing/summary'
