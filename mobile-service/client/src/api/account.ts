import { api, BASE_URL, getStoredToken } from './client'
import type { User } from '../types'
import type { CardProduct } from '../types/home'

// The account pages' routes, same paths and payloads the storefront calls.

/** /api/auth/me — the fields the web's AuthContext user carries beyond the app's User. */
export type AccountUser = User & {
  phoneVerified?: boolean
  dateOfBirth?: string | null
  avatarUrl?: string | null
  isBusiness?: boolean
  approvalStatus?: string
  requiresPolicyAcceptance?: boolean
}

export interface FeatureFlags {
  smsEnabled: boolean
  whatsappEnabled: boolean
  loyaltyEnabled: boolean
  birthdayEnabled: boolean
  referralEnabled: boolean
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const f = await api<Partial<FeatureFlags>>('/api/feature-flags', { token: null })
  return {
    smsEnabled: f.smsEnabled ?? true,
    whatsappEnabled: f.whatsappEnabled ?? true,
    loyaltyEnabled: f.loyaltyEnabled === true,
    birthdayEnabled: f.birthdayEnabled === true,
    referralEnabled: f.referralEnabled === true,
  }
}

// ── Dashboard ──

export interface DashboardData {
  stats: { total_orders: number; total_spent: number; active_orders: number }
  recentOrders: Array<{
    id: string
    order_number: string
    created_at: string
    status: string
    total_amount: number
    items: Array<{ product_name: string; quantity: number; thumbnail_url: string | null }>
  }>
  defaultAddress: {
    full_name: string
    address_line1: string
    address_line2?: string
    landmark?: string
    city: string
    state: string
    postal_code: string
    phone: string
  } | null
  wishlistCount: number
}

export const getDashboard = () => api<DashboardData>('/api/user/dashboard')

export async function getSearchHistory(): Promise<string[]> {
  const d = await api<{ history?: string[] }>('/api/user/search-history').catch(() => ({ history: [] as string[] }))
  return Array.isArray(d.history) ? d.history : []
}

export const clearSearchHistory = () => api('/api/user/search-history', { method: 'DELETE' }).catch(() => {})

export async function getBuyAgain(): Promise<CardProduct[]> {
  const d = await api<{ products?: CardProduct[] }>('/api/account/buy-again').catch(() => ({ products: [] }))
  return Array.isArray(d.products) ? d.products : []
}

export interface PopularProduct {
  id: string
  name: string
  slug: string
  base_price: number
  mrp: number | null
  variant_min_price: number | null
  has_variants: boolean
  product_images: Array<{ thumbnail_url: string; is_primary: boolean }>
}

export async function getPopularProducts(): Promise<PopularProduct[]> {
  const d = await api<{ products?: PopularProduct[] }>('/api/products?sort=popular&limit=4').catch(() => ({ products: [] }))
  return (d.products ?? []).slice(0, 4)
}

export const updateProfile = (payload: { firstName?: string; lastName?: string; phone?: string; dateOfBirth?: string; notificationChannel?: string }) =>
  api<{ user: Partial<AccountUser> }>('/api/user/update', { method: 'PATCH', body: JSON.stringify(payload) })

export const getMeFull = () => api<{ user: AccountUser | null }>('/api/auth/me').then(d => d.user)

// ── Phone verification / policies ──

