import { getRazorpayInstance } from './razorpay'

/**
 * Razorpay Route (POBO) — linked account management and transfer helpers.
 *
 * Flow:
 * 1. KYC approved → createLinkedAccount() → stores acc_xxxx on tenant
 * 2. Customer pays order on tenant storefront → transferToLinkedAccount()
 *    Platform keeps commission + gateway fees; tenant gets net amount
 * 3. Razorpay settles tenant's linked account balance to their registered bank
 *
 * Commission structure (platform takes from each order):
 *   - Platform fee: configurable % (default 3%)
 *   - Delhivery charge correction buffer: ₹20 per COD order
 *   - Gateway fee pass-through (Razorpay charges ~2% from platform account)
 */

export const PLATFORM_COMMISSION_PCT = parseFloat(process.env.PLATFORM_COMMISSION_PCT || '3') / 100

export interface LinkedAccountInput {
  businessName: string
  businessType: 'route_proprietorship' | 'route_partnership' | 'route_private_limited' | 'route_public_limited' | 'route_llp' | 'route_ngo' | 'route_not_yet_registered'
  legalBusinessName: string
  businessDescription?: string
  profileCategory: string
  profileSubcategory: string
  ownerEmail: string
  ownerPhone: string
  ownerName: string
  pan: string
  gstNumber?: string
  streetAddress: string
  streetAddress2?: string
  city: string
  state: string
  postalCode: string
}

export interface TransferResult {
  transferId: string
  amount: number
  linkedAccountId: string
  status: string
}

/**
 * Create a Razorpay Route linked account for a tenant.
 * Called on KYC approval — the tenant's business details from KYC are used.
 * Returns the Razorpay account_id (acc_xxxx).
 */
export async function createLinkedAccount(input: LinkedAccountInput): Promise<string> {
  const rz = getRazorpayInstance()

  const account = await (rz.accounts as any).create({
    email: input.ownerEmail,
    phone: input.ownerPhone,
    profile: {
      category: input.profileCategory,
      subcategory: input.profileSubcategory,
      addresses: {
        registered: {
          street1: input.streetAddress,
          street2: input.streetAddress2 || 'N/A',
          city: input.city,
          state: input.state,
          postal_code: input.postalCode,
          country: 'IN',
        },
      },
    },
    type: 'route',
    legal_business_name: input.legalBusinessName,
    business_type: input.businessType,
    // Only include legal_info if PAN is provided — Razorpay validates PAN format
    // strictly (5th char must match entity type). Can be added later via dashboard.
    ...(input.pan ? { legal_info: { pan: input.pan } } : {}),
    contact_name: input.ownerName,
  })

  return account.id as string
}

/**
 * Transfer the tenant's share of an order payment to their linked account.
 *
 * @param paymentId  Razorpay payment_id (pay_xxxx) from the captured order
 * @param grossAmountPaise  Total order amount in paise
 * @param linkedAccountId  Tenant's Razorpay linked account (acc_xxxx)
 * @param isCod  Whether this is a COD order (extra Delhivery buffer)
 * @param delhiveryChargePaise  Actual Delhivery charge in paise (deducted from tenant share)
 */
export async function transferToLinkedAccount(opts: {
  paymentId: string
  grossAmountPaise: number
  linkedAccountId: string
  isCod?: boolean
  delhiveryChargePaise?: number
  orderId?: string
  tenantSlug?: string
}): Promise<TransferResult> {
  const rz = getRazorpayInstance()

  const platformCommission = Math.round(opts.grossAmountPaise * PLATFORM_COMMISSION_PCT)
  const delhivery = opts.delhiveryChargePaise ?? 0
  // NOTE: COD orders are settled via recordCodSettlement() (ledger-based), NOT here —
  // this transfer path is only for online payments that have a Razorpay payment_id.
  const tenantShare = Math.max(0, opts.grossAmountPaise - platformCommission - delhivery)

  const transfers = await (rz as any).api.post({
    url: `/payments/${opts.paymentId}/transfers`,
    data: {
      transfers: [{
        account: opts.linkedAccountId,
        amount: tenantShare,
        currency: 'INR',
        notes: {
          order_id: opts.orderId ?? '',
          tenant_slug: opts.tenantSlug ?? '',
          gross_amount: opts.grossAmountPaise,
          platform_commission: platformCommission,
          delhivery_charge: delhivery,
        },
        linked_account_notes: ['order_id', 'tenant_slug'],
        on_hold: 0,
      }],
    },
  })

  const transfer = transfers.items?.[0]
  return {
    transferId: transfer?.id ?? '',
    amount: tenantShare,
    linkedAccountId: opts.linkedAccountId,
    status: transfer?.status ?? 'created',
  }
}

