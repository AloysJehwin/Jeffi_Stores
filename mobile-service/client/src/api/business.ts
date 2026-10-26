import { api } from './client'
import { postJson, type AccountUser } from './account'

// The business portal's API (controller-service app/api/(public)/business/*). A business account is a separate
// login from a customer one; its session rides as the bearer with X-Auth-Portal: business (see client.ts).

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface BusinessSignInResult {
  approvalStatus?: ApprovalStatus
  notBusinessAccount?: boolean
  newUser?: boolean
  profile?: { email: string; firstName: string; lastName: string }
  user?: AccountUser
  token?: string
  error?: string
}

export const businessLogin = (body: { email: string; otp: string; policiesAccepted?: boolean }) =>
  postJson<BusinessSignInResult>('/api/business/login', body)

export const businessGoogle = (idToken: string) => postJson<BusinessSignInResult>('/api/business/google', { idToken })

export interface BusinessDetails {
  firstName: string
  lastName?: string
  phone: string
  dateOfBirth: string
  companyName: string
  gstNumber: string
  businessAddress: string
  industry: string
}

export const businessSignup = (body: BusinessDetails & { email: string }) =>
  postJson<BusinessSignInResult>('/api/business/signup', body)

export const businessGoogleComplete = (body: BusinessDetails & { idToken: string }) =>
  postJson<BusinessSignInResult>('/api/business/google/complete', body)

/** The business discount the server will apply: the whole cart, or one buy-now line. */
export const businessDiscountPreview = (
  body:
    | { mode: 'cart' }
    | { mode: 'buyNow'; productId: string; variantId?: string | null; subVariantId?: string | null; qty: number; price: number }
) => api<{ businessDiscountAmount: number }>('/api/business/discount-preview', { method: 'POST', body: JSON.stringify(body) })

// ── Quotes (RFQs) ──

export type RfqStatus = 'pending' | 'reviewed' | 'negotiating' | 'offer_accepted' | 'converted' | 'rejected'

export interface Rfq {
  id: string
  rfq_number: string
  status: RfqStatus
  notes: string | null
  item_count: number
  requested_total: string | null
  converted_quotation_id: string | null
  quote_number: string | null
  quotation_view_token: string | null
  quotation_total: string | null
  order_id: string | null
  invoice_view_token: string | null
  invoice_number: string | null
  payment_status: string | null
  order_status: string | null
  invoice_total: string | null
  created_at: string
}

export interface RfqItem {
  id: string
  description: string
  quantity: number
  unit: string
  requested_price: string | null
  notes: string | null
  product_id: string | null
  variant_id: string | null
  product_slug: string | null
  category_id: string | null
  catalog_price: string | null
  catalog_mrp?: string | null
  variant_price: string | null
  variant_mrp?: string | null
  variant_sku?: string | null
  unit_factor?: number | string | null
  image_url: string | null
  quoted_rate: string | null
  quoted_discount_pct: string | null
  quoted_gst_rate: string | null
}

export interface RfqOrder {
  id: string
  order_number: string
  payment_status: string
  payment_mode: string | null
  razorpay_qr_image_url: string | null
  total_amount: string
  invoice_number: string | null
  status: string
  view_token: string | null
}

export interface RfqDetail {
  rfq: {
    id: string
    rfq_number: string
    status: RfqStatus
    notes: string | null
    admin_note: string | null
    created_at: string
    converted_quotation_id: string | null
    quotation_view_token: string | null
    quote_number: string | null
    converted_order_id: string | null
  }
  items: RfqItem[]
  order: RfqOrder | null
  discountMap: Record<string, number>
}

export interface CounterItem {
  rfq_item_id: string
  offered_price: number
}

export interface RfqMessage {
  id: string
  sender: 'admin' | 'customer'
  message: string
  counter_items: CounterItem[] | null
  created_at: string
}

export interface NewRfqItem {
  productId?: string
  variantId?: string
  subVariantId?: string
  description: string
  quantity: number
  unit: string
  requested_price?: number | null
  notes?: string
}

export const listRfqs = (page: number) =>
  api<{ rfqs: Rfq[]; total: number; page: number; pageSize: number }>(`/api/business/rfqs?page=${page}`)

export const getRfq = (id: string) => api<RfqDetail>(`/api/business/rfqs/${id}`)

export const createRfq = (body: { notes?: string; items: NewRfqItem[] }) =>
  api<{ rfq: { id: string; rfq_number: string } }>('/api/business/rfqs', { method: 'POST', body: JSON.stringify(body) })

export const updateRfq = (id: string, body: { notes?: string; items?: { id: string; quantity?: number; requested_price?: number | null; notes?: string | null }[] }) =>
  api(`/api/business/rfqs/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getRfqMessages = (id: string) => api<{ messages: RfqMessage[] }>(`/api/business/rfqs/${id}/messages`).then(d => d.messages)

export const sendRfqMessage = (id: string, body: { message: string; counter_items?: CounterItem[] }) =>
  api<{ message: RfqMessage }>(`/api/business/rfqs/${id}/messages`, { method: 'POST', body: JSON.stringify(body) })

export const respondToOffer = (id: string, body: { action: 'accept' | 'decline'; message?: string; counter_items?: CounterItem[] }) =>
  api<{ ok: boolean; newStatus: RfqStatus }>(`/api/business/rfqs/${id}/respond`, { method: 'POST', body: JSON.stringify(body) })

export const resubmitRfq = (id: string, notes?: string) =>
  api<{ rfq: { id: string; rfq_number: string } }>(`/api/business/rfqs/${id}/resubmit`, { method: 'POST', body: JSON.stringify({ notes }) })

// ── Signed-in devices ──

export interface BusinessSession {
  id: string
  created_at: string
  last_seen_at: string
  user_agent: string | null
  ip_address: string | null
  ua_platform: string | null
  current?: boolean
}

export const listBusinessSessions = () => api<{ sessions: BusinessSession[] }>('/api/business/sessions').then(d => d.sessions)
export const revokeBusinessSession = (id: string) => api(`/api/business/sessions/${id}/revoke`, { method: 'POST' })
export const revokeAllBusinessSessions = () => api('/api/business/sessions/revoke-all', { method: 'POST' })