/** POST helper that keeps the status and body on failure (cooldowns, flags). */
export async function postJson<T = any>(path: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const token = await getStoredToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export const phoneSendOtp = (phone: string) =>
  postJson<{ nextCooldown?: number; retryAfter?: number }>('/api/auth/phone/send-otp', { phone })
export const phoneVerifyOtp = (phone: string, otp: string) => postJson('/api/auth/phone/verify-otp', { phone, otp })
export const acceptPolicies = () => postJson('/api/user/accept-policies', {}).catch(() => null)
export const abandonSignup = () => postJson('/api/auth/abandon-signup', {}).catch(() => null)

// ── Orders ──

export interface ListOrderItem {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  buy_mode?: string
  buy_unit?: string | null
  products: { slug: string; extra_delivery_days?: number | null; product_images: Array<{ thumbnail_url: string; is_primary: boolean }> } | null
}

export interface ListOrder {
  id: string
  order_number: string
  created_at: string
  status: string
  payment_status: string
  total_amount: number
  subtotal: number
  awb_number: string | null
  estimated_delivery_date: string | null
  addresses: { address_line1: string; address_line2?: string; city: string; state: string; postal_code: string } | null
  order_items: ListOrderItem[]
}

export const listOrdersPage = (page: number) =>
  api<{ orders: ListOrder[]; total: number; page: number; pageSize: number }>(`/api/orders?page=${page}`)

export interface DetailItem {
  id: string
  productId: string
  productName: string
  productSku: string | null
  variantName: string | null
  subVariantName: string | null
  subVariantSku: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  buyMode?: string
  buyUnit?: string | null
  returnAllowed: boolean
  returnWindowDays: number
  replacementAllowed: boolean
  replacementWindowDays: number
  isDigital?: boolean
  accessGranted?: boolean
  accessRevoked?: boolean
  vaultUrl?: string | null
  products: {
    slug: string
    extra_delivery_days?: number | null
    fragile?: boolean | null
    hazardous?: boolean | null
    flammable?: boolean | null
    product_images: Array<{ thumbnail_url: string; image_url: string; is_primary: boolean }>
  } | null
}

export interface AddressLike {
  full_name: string
  address_line1: string
  address_line2?: string | null
  landmark?: string | null
  city: string
  state: string
  postal_code: string
  phone: string
}

export interface AddressChangeInfo {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  newAddress: AddressLike
  adminNotes: string | null
  createdAt: string
  reviewedAt: string | null
}

export interface SharedNote {
  id: string
  title?: string | null
  body?: string | null
  createdAt: string
  attachments?: Array<{ id: string; kind: string; url: string; thumbnailUrl?: string | null }>
}

export interface OrderDetails {
  id: string
  orderNumber: string
  invoiceNumber: string | null
  viewToken: string | null
  totalAmount: number
  subtotal: number
  taxAmount: number
  discountAmount: number
  shippingAmount: number
  codFeeAmount?: number
  status: string
  paymentStatus: string
  paymentMode?: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  notes: string | null
  trackingUrl: string | null
  awbNumber: string | null
  estimatedDeliveryDate: string | null
  courierEdd?: string | null
  originalOrderId: string | null
  originalOrderNumber: string | null
  orderType: string
  isAllDigital?: boolean
  hasDigital?: boolean
  vaultUrl?: string | null
  canChangeAddress?: boolean
  addressChange?: AddressChangeInfo | null
  shippingAddress: AddressLike | null
  items: DetailItem[]
  sharedNotes?: SharedNote[]
  pendingAdjustment?: {
    id: string
    status: string
    settlement_type: 'refund' | 'collect' | 'cod_adjust' | 'none'
    net_diff: string | number
    new_total: string | number
    lines: Array<{
      action: 'switch' | 'remove' | 'quantity'
      old: { name: string; quantity: number; unit: string | null }
      new: { productName: string; quantity: number; unit: string | null; total: number } | null
    }> | null
  } | null
  pendingVariantChange?: {
    id: string
    productName: string
    oldVariantName: string | null
    newVariantName: string | null
    oldUnitPrice: number
    newUnitPrice: number
    qty: number
    priceDiff: number
    settlementType: 'refund' | 'collect' | 'cod_adjust' | 'none'
    status: string
  } | null
}

export const getOrderDetails = (id: string) => api<{ order: OrderDetails }>(`/api/orders/${id}`).then(d => d.order)

export interface OrderReview {
  id: string
  product_id: string
  rating: number
  title: string | null
  comment: string
  tags: string[]
  image_urls: string[]
  image_thumbnail_urls: string[]
}

export async function getOrderReviews(orderId: string): Promise<Record<string, OrderReview>> {
  const d = await api<{ reviews?: OrderReview[] }>(`/api/reviews?orderId=${orderId}`).catch(() => ({ reviews: [] as OrderReview[] }))
  const map: Record<string, OrderReview> = {}
  for (const r of d.reviews ?? []) map[r.product_id] = r
  return map
}

export interface ReturnInfo {
  returnRequest: {
    id: string
    type: string
    status: string
    reason: string
    description?: string | null
    admin_notes?: string | null
    replacement_order_id?: string | null
    replacement_order_number?: string | null
    rvp_awb_number?: string | null
    items?: Array<{ id: string; product_name?: string | null; variant_name?: string | null; quantity: number; unit_price: number; refund_amount: number }> | null
  } | null
  monthlyLimitReached: boolean
  refundBreakdown: { grossRefund: number; charge: number; netRefund: number } | null
}

export async function getReturnInfo(orderId: string): Promise<ReturnInfo> {
  const d = await api<any>(`/api/orders/${orderId}/return`).catch(() => null)
  if (!d) return { returnRequest: null, monthlyLimitReached: false, refundBreakdown: null }
  return {
    returnRequest: d.returnRequest ? { ...d.returnRequest, items: d.returnItems || [] } : null,
    monthlyLimitReached: !!d.monthlyLimitReached,
    refundBreakdown: d.refundBreakdown ?? null,
  }
}

export const cancelOrderWith = (id: string, body: { restoreToCart?: boolean; autoCancelUnpaid?: boolean }) =>
  api(`/api/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) })

export const submitReturnRequest = (
  id: string,
  body: { type: 'refund' | 'replacement'; reason: string; description?: string; image_urls: string[]; items: Array<{ order_item_id: string; quantity: number }> }
) => api(`/api/orders/${id}/return`, { method: 'POST', body: JSON.stringify(body) })

export const confirmOrderChange = (path: string) =>
  api<{ settlement?: string; razorpayOrderId?: string; amount?: number; currency?: string; key_id?: string }>(path, { method: 'POST', body: '{}' })
export const rejectAdjustment = (orderId: string, adjId: string) =>
  api(`/api/orders/${orderId}/adjustments/${adjId}/reject`, { method: 'POST', body: '{}' })
export const rejectVariantChange = (orderId: string) =>
  api(`/api/orders/${orderId}/variant-change/reject`, { method: 'POST', body: '{}' })

export const requestAddressChange = (orderId: string, addressId: string) =>
  api(`/api/orders/${orderId}/address-change`, { method: 'POST', body: JSON.stringify({ addressId }) })
export const withdrawAddressChange = (orderId: string) => api(`/api/orders/${orderId}/address-change`, { method: 'DELETE' })

export interface TrackingScan {
  date: string | null
  location: string | null
  activity: string | null
  instructions: string | null
}

export interface TrackingData {
  awb: string
  status: string | null
  statusType: string | null
  shipmentStatus: string | null
  statusDateTime: string | null
  pickUpDate: string | null
  expectedDelivery: string | null
  origin: string | null
  destination: string | null
  scans: TrackingScan[]
  orderType?: string | null
  reverseInTransit?: boolean
}

export const getTracking = (orderId: string, trackPath = 'track') =>
  api<{ tracking?: TrackingData; error?: string }>(`/api/orders/${orderId}/${trackPath}`)

/** Multipart POST/PATCH (reviews): the shared api() always sends JSON. */
export async function postForm<T = any>(path: string, form: FormData, method = 'POST'): Promise<T> {
  const token = await getStoredToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`)
  return data as T
}

