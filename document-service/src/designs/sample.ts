import type { RenderDocumentRequest, DocumentType } from '@jeffi/api-contracts'

// Sample payloads for design previews / thumbnails.
const seller = { name: 'Nova Retail Pvt Ltd', address: '14, 2nd Cross, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038', gstin: '29ABCDE1234F1Z5', phone: '+91 98450 12345', email: 'accounts@novaretail.in' }
const buyer = { name: 'Priya Sharma', address: 'Flat 302, Lake View Apartments', city: 'Chennai', state: 'Tamil Nadu', pincode: '600042', phone: '+91 94442 49012', email: 'priya@example.com' }
const items = [
  { description: 'Stainless steel hex bolt M12 × 60 (pack of 50)', hsn: '7318', quantity: 4, unit: 'pack', unit_price: 849, gst_rate: 18 },
  { description: 'Cordless drill driver 18V with 2 batteries', hsn: '8467', quantity: 1, unit: 'pc', unit_price: 6499, gst_rate: 18 },
  { description: 'Safety gloves, cut resistant (pair)', hsn: '6116', quantity: 10, unit: 'pair', unit_price: 189, gst_rate: 12 },
  { description: 'Measuring tape 5 m', hsn: '9017', quantity: 2, unit: 'pc', unit_price: 299, gst_rate: 18 },
]

export function sampleRequest(type: DocumentType): RenderDocumentRequest {
  return {
    template: 'aurora', seller, buyer, items: items.map(i => ({ ...i, discount: 0 })), prices_include_gst: true, currency: 'INR',
    ship_to: type === 'label' || type === 'packing_slip' ? { ...buyer, name: 'Priya Sharma (Site office)' } : undefined,
    date: '2026-10-14', due_date: type === 'invoice' || type === 'quotation' || type === 'purchase_order' ? '2026-10-28' : undefined,
    reference: 'ORD-48213',
    notes: type === 'label' ? undefined : 'Thank you for your business. Goods once sold can be exchanged within 7 days with the invoice.',
    terms: type === 'invoice' || type === 'quotation' || type === 'purchase_order' ? 'Payment due within 14 days. Interest at 18% p.a. on overdue amounts. Subject to Bengaluru jurisdiction.' : undefined,
  } as RenderDocumentRequest
}
