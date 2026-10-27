import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import type { RfqStatus } from '../../api/business'
import { useAuthStore } from '../../stores/authStore'
import { numberFormat } from '../../lib/format'
import { invoiceUrl } from '../orders/shared'
import { useAccountUser, useBusiness } from '../account/hooks'
import type { SelectOption, Tone } from '../../ui'

// Shared bits of the business quote (RFQ) screens: controller-service app/(business)/business/quotes/*.

/** RequestQuoteButton's MAX_DISCOUNT_PCT: a target price can be at most 30% under the listed price. */
export const MAX_DISCOUNT_PCT = 30

export const RFQ_STATUSES: RfqStatus[] = ['pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted', 'rejected']

/** The detail page's STATUS_LABEL. */
export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  pending: 'Pending Review',
  reviewed: 'Under Review',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted: 'Quotation Ready',
  rejected: 'Rejected',
}

/** The list's short labels (the web capitalises the status). */
export const RFQ_STATUS_SHORT: Record<RfqStatus, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted: 'Converted',
  rejected: 'Rejected',
}

export const RFQ_STATUS_TONE: Record<RfqStatus, Tone> = {
  pending: 'warning',
  reviewed: 'info',
  negotiating: 'transit',
  offer_accepted: 'accent',
  converted: 'success',
  rejected: 'danger',
}

export const rfqTone = (s: string): Tone => RFQ_STATUS_TONE[s as RfqStatus] ?? 'warning'

/** Units offered on a quote line: 'Nos' (the web's default) and lib/catalog/units.ts. */
export const RFQ_UNITS: SelectOption[] = [
  ['Nos', 'Nos'],
  ['pc', 'pc / pcs'],
  ['pair', 'pair'],
  ['set', 'set'],
  ['box', 'box'],
  ['pack', 'pack'],
  ['roll', 'roll'],
  ['sheet', 'sheet'],
  ['bundle', 'bundle'],
  ['case', 'case'],
  ['kit', 'kit'],
  ['dozen', 'dozen'],
  ['m', 'm'],
  ['cm', 'cm'],
  ['mm', 'mm'],
  ['km', 'km'],
  ['ft', 'ft'],
  ['in', 'in'],
  ['yd', 'yd'],
  ['m2', 'm²'],
  ['cm2', 'cm²'],
  ['ft2', 'ft²'],
  ['in2', 'in²'],
  ['yd2', 'yd²'],
  ['L', 'L'],
  ['ml', 'ml'],
  ['gal', 'gal (US)'],
  ['cl', 'cl'],
  ['kg', 'kg'],
  ['g', 'g'],
  ['mg', 'mg'],
  ['lb', 'lb'],
  ['oz', 'oz'],
  ['mt', 'mt (tonne)'],
].map(([value, label]) => ({ value, label }))

/** RFQ_UNITS, plus `unit` first when it isn't one of them (a cart line's own unit label). */
export function unitOptions(unit?: string | null): SelectOption[] {
  return unit && !RFQ_UNITS.some(o => o.value === unit) ? [{ value: unit, label: unit }, ...RFQ_UNITS] : RFQ_UNITS
}

/** Whole rupees, as the web's toLocaleString('en-IN', { maximumFractionDigits: 0 }). */
export const rupees0 = numberFormat({ maximumFractionDigits: 0 })

/** A typed decimal (blank or not a number → null). */
export function parseAmount(raw: string): number | null {
  const v = parseFloat(raw)
  return raw.trim() === '' || !Number.isFinite(v) ? null : v
}

/** Keep a price field to digits and one point. */
export const cleanDecimal = (raw: string) => raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

/** The quotation document for a token; on the store's quotation host, beside the invoice one. */
export const quotationUrl = (slug: string | null, token: string) => invoiceUrl(slug, encodeURIComponent(token)).replace('://invoice', '://quotation')

export const paymentLabel = (s: string | null) => (s === 'paid' ? 'Paid' : s === 'partial' ? 'Partially paid' : 'Unpaid')
export const paymentTone = (s: string | null): Tone => (s === 'paid' ? 'success' : s === 'partial' ? 'progress' : 'warning')

/** The web's guard on every business quote page: an approved business account, else back to the account. */
export function useRequireBusiness() {
  const router = useRouter()
  const user = useAccountUser()
  const isLoading = useAuthStore(s => s.isLoading)
  const { approved } = useBusiness()
  useEffect(() => {
    if (!isLoading && !approved) router.replace(user ? '/(tabs)/account' : '/(auth)/login')
  }, [isLoading, approved, user, router])
  return { ready: !isLoading && approved, user }
}
