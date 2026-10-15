import { sendByTemplate } from '@/lib/shared/send-by-template'
import { orderUrlById } from '@/lib/shared/customer-links'
import type { AddressSnapshot } from '@/lib/orders/address-change'

function addressText(a: AddressSnapshot): string {
  return [
    a.full_name,
    a.address_line1,
    a.address_line2,
    a.landmark ? `Landmark: ${a.landmark}` : '',
    `${a.city}, ${a.state} ${a.postal_code}`,
    a.phone ? `Phone: ${a.phone}` : '',
  ].filter(Boolean).join(', ')
}

export async function sendAddressChangeDecisionEmail(params: {
  customerEmail: string
  customerName: string
  orderNumber: string
  orderId: string
  decision: 'approved' | 'rejected'
  newAddress: AddressSnapshot
  adminNotes?: string | null
}): Promise<{ success: boolean; error?: unknown }> {
  const orderUrl = await orderUrlById(params.orderId)
  const slug = params.decision === 'approved' ? 'order/address-change-approved' : 'order/address-change-rejected'
  const res = await sendByTemplate({
    channel: 'email',
    slug,
    to: params.customerEmail,
    variables: {
      customer_name: params.customerName || 'there',
      order_number: params.orderNumber,
      order_url: orderUrl,
      address_block: addressText(params.newAddress),
      reason: params.decision === 'rejected' && params.adminNotes ? `Reason: ${params.adminNotes}.` : '',
    },
    reference: params.orderId,
  })
  return res.status === 'failed' ? { success: false, error: res.error } : { success: true }
}
