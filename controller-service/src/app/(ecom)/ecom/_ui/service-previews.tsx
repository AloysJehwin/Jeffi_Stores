import { ExternalLink, FileText, Mail, MessageCircle, MessageSquare } from 'lucide-react'

// Static, illustrative previews of what the Messaging and Documents APIs produce (landing page + console).

export const MESSAGING_POINTS = [
  'WhatsApp, SMS and email from one POST /v1/messages call',
  'Approved WhatsApp templates with an image header and a link button',
  'Any image link or upload, converted and hosted for you',
  'Bulk sends from a CSV, a delivery log and per-send billing from your wallet',
]
export const DOCUMENT_POINTS = [
  'Invoices, quotations, receipts, packing slips, labels and purchase orders',
  'GST worked out per line (CGST/SGST or IGST), discounts, charges and round-off',
  'Ten designs with your logo, colour and font; a PDF plus a shareable link',
  'Bulk rendering from a CSV, downloaded as one ZIP',
]

export const CHANNEL_ICON = { whatsapp: MessageCircle, sms: MessageSquare, email: Mail } as const

/** A WhatsApp order update: image header, body and a link button. */
export function WhatsAppPreview({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-[1.5rem] bg-[#e7ddd3] p-3 ${className}`} aria-hidden>
      <div className="max-w-[17rem] rounded-2xl rounded-tl-sm bg-white p-1.5 shadow-sm">
        <div className="relative h-28 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#c46a46,#e9b48c_55%,#f4e3cf)]">
          <div className="absolute bottom-2 left-2 rounded-md bg-white/85 px-2 py-0.5 text-[10px] font-bold text-[#1b1714]">Cordless drill 18V</div>
        </div>
        <div className="px-2 pb-1 pt-2 text-[12.5px] leading-snug text-[#1b1714]">
          <p>Hi Priya, your order <b>#48213</b> is out for delivery and arrives today by 7 pm.</p>
          <p className="mt-1 text-right text-[10px] text-[#8a8178]">10:42</p>
        </div>
        <div className="flex items-center justify-center gap-1.5 border-t border-[#efe7de] py-2 text-[12.5px] font-semibold text-[#2a7ab0]">
          <ExternalLink className="h-3.5 w-3.5" /> Track order
        </div>
      </div>
    </div>
  )
}

/** A miniature tax invoice. */
export function InvoicePreview({ className = '' }: { className?: string }) {
  const rows: [string, string, string][] = [['Cordless drill 18V', '1', '5,507.63'], ['Drill bit set', '2', '760.17'], ['Safety gloves', '10', '1,687.50']]
  return (
    <div className={`rounded-2xl bg-white p-4 text-[#1b1714] shadow-sm ${className}`} aria-hidden>
      <div className="-mx-4 -mt-4 mb-3 flex items-end justify-between rounded-t-2xl bg-[#1b1714] px-4 py-3 text-[#fffdf7]">
        <div><div className="text-[9px] uppercase tracking-[0.18em] opacity-70">Nova Retail</div><div className="font-display text-base font-black">Tax Invoice</div></div>
        <div className="text-right text-[10px] leading-tight opacity-80">INV/2026/0148<br />14 Oct 2026</div>
      </div>
      <div className="grid grid-cols-[1fr_2rem_4.5rem] gap-x-2 border-b border-[#eadfce] pb-1 text-[9px] font-bold uppercase tracking-wider text-[#8a8178]">
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Amount</span>
      </div>
      {rows.map(([d, q, a]) => (
        <div key={d} className="grid grid-cols-[1fr_2rem_4.5rem] gap-x-2 border-b border-[#f3ece2] py-1 text-[11px]">
          <span className="truncate">{d}</span><span className="text-right">{q}</span><span className="text-right tabular-nums">₹{a}</span>
        </div>
      ))}
      <div className="ml-auto mt-2 w-40 space-y-0.5 text-[10.5px]">
        <div className="flex justify-between text-[#8a8178]"><span>Festive offer (5%)</span><span>−₹397.76</span></div>
        <div className="flex justify-between text-[#8a8178]"><span>CGST + SGST</span><span>₹1,214.18</span></div>
        <div className="flex justify-between border-t border-[#1b1714] pt-1 text-[12px] font-bold"><span>Total</span><span>₹8,771.72</span></div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#8a8178]"><FileText className="h-3 w-3" /> PDF + shareable link</div>
    </div>
  )
}

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
