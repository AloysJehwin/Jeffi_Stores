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
 *   - Platform fee: configurable % (default 5%), +5% when the tenant is on daily payout (→10%)
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

export const PLATFORM_COMMISSION_PCT = parseFloat(process.env.PLATFORM_COMMISSION_PCT || '5') / 100

/** Extra commission for tenants who opt into daily (vs weekly) payout — added on top of the base. */
export const DAILY_PAYOUT_SURCHARGE_PCT = parseFloat(process.env.DAILY_PAYOUT_SURCHARGE_PCT || '5') / 100

/**
 * Compute the effective commission rate for a transfer: base, plus the daily-payout surcharge
 * when the tenant is on the faster cadence.
 */
function commissionPct(dailyPayout?: boolean): number {
  return PLATFORM_COMMISSION_PCT + (dailyPayout ? DAILY_PAYOUT_SURCHARGE_PCT : 0)
}

/**
 * Unix timestamp (seconds) at which a held transfer should auto-release.
 *
 * Weekly tenants release ~7 days out, daily tenants ~1 day out. Always at least 30 minutes in the
 * future — Razorpay ignores an on_hold_until in the past, and a too-near value risks racing its
 * own settlement cycle.
 *
 * CAVEAT: on_hold_until only gates the transfer if the PLATFORM's own linked-account settlement
 * schedule is faster than this hold. The native per-linked-account schedule (support-only, no API)
 * takes precedence, so the platform main account must be on a fast cycle for this to be effective.
 */
function nextPayoutReleaseTs(dailyPayout?: boolean): number {
  const now = Math.floor(Date.now() / 1000)
  const days = dailyPayout ? 1 : 7
  return Math.max(now + 30 * 60, now + days * 24 * 60 * 60)
}

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

// The fields Razorpay accepts on both create and update (PATCH forbids business_type + email).
// Shared so a recovered/reused account is brought in sync with the current KYC on re-onboard.
function accountProfilePayload(input: LinkedAccountInput) {
  return {
    phone: input.ownerPhone,
    legal_business_name: input.legalBusinessName,
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
    ...legalInfo(input),
    contact_name: input.ownerName,
  }
}

/**
 * Bring an existing linked account in sync with the current KYC (PATCH /v2/accounts/{id}).
 * business_type and email are immutable at Razorpay, so they are never sent. Best-effort:
 * a stale detail is better than a failed re-onboard, so a rejected update is swallowed.
 */
export async function updateLinkedAccount(accountId: string, input: LinkedAccountInput): Promise<void> {
  const rz = getRazorpayInstance()
  await (rz.accounts as any).edit(accountId, accountProfilePayload(input))
}