/**
 * Reverse a transfer (for refunds). Moves money back from linked account to platform.
 */
export async function reverseTransfer(transferId: string, amountPaise?: number): Promise<void> {
  const rz = getRazorpayInstance()
  await (rz.transfers as any).reverse(transferId, { amount: amountPaise })
}

/**
 * Record a COD order settlement in the control-plane ledger.
 *
 * COD cash is collected by Delhivery and remitted to the PLATFORM's account
 * out-of-band (not via a Razorpay payment_id), so it cannot use Route transfers.
 * Instead we record a ledger entry: the tenant is owed (gross − commission − actual
 * Delhivery charge), settled in the next payout cycle.
 *
 * Uses the ACTUAL reconciled Delhivery charge (delhivery_billed_amount) when available,
 * falling back to the estimate — this fixes the "AWB estimate vs actual pickup charge"
 * mismatch flagged in the plan.
 */
export async function recordCodSettlement(opts: {
  tenantId: string
  tenantSlug: string
  orderRef: string
  grossAmountInr: number
  actualDelhiveryChargeInr: number
}): Promise<void> {
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()

  const grossPaise = Math.round(opts.grossAmountInr * 100)
  const commissionPaise = Math.round(grossPaise * PLATFORM_COMMISSION_PCT)
  const delhiveryPaise = Math.round(opts.actualDelhiveryChargeInr * 100)
  const tenantSharePaise = Math.max(0, grossPaise - commissionPaise - delhiveryPaise)

  // tenant_transactions row (COD, no gateway txn id)
  await pool.query(
    `INSERT INTO tenant_transactions
       (tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, gateway, is_cod, status, occurred_at)
     VALUES ($1,$2,$3,$4,$5,0,'cod_remittance',true,'settled',now())
     ON CONFLICT DO NOTHING`,
    [opts.tenantId, opts.orderRef, opts.grossAmountInr,
     tenantSharePaise / 100, commissionPaise / 100]
  ).catch(() => {})

  // settlement_ledger entries: +cod_remittance (platform received), then the deductions
  await pool.query(
    `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, note, occurred_at)
     VALUES
       ($1, 'cod_remittance', $2, $3, now()),
       ($1, 'commission', $4, $5, now()),
       ($1, 'delhivery_correction', $6, $7, now())`,
    [opts.tenantId,
     opts.grossAmountInr, `COD collected — order ${opts.orderRef}`,
     -(commissionPaise / 100), `Platform commission (${(PLATFORM_COMMISSION_PCT * 100).toFixed(1)}%) — order ${opts.orderRef}`,
     -(delhiveryPaise / 100), `Delhivery charge (actual) — order ${opts.orderRef}`]
  ).catch(() => {})
}

/**
 * Map KYC business_type to Razorpay Route account type.
 */
export function mapBusinessType(kycType: string): LinkedAccountInput['businessType'] {
  const map: Record<string, LinkedAccountInput['businessType']> = {
    proprietor:  'route_proprietorship',
    partnership: 'route_partnership',
    pvt_ltd:     'route_private_limited',
    llp:         'route_llp',
    other:       'route_not_yet_registered',
  }
  return map[kycType] ?? 'route_not_yet_registered'
}

/**
 * Infer Razorpay profile category from product categories string.
 * Used when creating the linked account.
 */
export function inferProfileCategory(productCategories: string | null): { category: string; subcategory: string } {
  const cats = (productCategories ?? '').toLowerCase()
  if (cats.includes('electronics') || cats.includes('gadget')) return { category: 'ecommerce', subcategory: 'electronics' }
  if (cats.includes('fashion') || cats.includes('apparel')) return { category: 'ecommerce', subcategory: 'fashion_and_lifestyle' }
  if (cats.includes('food') || cats.includes('groceri')) return { category: 'food', subcategory: 'online_food_ordering' }
  if (cats.includes('health') || cats.includes('beauty')) return { category: 'ecommerce', subcategory: 'pharmacy' }
  return { category: 'ecommerce', subcategory: 'e_commerce' }
}
