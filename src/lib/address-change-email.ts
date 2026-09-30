import { sendAuditedMail } from '@/lib/mail-audit'
import { customerMailFromAsync, currentBrandNameAsync, storeBaseUrlAsync } from '@/lib/brand'
import { mailShell } from '@/lib/mail-template'
import type { AddressSnapshot } from '@/lib/address-change'

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function addressBlock(a: AddressSnapshot): string {
  const lines = [
    `<strong>${esc(a.full_name)}</strong>`,
    esc(a.address_line1),
    a.address_line2 ? esc(a.address_line2) : '',
    a.landmark ? `Landmark: ${esc(a.landmark)}` : '',
    `${esc(a.city)}, ${esc(a.state)} ${esc(a.postal_code)}`,
    a.phone ? `Phone: ${esc(a.phone)}` : '',
  ].filter(Boolean)
  return lines.map(l => `<p style="margin:0 0 4px;">${l}</p>`).join('')
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
  const approved = params.decision === 'approved'
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const orderUrl = `${await storeBaseUrlAsync()}/account/orders/${params.orderId}`
  const subject = approved
    ? `Delivery address updated for order ${params.orderNumber}`
    : `Address change declined for order ${params.orderNumber}`
  const intro = approved
    ? `Your request to change the delivery address for order <strong>${esc(params.orderNumber)}</strong> has been approved. Your order will now be delivered to:`
    : `We could not approve your request to change the delivery address for order <strong>${esc(params.orderNumber)}</strong> to:`
  const outro = approved
    ? ''
    : `<p>${params.adminNotes ? `Reason: ${esc(params.adminNotes)}` : ''}</p><p>Your order will be delivered to the original address.</p>`

  const html = mailShell({
    brand,
    kicker: 'Order Update',
    title: approved ? 'Delivery address updated' : 'Address change declined',
    content: `
      <p>Hi ${esc(params.customerName) || 'there'},</p>
      <p>${intro}</p>
      <div class="card">${addressBlock(params.newAddress)}</div>
      ${outro}
      <div class="cta"><a href="${orderUrl}" class="button" style="color:#ffffff;">View Order</a></div>`,
  })

  try {
    await sendAuditedMail({
      from,
      to: params.customerEmail,
      subject,
      html,
      kind: `address_change_${params.decision}`,
      templateName: `address_change_${params.decision}`,
      entityType: 'orders',
      entityId: params.orderId,
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}