export async function createLinkedAccount(input: LinkedAccountInput): Promise<string> {
  const rz = getRazorpayInstance()

  try {
    const account = await (rz.accounts as any).create({
      email: input.ownerEmail,
      type: 'route',
      business_type: input.businessType,
      ...accountProfilePayload(input),
    })

    return account.id as string
  } catch (err: any) {
    // Razorpay allows one linked account per merchant email and rejects a second create with
    // "Merchant email already exists for account - <id>". That happens whenever the acc_xxx was
    // lost from our side (a rolled-back/suspended tenant re-provisioning) — the id we need is in
    // the error itself, so recover it rather than dying, mirroring the stakeholder path above.
    // The recovered account still holds the old store's details, so PATCH it to the current KYC.
    const desc: string = err?.error?.description ?? err?.message ?? ''
    const match = desc.match(/already exists for account\s*-\s*(acc_)?([A-Za-z0-9]+)/i)
    if (match) {
      const accountId = match[2].startsWith('acc_') ? match[2] : `acc_${match[2]}`
      await updateLinkedAccount(accountId, input).catch(() => {})
      return accountId
    }
    throw err
  }
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
  dailyPayout?: boolean
}): Promise<TransferResult> {
  const rz = getRazorpayInstance()

  const platformCommission = Math.round(opts.grossAmountPaise * commissionPct(opts.dailyPayout))
  // Shipping is NOT withheld here. It is charged once, from the tenant's prepaid wallet, at the
  // REAL invoiced amount once the AWB is billed (settleDelhiveryCostToWallet). Withholding the
  // customer-quoted ESTIMATE here as well billed every prepaid order twice, against two ledgers in
  // different databases with nothing netting them. `delhiveryChargePaise` is accepted and ignored
  // so existing callers keep compiling.
  const delhivery = 0
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
        on_hold: true,
        on_hold_until: nextPayoutReleaseTs(opts.dailyPayout),
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

export interface RouteTransfer {
  id: string
  amount: number
  amountReversed: number
}

/**
 * Look up the Route transfers created for a captured payment, so a refund can reverse the correct
 * amount. Each entry carries `amount` and `amount_reversed` (paise) — a reversal must be capped at
 * `amount - amount_reversed`, never the buyer gross. The transfer id is not persisted on the tenant
 * `payments` row, so it is fetched from Razorpay on the platform account (Route transfers always
 * originate there).
 *
 * A payment can carry MORE THAN ONE transfer; returning only the first would leave the rest
 * un-reversed and silently strand funds in the linked account.
 *
 * `ok: false` means the lookup itself failed (transient Razorpay error) and the caller must not
 * treat it as "no transfer exists" — an empty `transfers` array is the real no-transfer case.
 */
export async function fetchTransfersForPayment(
  paymentId: string,
): Promise<{ ok: true; transfers: RouteTransfer[] } | { ok: false; error: string }> {
  try {
    const rz = getRazorpayInstance()
    const list = await (rz.payments as any).fetchTransfer(paymentId)
    const items = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : []
    const transfers = items
      .filter((t: any) => t?.id)
      .map((t: any) => ({
        id: String(t.id),
        amount: Number(t.amount) || 0,
        amountReversed: Number(t.amount_reversed) || 0,
      }))
    return { ok: true, transfers }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'transfer lookup failed' }
  }
}

export interface ReversalOutcome {
  /** Paise actually reversed across every transfer on the payment. */
  reversedPaise: number
  /** Paise that should have been reversed but could not be. */
  unrecoveredPaise: number
  perTransfer: { transferId: string; amountPaise: number; error?: string }[]
  /** Set when the transfer LOOKUP failed — distinct from a reversal that was attempted and failed. */
  lookupError?: string
}

/**
 * Reverse a payment's Route transfers for a refund of `refundPaise`.
 *
 * Shared by every refund path (direct refund, return, variant-change diff) so the clawback rules
 * live in one place:
 *   - the transfer carried only the tenant's NET share, never the buyer gross, so each reversal is
 *     capped at that transfer's own `amount - amount_reversed`; over-reversing is rejected by
 *     Razorpay and silently leaks funds
 *   - spreads across multiple transfers when a payment has more than one
 *   - own-account tenants were never transferred (the platform never held the money) — nothing to
 *     reverse, so the caller skips entirely
 *
 * Never throws: a refund to the buyer must not be blocked by a failed clawback. The shortfall is
 * returned as `unrecoveredPaise` for the caller to record as tenant debt and retry.
 */
export async function reverseTransfersForRefund(
  paymentId: string,
  refundPaise: number,
): Promise<ReversalOutcome> {
  const out: ReversalOutcome = { reversedPaise: 0, unrecoveredPaise: 0, perTransfer: [] }
  if (!(refundPaise > 0)) return out

  const lookup = await fetchTransfersForPayment(paymentId)
  if (!lookup.ok) {
    // Unknown whether a transfer exists — assume the full amount is unrecovered so the retry
    // job revisits it, rather than writing off money on a transient API blip.
    out.unrecoveredPaise = refundPaise
    out.lookupError = lookup.error
    return out
  }

  let remaining = refundPaise
  for (const transfer of lookup.transfers) {
    if (remaining <= 0) break
    const reversible = Math.max(0, transfer.amount - transfer.amountReversed)
    const amountPaise = Math.min(reversible, remaining)
    if (amountPaise <= 0) continue
    try {
      await reverseTransfer(transfer.id, amountPaise)
      out.reversedPaise += amountPaise
      out.perTransfer.push({ transferId: transfer.id, amountPaise })
    } catch (e: any) {
      // Razorpay hard-fails when the linked account has no floating balance.
      const error = e?.message || 'reverse failed'
      out.unrecoveredPaise += amountPaise
      out.perTransfer.push({ transferId: transfer.id, amountPaise, error })
    }
    remaining -= amountPaise
  }
  return out
}

