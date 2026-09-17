import { sendAuditedMail } from '@/lib/mail-audit'
import { customerMailFromAsync, storeBaseUrlAsync } from '@/lib/brand'
import type { AddressSnapshot } from '@/lib/address-change'

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:24px;color:#111827;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;color:#fff;padding:20px 24px;"><h2 style="margin:0;font-size:18px;">${approved ? 'Delivery address updated' : 'Address change declined'}</h2></div>
      <div style="padding:24px;">
        <p style="margin-top:0;">Hi ${esc(params.customerName) || 'there'},</p>
        <p>${intro}</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">${addressBlock(params.newAddress)}</div>
        ${outro}
        <p style="text-align:center;margin:24px 0 8px;">
          <a href="${orderUrl}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:6px;font-weight:bold;text-decoration:none;">View Order</a>
        </p>
      </div>
    </div></body></html>`

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