export const generateReview = (body: { productName: string; rating: number; tags: string[] }) =>
  postJson<{ review?: string }>('/api/reviews/generate', body)

// ── Transactions ──

export interface Transaction {
  id: string
  transactionId: string
  paymentMethod: string
  paymentGateway: string
  amount: number
  status: string
  createdAt: string
  updatedAt: string
  orderId: string
  orderNumber: string
}

export const listTransactions = (page: number) =>
  api<{ transactions: Transaction[]; total: number }>(`/api/transactions?page=${page}`)

// ── Referrals / rewards ──

export type ReferralStatus = 'joined' | 'rewarded' | 'reversed' | 'capped' | 'rejected'

export interface ReferralFriend {
  id: string
  name: string
  status: ReferralStatus
  hasOrdered: boolean
  points: number | null
  signedUpAt: string
  rewardedAt: string | null
}

export interface ReferralsData {
  enabled: boolean
  eligible?: boolean
  code: string
  program: { rewardPoints: number; yearlyCap: number; qualifyDays: number }
  counts: Record<ReferralStatus, number>
  pointsEarned: number
  rewardsLeftThisYear: number
  friends: { items: ReferralFriend[]; total: number; page: number; pageSize: number }
}

export const getReferrals = (page: number) => api<ReferralsData>(`/api/user/referrals?page=${page}`)