/**
 * Look up the Route transfer id created for a captured payment, so a refund can reverse it.
 * The transfer id is not persisted on the tenant `payments` row, so it is fetched from Razorpay
 * on the platform account (Route transfers always originate there). Returns null on any failure —
 * a missing transfer must never block the buyer refund.
 */
export async function fetchTransferIdForPayment(paymentId: string): Promise<string | null> {
  const res = await fetchTransfersForPayment(paymentId)
  return res.ok ? (res.transfers[0]?.id ?? null) : null
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
  dailyPayout?: boolean
  /** True when the wallet already debited this AWB — do not deduct shipping a second time. */
  walletBilled?: boolean
}): Promise<void> {
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()

  const grossPaise = Math.round(opts.grossAmountInr * 100)
  const rate = commissionPct(opts.dailyPayout)
  const commissionPaise = Math.round(grossPaise * rate)
  // Shipping is charged ONCE, from the wallet (debitWalletForAwb, at the real invoiced amount).
  // Deducting it here as well billed every COD order twice for the same AWB. own_delhivery tenants
  // are billed directly by Delhivery and never hit the wallet, so they keep the deduction.
  const delhiveryPaise = opts.walletBilled ? 0 : Math.round(opts.actualDelhiveryChargeInr * 100)
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

  // settlement_ledger entries: +cod_remittance (platform received), then the deductions.
  // The delhivery row is omitted when the wallet already carried the charge, so the ledger
  // never shows a deduction the tenant did not actually take here.
  await pool.query(
    `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, note, occurred_at)
     VALUES
       ($1, 'cod_remittance', $2, $3, now()),
       ($1, 'commission', $4, $5, now())`,
    [opts.tenantId,
     opts.grossAmountInr, `COD collected — order ${opts.orderRef}`,
     -(commissionPaise / 100), `Platform commission (${(rate * 100).toFixed(1)}%) — order ${opts.orderRef}`]
  ).catch(() => {})

  if (delhiveryPaise > 0) {
    await pool.query(
      `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, note, occurred_at)
       VALUES ($1, 'delhivery_correction', $2, $3, now())`,
      [opts.tenantId, -(delhiveryPaise / 100), `Delhivery charge (actual) — order ${opts.orderRef}`]
    ).catch(() => {})
  }
}

/**
 * Record a refund against the tenant's settlement ledger, including any share the platform could
 * not claw back.
 *
 * Before this, a refund left no trace in the control plane at all: `settlement_ledger` declared a
 * `refund` entry_type that nothing wrote, and `tenant_transactions.status` never moved off
 * 'captured'. The billing view therefore overstated tenant earnings by every refund ever issued.
 *
 * `unrecoveredInr` is the part of the tenant's share that the reversal could not recover (usually
 * an empty linked-account balance). It is recorded as tenant debt so it can be retried and, failing
 * that, recovered from later settlements — the buyer's refund is never made to wait on it.
 */
export async function recordRefundSettlement(opts: {
  tenantId: string
  orderRef: string
  refundedInr: number
  reversedInr: number
  unrecoveredInr: number
  note?: string
}): Promise<void> {
  if (!opts.tenantId) return
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()

  const suffix = opts.note ? ` — ${opts.note}` : ''
  await pool.query(
    `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, txn_id, note, occurred_at)
     SELECT $1, 'refund', $2, t.id, $3, now()
       FROM (SELECT id FROM tenant_transactions WHERE tenant_id = $1 AND order_ref = $4) t
     UNION ALL
     SELECT $1, 'refund', $2, NULL, $3, now()
      WHERE NOT EXISTS (SELECT 1 FROM tenant_transactions WHERE tenant_id = $1 AND order_ref = $4)`,
    [opts.tenantId, -Math.abs(opts.reversedInr), `Refund reversed — order ${opts.orderRef}${suffix}`, opts.orderRef]
  ).catch(() => {})

  if (opts.unrecoveredInr > 0) {
    await pool.query(
      `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, note, occurred_at)
       VALUES ($1, 'refund', $2, $3, now())`,
      [opts.tenantId, -Math.abs(opts.unrecoveredInr),
       `Refund NOT reversed (owed by tenant) — order ${opts.orderRef}${suffix}`]
    ).catch(() => {})
  }

  await pool.query(
    `UPDATE tenant_transactions SET status = 'refunded' WHERE tenant_id = $1 AND order_ref = $2`,
    [opts.tenantId, opts.orderRef]
  ).catch(() => {})
}

