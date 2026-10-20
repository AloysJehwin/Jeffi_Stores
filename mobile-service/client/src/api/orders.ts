import { api } from './client'
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

export async function listOrders(page = 1): Promise<OrdersResponse> {
  return api(`/api/orders?page=${page}`)
}

export async function getOrder(id: string): Promise<Order> {
  const data = await api<{ order: Order }>(`/api/orders/${id}`)
  return data.order
}

export async function createOrder(payload: {
  shippingAddress: {
    fullName: string
    addressLine1: string
    addressLine2?: string
    landmark?: string
    city: string
    state: string
    postalCode: string
    country: string
    phone: string
  }
  payment_method: 'razorpay' | 'manual'
  notes?: string
}): Promise<CreatedOrder> {
  const data = await api<{ order: CreatedOrder }>('/api/orders/create', {
    method: 'POST',
    body: JSON.stringify({
      shippingAddress: payload.shippingAddress,
      paymentMethod: payload.payment_method,
      notes: payload.notes,
    }),
  })
  return data.order
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
