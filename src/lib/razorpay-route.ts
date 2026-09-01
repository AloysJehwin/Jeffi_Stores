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
 *   - Razorpay's own charges, passed through to the tenant (see below)
 *
 * Razorpay debits the platform's balance twice on a Route payment: the gateway fee on the full
 * captured amount, and a transfer fee on each amount moved to a linked account. Both are
 * inclusive of GST. Neither used to be deducted from the tenant's share, so the platform paid
 * them out of its commission — on a ₹1,000 card order that left ₹3.54 of a nominal ₹30, and an
 * international card (3% + GST) settled at a ₹8.26 loss.
 *
 * The gateway fee is read from the captured payment (`fee`, in paise, already including `tax`)
 * rather than estimated, because the real rate varies by method — UPI bills far less than cards.
 */

export const PLATFORM_COMMISSION_PCT = parseFloat(process.env.PLATFORM_COMMISSION_PCT || '3') / 100

/** Razorpay's fee for moving money to a linked account, charged on the transferred amount. */
export const ROUTE_TRANSFER_FEE_PCT = parseFloat(process.env.ROUTE_TRANSFER_FEE_PCT || '0.25') / 100
const GST_MULTIPLIER = 1 + parseFloat(process.env.GST_PCT || '18') / 100

/** Fallback gateway rate used only when the captured payment cannot be read. */
const FALLBACK_GATEWAY_FEE_PCT = parseFloat(process.env.RAZORPAY_GATEWAY_FEE_PCT || '2') / 100

/**
 * Razorpay's gateway fee on a captured payment, in paise, GST included.
 *
 * Falls back to an estimate if the payment cannot be fetched: under-deducting costs the platform
 * margin, but throwing here would abandon a transfer for a payment that already succeeded.
 */
async function gatewayFeePaise(rz: any, paymentId: string, grossPaise: number): Promise<number> {
  try {
    const payment = await rz.payments.fetch(paymentId)
    const fee = Number(payment?.fee)
    if (Number.isFinite(fee) && fee >= 0) return Math.round(fee)
  } catch { /* fall through to the estimate */ }
  return Math.round(grossPaise * FALLBACK_GATEWAY_FEE_PCT * GST_MULTIPLIER)
}

/**
 * Normalize an Indian phone number to the 10-digit form Razorpay Route expects. Strips spaces,
 * punctuation, a leading +91 / 91 country code, and a leading 0. Returns null if the result
 * isn't a plausible 10-digit mobile (starts 6–9), so callers can fail clearly instead of
 * sending a value Razorpay rejects with "The phone format is invalid".
 */
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

export interface LinkedAccountInput {
  businessName: string
  businessType: 'proprietorship' | 'partnership' | 'private_limited' | 'public_limited' | 'llp' | 'ngo' | 'not_yet_registered'
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
  /** Razorpay's charges deducted from the tenant's share, in paise. */
  gatewayFeePaise: number
  transferFeePaise: number
  platformCommissionPaise: number
}

/**
 * Create a Razorpay Route linked account for a tenant.
 * Called on KYC approval — the tenant's business details from KYC are used.
 * Returns the Razorpay account_id (acc_xxxx).
 */
/**
 * The PAN holder-type characters Razorpay accepts as a *company* PAN for each business type.
 *
 * The 4th character of an Indian PAN encodes who holds it — 'P' a person, 'F' a firm (including
 * partnerships and LLPs), 'C' a company, 'T' a trust, 'A' an association, 'B' a body of
 * individuals. Razorpay checks that character against the declared business type and rejects a
 * mismatch with "The company pan field is invalid for business type: <type>".
 *
 * An empty set means the entity has no PAN of its own: a proprietorship trades on the
 * proprietor's personal PAN, and an unregistered business has none at all.
 */
const COMPANY_PAN_CHARS: Record<LinkedAccountInput['businessType'], string[]> = {
  proprietorship:     [],
  not_yet_registered: [],
  partnership:        ['F'],
  llp:                ['F'],
  private_limited:    ['C'],
  public_limited:     ['C'],
  ngo:                ['T', 'A', 'B'],
}

const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/**
 * Whether this PAN can be sent as the linked account's company PAN.
 *
 * Sending a mismatched PAN fails the whole provisioning step, so anything we are not sure
 * about is omitted: Razorpay accepts the account without it and the PAN can be completed from
 * the dashboard, whereas a rejected create leaves the tenant with no linked account at all.
 * The individual's PAN still reaches Razorpay on the stakeholder's kyc.pan.
 */
export function isValidCompanyPan(
  pan: string | null | undefined,
  businessType: LinkedAccountInput['businessType'],
): boolean {
  const p = String(pan ?? '').trim().toUpperCase()
  if (!PAN_SHAPE.test(p)) return false
  return COMPANY_PAN_CHARS[businessType]?.includes(p[3]) ?? false
}

const GSTIN_SHAPE = /^[0123][0-9][A-Z]{5}[0-9]{4}[A-Z][0-9][A-Z0-9][A-Z0-9]$/i

/** legal_info carries the company PAN and GSTIN. Both are optional; an invalid one is
 *  omitted rather than sent, because Razorpay rejects the whole create on either. */
function legalInfo(input: LinkedAccountInput): { legal_info?: { pan?: string; gst?: string } } {
  const info: { pan?: string; gst?: string } = {}
  if (isValidCompanyPan(input.pan, input.businessType)) info.pan = input.pan.trim().toUpperCase()
  const gst = (input.gstNumber ?? '').trim().toUpperCase()
  if (GSTIN_SHAPE.test(gst)) info.gst = gst
  return Object.keys(info).length ? { legal_info: info } : {}
}

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
          state: input.state.trim().toUpperCase(),
          postal_code: input.postalCode,
          country: 'IN',
        },
      },
    },
    type: 'route',
    legal_business_name: input.legalBusinessName,
    business_type: input.businessType,
    ...legalInfo(input),
    contact_name: input.ownerName,
  })

  return account.id as string
}