/**
 * Record a captured online payment in the control-plane `tenant_transactions`, DECOUPLED from
 * the Route transfer. The central-admin billing view reads this table; before this, the only
 * writer welded the row to a successful Route transfer and bailed whenever the tenant had no
 * approved linked account (or no request context, as on the webhook) — so real sales never
 * showed up.
 *
 * Always records the gross. When a Route transfer fired, `split` carries the real
 * tenant_share / commission / gateway_fee; otherwise the seller nominally keeps the gross
 * (commission/fee 0) until Route onboarding reconciles. Idempotent on the
 * (tenant_id, order_ref) unique key so verify + webhook can both fire for one order and write
 * exactly one row. Non-fatal — a bookkeeping failure must not break payment handling.
 */
export async function recordTenantTransaction(opts: {
  tenantId: string
  orderRef: string
  grossAmountInr: number
  isCod?: boolean
  gatewayTxnId?: string | null
  split?: { tenantShareInr: number; platformCommissionInr: number; gatewayFeeInr: number }
}): Promise<void> {
  if (!opts.tenantId || !opts.orderRef) return
  const { controlPlanePool } = await import('./tenant-registry')
  const tenantShare = opts.split ? opts.split.tenantShareInr : opts.grossAmountInr
  const commission = opts.split ? opts.split.platformCommissionInr : 0
  const gatewayFee = opts.split ? opts.split.gatewayFeeInr : 0
  await controlPlanePool().query(
    `INSERT INTO tenant_transactions
       (tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, gateway, is_cod, gateway_txn_id, status, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,'razorpay_route',$7,$8,'captured',now())
     ON CONFLICT (tenant_id, order_ref) DO NOTHING`,
    [opts.tenantId, opts.orderRef, opts.grossAmountInr, tenantShare, commission, gatewayFee,
     !!opts.isCod, opts.gatewayTxnId ?? null],
  ).catch(() => {})

  // Self-heal the transfer.processed race: the webhook may have fired (and matched 0 rows)
  // before this INSERT committed. If the transfer is already processed at Razorpay, settle now.
  // Order of the two events no longer matters. Best-effort; never blocks payment handling.
  if (opts.split && opts.gatewayTxnId && opts.gatewayTxnId.startsWith('trf_')) {
    settleTenantTransaction({ tenantId: opts.tenantId, orderRef: opts.orderRef, transferId: opts.gatewayTxnId }).catch(() => {})
  }
}

/** Live status of a Route transfer, or null on any failure. */
export async function fetchTransferStatus(transferId: string): Promise<{ status: string; onHold: boolean } | null> {
  try {
    const rz = getRazorpayInstance()
    const t = await (rz.transfers as any).fetch(transferId)
    return { status: String(t?.status ?? ''), onHold: t?.on_hold === true }
  } catch {
    return null
  }
}

/**
 * Idempotently move a prepaid tenant_transactions row captured -> settled AND write its
 * settlement_ledger entries (tenant_share credit, commission debit, gateway_fee debit). Called by
 * the transfer.processed webhook, by recordTenantTransaction's post-insert self-check, and by the
 * reconcile job. Idempotent: the status guard makes the flip a no-op once settled, and the ledger
 * insert is guarded so entries are written exactly once per (tenant, order_ref).
 *
 * `verifyLive`: when true (reconcile path) the transfer's live status is confirmed `processed`
 * before settling; the webhook/self-check paths already know it processed and pass false.
 */
