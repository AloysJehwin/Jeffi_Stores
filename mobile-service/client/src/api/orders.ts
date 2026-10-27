import { api, APP_USER_AGENT, authHeaders, BASE_URL } from './client'
import type { Order, ReturnRequest } from '../types'

interface OrdersResponse {
  orders: Order[]
  total: number
  page: number
  pageSize: number
}

interface CreatedOrder {
  id: string
  orderNumber: string
  total: number
  status: string
}

interface ShippingAddressBody {
  fullName: string
  addressLine1: string
  addressLine2?: string | null
  landmark?: string | null
  city: string
  state: string
  postalCode: string
  country: string
  phone: string
}

/** Status-aware POST: checkout needs the 409 body (existingOrderId) that api() would throw away. */
export interface PostResult<T> {
  ok: boolean
  status: number
  data: Partial<T> & { error?: string; existingOrderId?: string; existingOrderNumber?: string }
}

async function post<T>(path: string, body: unknown): Promise<PostResult<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': APP_USER_AGENT, ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function listOrders(page = 1): Promise<OrdersResponse> {
  return api(`/api/orders?page=${page}`)
}

export async function getOrder(id: string): Promise<Order> {
  const data = await api<{ order: Order }>(`/api/orders/${id}`)
  return data.order
}

export async function createOrder(payload: {
  shippingAddress: ShippingAddressBody
  payment_method: 'razorpay' | 'cod' | 'manual'
  notes?: string
  couponId?: string | null
  discountAmount?: number
  shippingAmount?: number
  codFeeAmount?: number
}): Promise<CreatedOrder> {
  const data = await api<{ order: CreatedOrder }>('/api/orders/create', {
    method: 'POST',
    body: JSON.stringify({
      shippingAddress: payload.shippingAddress,
      paymentMethod: payload.payment_method,
      notes: payload.notes,
      couponId: payload.couponId ?? null,
      discountAmount: payload.discountAmount ?? 0,
      shippingAmount: payload.shippingAmount ?? 0,
      codFeeAmount: payload.codFeeAmount ?? 0,
    }),
  })
  return data.order
}

/** COD placement: /api/orders/create for the cart, /api/orders/create-direct for a Buy Now intent. */
export function placeUnpaidOrder(
  mode: 'cart' | 'buyNow',
  body: {
    shippingAddress: ShippingAddressBody
    notes: string
    paymentMethod: 'cod' | 'manual'
    couponId: string | null
    discountAmount: number
    shippingAmount: number
    codFeeAmount: number
    intent?: string | null
  }
): Promise<PostResult<{ order: CreatedOrder }>> {
  return post(mode === 'buyNow' ? '/api/orders/create-direct' : '/api/orders/create', body)
}

/** Razorpay checkout draft: the order is only committed once the payment verifies. */
export function createOrderDraft(body: {
  mode: 'cart' | 'buyNow'
  addressId: string
  notes: string
  couponId: string | null
  intent?: string | null
}): Promise<PostResult<{ draftToken: string; total: number }>> {
  return post('/api/orders/draft', body)
}

export async function reportPaymentFailed(orderId: string, errorDescription: string): Promise<void> {
  await post(`/api/orders/${orderId}/payment-failed`, { errorDescription })
}

export async function cancelOrder(id: string): Promise<void> {
  await api(`/api/orders/${id}/cancel`, { method: 'POST' })
}

export async function requestReturn(
  id: string,
  payload: { type: 'refund' | 'replacement'; reason: string; description?: string }
): Promise<ReturnRequest> {
  const data = await api<{ returnRequest: ReturnRequest }>(`/api/orders/${id}/return`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.returnRequest
}

export async function getReturnRequest(id: string): Promise<ReturnRequest | null> {
  const data = await api<{ returnRequest: ReturnRequest | null }>(`/api/orders/${id}/return`)
  return data.returnRequest
}