/**
 * Create a stakeholder on a Route linked account (required before the account can
 * accept the route product / settle payouts). Best-effort idempotent: if Razorpay
 * reports the stakeholder already exists, fetch and return the existing one.
 * Returns the stakeholder id (sth_xxxx).
 */
export async function createRouteStakeholder(
  accountId: string,
  { name, email, pan }: { name: string; email: string; pan?: string }
): Promise<string> {
  const rz = getRazorpayInstance()

  try {
    // email is mandatory — without it Razorpay answers "The email field is required.",
    // which the caller swallows, leaving an account with no stakeholder and no settlement.
    const stakeholder = await (rz as any).stakeholders.create(accountId, {
      name,
      email,
      ...(pan ? { kyc: { pan } } : {}),
    })
    return stakeholder.id as string
  } catch (err: any) {
    const desc = err?.error?.description ?? err?.message ?? ''
    // Idempotent-ish: if one already exists, fetch and return it.
    if (/already exists/i.test(desc)) {
      const list = await (rz as any).stakeholders.all(accountId).catch(() => null)
      const existing = list?.items?.[0]
      if (existing?.id) return existing.id as string
    }
    throw err
  }
}

/**
 * Enable the 'route' product on a linked account and attach the owner's verified
 * bank as the settlement destination, so Route balances settle to their account.
 *
 * NEVER throws — needs LIVE Razorpay keys to fully succeed; on test keys it may
 * error, which is fine (non-fatal). Returns { ok, error? }.
 */
export async function configureRouteSettlement(
  accountId: string,
  { accountNumber, ifsc, beneficiaryName }: { accountNumber: string | null; ifsc: string | null; beneficiaryName: string | null }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const rz = getRazorpayInstance()

    const config = await (rz as any).products.requestProductConfiguration(accountId, {
      product_name: 'route',
      tnc_accepted: true,
    })
    const configId = config?.id
    if (!configId) return { ok: false, error: 'no product configuration id returned' }

    await (rz as any).products.edit(accountId, configId, {
      settlements: {
        account_number: accountNumber,
        ifsc_code: ifsc,
        beneficiary_name: beneficiaryName,
      },
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.error?.description ?? err?.message ?? String(err) }
  }
}

/**
 * Razorpay has no delete for a linked account — the documented statuses are 'created' and
 * 'suspended', and neither the account API nor the CLI can set them. A deprovisioned tenant
 * therefore leaves the account behind for good.
 *
 * The most we can do is mark it, so an operator can find it in the dashboard and suspend it
 * there, and so a later re-onboarding of the same owner recognises it. Razorpay rejects a
 * second account on the same email ("Merchant email already exists"), so the id is worth
 * keeping rather than forgetting.
 *
 * Never throws: teardown must not fail on a bookkeeping call.
 */
export async function markLinkedAccountDeprovisioned(
  accountId: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const rz = getRazorpayInstance()
    await (rz.accounts as any).edit(accountId, {
      notes: { deprovisioned_at: new Date().toISOString(), deprovisioned_slug: slug },
      customer_facing_business_name: `[closed] ${slug}`.slice(0, 255),
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.error?.description ?? err?.message ?? String(err) }
  }
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
  const gatewayFee = await gatewayFeePaise(rz, opts.paymentId, opts.grossAmountPaise)

  // The transfer fee is charged on the amount actually transferred, so it depends on the figure
  // it is being subtracted from. Charging it on the pre-fee share overstates it by a fraction of
  // a paisa — in the tenant's favour, and cheaper than solving the circularity exactly.
  const beforeTransferFee = Math.max(0, opts.grossAmountPaise - platformCommission - gatewayFee - delhivery)
  const transferFee = Math.round(beforeTransferFee * ROUTE_TRANSFER_FEE_PCT * GST_MULTIPLIER)
  const tenantShare = Math.max(0, beforeTransferFee - transferFee)

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
          gateway_fee: gatewayFee,
          transfer_fee: transferFee,
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
    gatewayFeePaise: gatewayFee,
    transferFeePaise: transferFee,
    platformCommissionPaise: platformCommission,
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
    proprietor:  'proprietorship',
    partnership: 'partnership',
    pvt_ltd:     'private_limited',
    llp:         'llp',
    other:       'not_yet_registered',
  }
  return map[kycType] ?? 'not_yet_registered'
}

/**
 * Infer Razorpay profile category from product categories string.
 * Used when creating the linked account.
 */
export function inferProfileCategory(productCategories: string | null): { category: string; subcategory: string } {
  // Subcategories are validated against the category. 'electronics', 'pharmacy' and
  // 'e_commerce' are not members of 'ecommerce' and were rejected with
  // "Invalid business subcategory for business category: ecommerce".
  const cats = (productCategories ?? '').toLowerCase()
  if (cats.includes('electronics') || cats.includes('gadget')) return { category: 'ecommerce', subcategory: 'electronics_and_furniture' }
  if (cats.includes('fashion') || cats.includes('apparel')) return { category: 'ecommerce', subcategory: 'fashion_and_lifestyle' }
  if (cats.includes('food') || cats.includes('groceri')) return { category: 'food', subcategory: 'online_food_ordering' }
  if (cats.includes('health') || cats.includes('beauty')) return { category: 'healthcare', subcategory: 'pharmacy' }
  return { category: 'ecommerce', subcategory: 'ecommerce_marketplace' }
}