export async function settleTenantTransaction(opts: {
  tenantId: string
  orderRef?: string
  transferId?: string
  verifyLive?: boolean
}): Promise<'settled' | 'noop'> {
  if (!opts.tenantId || (!opts.orderRef && !opts.transferId)) return 'noop'
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()

  const where = opts.orderRef
    ? { clause: 'order_ref = $2', val: opts.orderRef }
    : { clause: 'gateway_txn_id = $2', val: opts.transferId! }
  const row = await pool.query(
    `SELECT id, order_ref, gateway_txn_id, tenant_share, platform_commission, gateway_fee, is_cod, status
       FROM tenant_transactions WHERE tenant_id = $1 AND ${where.clause} LIMIT 1`,
    [opts.tenantId, where.val]
  ).then(r => r.rows[0]).catch(() => null)
  if (!row || row.status !== 'captured' || row.is_cod) return 'noop'

  if (opts.verifyLive && row.gateway_txn_id?.startsWith('trf_')) {
    const live = await fetchTransferStatus(row.gateway_txn_id)
    if (!live || live.status !== 'processed' || live.onHold) return 'noop'
  }

  const flipped = await pool.query(
    `UPDATE tenant_transactions SET status = 'settled'
      WHERE id = $1 AND status = 'captured' RETURNING id`,
    [row.id]
  ).then(r => r.rowCount ?? 0).catch(() => 0)
  if (!flipped) return 'noop'

  // Prepaid settlement ledger — mirror the COD shape, guarded so it writes once per order.
  const tenantShare = Number(row.tenant_share) || 0
  const commission = Number(row.platform_commission) || 0
  const gatewayFee = Number(row.gateway_fee) || 0
  await pool.query(
    `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, txn_id, note, occurred_at)
     SELECT * FROM (VALUES
        ($1::uuid, 'order_capture', $2::numeric, $5::uuid, $6::text, now()),
        ($1::uuid, 'commission',    $3::numeric, $5::uuid, $7::text, now()),
        ($1::uuid, 'gateway_fee',   $4::numeric, $5::uuid, $8::text, now())
     ) v(tenant_id, entry_type, amount, txn_id, note, occurred_at)
     WHERE NOT EXISTS (
       SELECT 1 FROM settlement_ledger
        WHERE tenant_id = $1 AND txn_id = $5 AND entry_type = 'order_capture')`,
    [opts.tenantId, tenantShare, -Math.abs(commission), -Math.abs(gatewayFee), row.id,
     `Order settled (tenant share) — order ${row.order_ref}`,
     `Platform commission — order ${row.order_ref}`,
     `Gateway fee — order ${row.order_ref}`]
  ).catch(() => {})

  return 'settled'
}

/**
 * Reconcile captured prepaid rows whose Route transfer has already processed at Razorpay but whose
 * status never advanced (the transfer.processed race). Reads live transfer status and settles each
 * via settleTenantTransaction(verifyLive). Optionally scoped to one tenant. Returns how many settled.
 */
export async function reconcileCapturedTransactions(opts?: {
  tenantId?: string
  olderThanMinutes?: number
  limit?: number
}): Promise<{ scanned: number; settled: number }> {
  const { controlPlanePool } = await import('./tenant-registry')
  const pool = controlPlanePool()
  const age = opts?.olderThanMinutes ?? 2
  const limit = opts?.limit ?? 200
  const args: any[] = [age, limit]
  let scope = ''
  if (opts?.tenantId) { args.push(opts.tenantId); scope = `AND tenant_id = $${args.length}` }
  const rows = await pool.query(
    `SELECT tenant_id, gateway_txn_id FROM tenant_transactions
      WHERE status = 'captured' AND is_cod = false
        AND gateway_txn_id LIKE 'trf_%'
        AND occurred_at < now() - ($1 || ' minutes')::interval
        ${scope}
      ORDER BY occurred_at ASC LIMIT $2`,
    args
  ).then(r => r.rows).catch(() => [])

  let settled = 0
  for (const r of rows) {
    const res = await settleTenantTransaction({ tenantId: r.tenant_id, transferId: r.gateway_txn_id, verifyLive: true }).catch(() => 'noop' as const)
    if (res === 'settled') settled++
  }
  return { scanned: rows.length, settled }
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
