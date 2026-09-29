// Flow and chapter definitions for the ecom demo. Kept separate from store.ts so the engine
// stays lean. Chapters are grouped into flows; auto-play cycles within the active flow.

export type FlowId = 'shop' | 'fulfil' | 'stock' | 'finance' | 'b2b' | 'grow'

export interface Flow {
  id: FlowId
  title: string
  blurb: string
}

export const FLOWS: Flow[] = [
  { id: 'shop',    title: 'Customer buys',        blurb: 'What a shopper sees, from catalogue to a paid order.' },
  { id: 'fulfil',  title: 'Store owner fulfils',  blurb: 'The order lands in your admin: confirm, ship and print the docs.' },
  { id: 'stock',   title: 'Inventory & catalogue', blurb: 'Track stock, reorder from suppliers and receive it in.' },
  { id: 'finance', title: 'Payments, GST & finance', blurb: 'Settlements, GST invoices and the numbers behind them.' },
  { id: 'b2b',     title: 'Returns & B2B',        blurb: 'Handle a return, quote a business buyer and close an RFQ.' },
  { id: 'grow',    title: 'Marketing & CRM',      blurb: 'Turn buyers into regulars with campaigns, coupons and insight.' },
]

export interface Chapter {
  id: string
  flow: FlowId
  title: string
  blurb: string
  surface: 'storefront' | 'admin'
  focus: string
}

export const CHAPTERS: Chapter[] = [
  // shop
  { id: 'browse',     flow: 'shop',    title: 'Browse the store',    blurb: 'A fast, clean catalogue your customers enjoy.', surface: 'storefront', focus: 'catalogue' },
  { id: 'product',    flow: 'shop',    title: 'Open a product',      blurb: 'Rich pages with ratings, offers and instant add-to-cart.', surface: 'storefront', focus: 'product' },
  { id: 'cart',       flow: 'shop',    title: 'Add to cart',         blurb: 'A friction-free cart that keeps shoppers moving.', surface: 'storefront', focus: 'cart' },
  { id: 'pay',        flow: 'shop',    title: 'Checkout and pay',    blurb: 'Online or COD, with a checkout buyers trust.', surface: 'storefront', focus: 'checkout' },
  // fulfil
  { id: 'dashboard',  flow: 'fulfil',  title: 'The order lands',     blurb: 'The sale shows on your dashboard the moment it is paid.', surface: 'admin', focus: 'dashboard' },
  { id: 'processing', flow: 'fulfil',  title: 'Confirm the order',   blurb: 'Confirm and prepare the order from one screen.', surface: 'admin', focus: 'order' },
  { id: 'ship',       flow: 'fulfil',  title: 'Ship and track',      blurb: 'Create a Delhivery shipment and watch it move.', surface: 'admin', focus: 'shipment' },
  { id: 'docs',       flow: 'fulfil',  title: 'Slip and label',      blurb: 'A GST packing slip and shipping label, generated for you.', surface: 'admin', focus: 'docs' },
  // stock
  { id: 'inventory',  flow: 'stock',   title: 'Watch your stock',    blurb: 'Live stock levels with low-stock and out-of-stock alerts.', surface: 'admin', focus: 'inventory' },
  { id: 'po',         flow: 'stock',   title: 'Reorder from a supplier', blurb: 'Raise a purchase order when stock runs low.', surface: 'admin', focus: 'po' },
  { id: 'grn',        flow: 'stock',   title: 'Receive the goods',   blurb: 'Receive against the PO and stock climbs back up.', surface: 'admin', focus: 'grn' },
  // finance
  { id: 'settlement', flow: 'finance', title: 'Money settles',       blurb: 'Every payment captured, then settled to your account.', surface: 'admin', focus: 'settlement' },
  { id: 'gstinvoice', flow: 'finance', title: 'GST invoice',         blurb: 'A compliant tax invoice with CGST and SGST, automatic.', surface: 'admin', focus: 'gstinvoice' },
  { id: 'reports',    flow: 'finance', title: 'The numbers',         blurb: 'Receivables, ageing and GST returns in one place.', surface: 'admin', focus: 'reports' },
  // b2b
  { id: 'return',     flow: 'b2b',     title: 'Handle a return',     blurb: 'Approve, receive and refund a return without the mess.', surface: 'admin', focus: 'return' },
  { id: 'quote',      flow: 'b2b',     title: 'Quote a buyer',       blurb: 'Build a GST quotation and send it in a click.', surface: 'admin', focus: 'quote' },
  { id: 'rfq',        flow: 'b2b',     title: 'Close a B2B deal',    blurb: 'Negotiate an RFQ and convert it to an order.', surface: 'admin', focus: 'rfq' },
  // grow
  { id: 'campaign',   flow: 'grow',    title: 'Launch a campaign',   blurb: 'Reach the right buyers with an email campaign.', surface: 'admin', focus: 'campaign' },
  { id: 'coupon',     flow: 'grow',    title: 'Create a coupon',     blurb: 'Spin up a code and watch redemptions roll in.', surface: 'admin', focus: 'coupon' },
  { id: 'crm',        flow: 'grow',    title: 'Know your customers', blurb: 'A built-in CRM: who buys, how often and what they love.', surface: 'admin', focus: 'crm' },
]

// Global indices grouped by flow, so auto-play and the chapter rail cycle within one flow.
export const FLOW_CHAPTERS: Record<FlowId, number[]> = FLOWS.reduce((acc, f) => {
  acc[f.id] = CHAPTERS.map((c, i) => (c.flow === f.id ? i : -1)).filter((i) => i >= 0)
  return acc
}, {} as Record<FlowId, number[]>)