export async function referralLookup(): Promise<string | null> {
  const d = await api<{ firstName?: string }>('/api/referrals/lookup').catch(() => null)
  return typeof d?.firstName === 'string' && d.firstName ? d.firstName : null
}

export interface RewardsTier {
  key: string
  name: string
  minPoints: number
  multiplier: number
}

export interface RewardsHistoryEntry {
  id: string
  delta: number
  reason: string
  orderNumber: string | null
  couponCode: string | null
  createdAt: string
}

export interface RewardCoupon {
  code: string
  value: number
  minPurchase: number
  createdAt: string
  discountType?: 'fixed' | 'percentage'
  maxDiscount?: number | null
  validUntil?: string | null
  source?: 'loyalty' | 'game'
}

interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface RewardsData {
  enabled: boolean
  eligible?: boolean
  tier: { key: string; name: string; multiplier: number }
  nextTier: { key: string; name: string; minPoints: number; pointsToGo: number } | null
  points: number
  lifetimePoints: number
  pending: { points: number; nextCreditAt: string | null }
  history: Paged<RewardsHistoryEntry>
  coupons: Paged<RewardCoupon>
  program: { rupeesPerPoint: number; pointValue: number; minRedeemPoints: number; creditDelayDays: number; tiers: RewardsTier[] }
}

export const getLoyalty = (historyPage: number, couponPage: number) =>
  api<RewardsData>(`/api/user/loyalty?historyPage=${historyPage}&couponPage=${couponPage}`)

export const redeemPoints = (points: number) => postJson<{ code?: string }>('/api/user/loyalty/redeem', { points })

// ── Subscriptions ──

export interface SubscriptionItem {
  id: string
  status: string
  statusLabel: string
  productId: string
  productName: string
  productSlug: string
  imageUrl: string | null
  isDigital: boolean
  interval: string
  intervalLabel: string
  quantity: number
  amount: number
  currentCycle?: number
  totalCycles?: number | null
  minCycles?: number | null
  currentEnd: string | null
  nextChargeAt: string | null
  cancelAtCycleEnd: boolean
  accessExpiresAt: string | null
  address: { name: string; line1: string; city: string; state: string; pincode: string } | null
  orders: Array<{ id: string; orderNumber: string; status: string; total: number; createdAt: string; cycle: number }>
}

export async function getSubscriptions(): Promise<SubscriptionItem[]> {
  const d = await api<{ subscriptions?: SubscriptionItem[] }>('/api/user/subscriptions').catch(() => ({ subscriptions: [] }))
  return d.subscriptions ?? []
}

export const subscriptionAction = (id: string, action: 'cancel' | 'pause' | 'resume' | 'address', addressId?: string) =>
  api<{ subscription: SubscriptionItem }>(`/api/user/subscriptions/${id}`, {
    method: 'POST',
    body: JSON.stringify(addressId ? { action, addressId } : { action }),
  })

// ── Business quotes ──

export interface Rfq {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  item_count: number
  converted_quotation_id: string | null
  created_at: string
}

export const listRfqs = (page: number) => api<{ rfqs: Rfq[]; total: number }>(`/api/business/rfqs?page=${page}`)

// ── Account deletion ──

export interface DeletionBlocker {
  kind: string
  count: number
  message: string
}
export const checkAccountDeletion = () =>
  api<{ blockers: DeletionBlocker[]; retainedOrders: number }>('/api/account/delete')
export const deleteAccount = () =>
  postJson<{ deleted?: boolean; blockers?: DeletionBlocker[] }>('/api/account/delete', { confirm: 'DELETE' })
