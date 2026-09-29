'use client'

import { type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Boxes,
  ClipboardList,
  PackageCheck,
  Wallet,
  ReceiptText,
  LineChart,
  RotateCcw,
  FileSpreadsheet,
  Handshake,
} from 'lucide-react'
import { useDemo, type World } from './store'
import {
  STOCK_ROWS,
  SUPPLIER,
  PURCHASE_ORDER,
  SETTLEMENT,
  INVOICE,
  RECEIVABLES,
  RETURN_REQUEST,
  QUOTE,
  RFQ,
} from './data'

const PANEL = 'bg-surface-elevated rounded-xl border border-border-default'
const BTN =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white ecom-accent-bg disabled:opacity-40 disabled:cursor-not-allowed'
export const rupees = (n: number) => 'Rs. ' + Math.round(n).toLocaleString('en-IN')

const STOCK_TONE: Record<string, string> = {
  'In Stock': 'bg-green-100 text-green-800',
  'Low Stock': 'bg-yellow-100 text-yellow-800',
  'Out of Stock': 'bg-red-100 text-red-800',
}
const AGE_TONE: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  partial: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-800',
}
const STAGE_TONE: Record<string, string> = {
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  received: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  negotiating: 'bg-yellow-100 text-yellow-800',
  offer_accepted: 'bg-blue-100 text-blue-800',
  converted: 'bg-green-100 text-green-800',
  draft: 'bg-yellow-100 text-yellow-800',
  final: 'bg-green-100 text-green-800',
  sent: 'bg-blue-100 text-blue-800',
}

function Chip({ label, tone }: { label: string; tone: string }) {
  return <span className={clsx('px-2 py-0.5 text-xs font-semibold rounded-full', tone)}>{label}</span>
}
function Head({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <span className="ecom-accent-text">{icon}</span>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      {right}
    </div>
  )
}
export function Kv({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="bg-surface-secondary rounded-lg border border-border-default p-3">
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className={clsx('text-sm text-foreground mt-0.5', strong ? 'font-bold tracking-wide' : 'font-medium')}>{value}</p>
    </div>
  )
}
function Note() {
  return <p className="text-[11px] text-foreground-muted mt-3 shrink-0">Demo only. Dummy data, no live network.</p>
}

export type Col = { head: string; align?: 'left' | 'center' | 'right'; cell: (row: Record<string, unknown>) => ReactNode }
const AL: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }
export function DataTable({ cols, rows, keyOf }: { cols: Col[]; rows: Record<string, unknown>[]; keyOf: (r: Record<string, unknown>) => string }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-foreground-secondary uppercase tracking-wider border-b border-border-default">
            {cols.map((c) => (
              <th key={c.head} className={clsx('font-semibold py-1.5', AL[c.align ?? 'left'])}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {rows.map((r) => (
            <tr key={keyOf(r)}>
              {cols.map((c) => (
                <td key={c.head} className={clsx('py-2', AL[c.align ?? 'left'])}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function Steps({ steps, idx }: { steps: string[]; idx: number }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2 text-sm">
          <span className={clsx('w-2 h-2 rounded-full', i <= idx ? 'ecom-accent-bg' : 'bg-surface-secondary border border-border-default')} />
          <span className={i <= idx ? 'text-foreground font-medium' : 'text-foreground-muted'}>{s.replace('_', ' ')}</span>
        </li>
      ))}
    </ol>
  )
}

export function InventoryView() {
  const value = STOCK_ROWS.reduce((s, r) => s + r.onHand, 0)
  const low = STOCK_ROWS.filter((r) => r.status !== 'In Stock').length
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head icon={<Boxes className="w-4 h-4" />} title="Inventory" right={<Chip label={`${low} need attention`} tone="bg-yellow-100 text-yellow-800" />} />
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.id as string}
          rows={STOCK_ROWS as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'SKU', cell: (r) => <span className="font-mono text-xs text-foreground-secondary">{r.sku as string}</span> },
            { head: 'Product', cell: (r) => <span className="text-foreground">{r.name as string}</span> },
            { head: 'On hand', align: 'center', cell: (r) => <span className="text-foreground tabular-nums">{r.onHand as number}</span> },
            { head: 'Reorder', align: 'center', cell: (r) => <span className="text-foreground-muted tabular-nums">{r.threshold as number}</span> },
            { head: 'Status', align: 'right', cell: (r) => <Chip label={r.status as string} tone={STOCK_TONE[r.status as string]} /> },
          ]}
        />
      </div>
      <div className="mt-2 flex justify-between text-sm font-semibold text-foreground border-t border-border-default pt-2 shrink-0">
        <span>Units on hand</span>
        <span className="tabular-nums">{value.toLocaleString('en-IN')}</span>
      </div>
    </div>
  )
}

export function PoView() {
  const { world, actions } = useDemo()
  const raised = world.poRaised
  const po = PURCHASE_ORDER
  const total = po.lines.reduce((s, l) => s + l.ordered * l.rate, 0)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<ClipboardList className="w-4 h-4" />}
        title={`Purchase order ${po.poNumber}`}
        right={<Chip label={raised ? 'sent' : 'draft'} tone={raised ? STAGE_TONE.sent : STAGE_TONE.draft} />}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 shrink-0">
        <Kv label="Supplier" value={SUPPLIER.name} strong />
        <Kv label="GSTIN" value={SUPPLIER.gstin} />
        <Kv label="Terms" value={`${SUPPLIER.terms} days`} />
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.name as string}
          rows={po.lines as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Item', cell: (r) => <span className="text-foreground">{r.name as string}</span> },
            { head: 'Qty', align: 'center', cell: (r) => <span className="text-foreground-secondary tabular-nums">{r.ordered as number}</span> },
            { head: 'Rate', align: 'right', cell: (r) => <span className="text-foreground-secondary tabular-nums">{rupees(r.rate as number)}</span> },
            { head: 'Amount', align: 'right', cell: (r) => <span className="text-foreground tabular-nums">{rupees((r.ordered as number) * (r.rate as number))}</span> },
          ]}
        />
      </div>
      <div className="mt-2 flex justify-between text-sm font-semibold text-foreground border-t border-border-default pt-2 shrink-0">
        <span>Expected {po.expected}</span>
        <span className="tabular-nums">{rupees(total)}</span>
      </div>
      {!raised ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.raisePo}>
          <ClipboardList className="w-4 h-4" /> Raise PO
        </button>
      ) : (
        <Note />
      )}
    </div>
  )
}

export function GrnView() {
  const { world, actions } = useDemo()
  const received = world.goodsReceived
  const po = PURCHASE_ORDER
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<PackageCheck className="w-4 h-4" />}
        title={`Goods receipt · ${po.poNumber}`}
        right={<Chip label={received ? 'received' : 'sent'} tone={received ? STAGE_TONE.completed : STAGE_TONE.sent} />}
      />
      <p className="text-xs text-foreground-muted mt-1 shrink-0">From {SUPPLIER.name}</p>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.name as string}
          rows={po.lines as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Item', cell: (r) => <span className="text-foreground">{r.name as string}</span> },
            { head: 'Ordered', align: 'center', cell: (r) => <span className="text-foreground-secondary tabular-nums">{r.ordered as number}</span> },
            { head: 'Received', align: 'center', cell: (r) => <span className="tabular-nums font-semibold text-foreground">{received ? (r.ordered as number) : 0}</span> },
          ]}
        />
      </div>
      {received ? (
        <p className="text-sm text-green-700 font-medium mt-2 shrink-0">Stock restored and back on shelf.</p>
      ) : (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.receiveGoods}>
          <PackageCheck className="w-4 h-4" /> Receive goods
        </button>
      )}
    </div>
  )
}

export function SettlementView() {
  const { world, actions } = useDemo()
  const s = SETTLEMENT
  const settled = world.settled
  const rows = [
    { label: 'Gross captured', value: s.gross, tone: 'text-foreground' },
    { label: `Platform commission (~5%)`, value: -s.commission, tone: 'text-foreground-secondary' },
    { label: `${s.gateway} gateway fee`, value: -s.gatewayFee, tone: 'text-foreground-secondary' },
  ]
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<Wallet className="w-4 h-4" />}
        title="Settlement"
        right={<Chip label={settled ? 'settled' : 'captured'} tone={settled ? STAGE_TONE.completed : STAGE_TONE.sent} />}
      />
      <div className="grid grid-cols-2 gap-3 mt-3 shrink-0">
        <Kv label="Gateway" value={s.gateway} strong />
        <Kv label="Mode" value={s.isCod ? 'COD' : 'Prepaid'} />
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between">
            <span className="text-foreground-secondary">{r.label}</span>
            <span className={clsx('tabular-nums', r.tone)}>{rupees(r.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-sm font-bold text-foreground border-t border-border-default pt-2 shrink-0">
        <span>Your share</span>
        <span className="tabular-nums">{rupees(s.tenantShare)}</span>
      </div>
      {!settled ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.settle}>
          <Wallet className="w-4 h-4" /> Settle
        </button>
      ) : (
        <p className="text-sm text-green-700 font-medium mt-3 shrink-0">Settled to your bank account.</p>
      )}
    </div>
  )
}

export function GstInvoiceView() {
  const { world, actions } = useDemo()
  const inv = INVOICE
  if (!world.invoiceReady) {
    return (
      <div className={clsx(PANEL, 'h-full p-6 flex flex-col items-center justify-center text-center gap-3')}>
        <ReceiptText className="w-8 h-8 ecom-accent-text" />
        <p className="text-sm text-foreground-secondary max-w-xs">
          Generate a GST tax invoice {inv.number} with CGST and SGST split, automatically.
        </p>
        <button className={BTN} onClick={actions.generateInvoice}>
          <ReceiptText className="w-4 h-4" /> Generate invoice
        </button>
      </div>
    )
  }
  const rows = [
    { label: 'Taxable value', value: inv.taxable },
    { label: 'CGST (9%)', value: inv.cgst },
    { label: 'SGST (9%)', value: inv.sgst },
  ]
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <p className="text-xs text-foreground-muted uppercase tracking-wider">Tax invoice</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">{inv.number}</p>
        </div>
        <ReceiptText className="w-5 h-5 ecom-accent-text" />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3 text-xs shrink-0">
        <div>
          <p className="text-foreground-muted">Buyer</p>
          <p className="text-foreground font-medium mt-0.5">{inv.buyer}</p>
          <p className="text-foreground-muted">GSTIN {inv.buyerGstin}</p>
        </div>
        <div>
          <p className="text-foreground-muted">HSN / date</p>
          <p className="text-foreground font-medium mt-0.5">{inv.hsn}</p>
          <p className="text-foreground-muted">{inv.date}</p>
        </div>
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between">
            <span className="text-foreground-secondary">{r.label}</span>
            <span className="tabular-nums text-foreground">{rupees(r.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-sm font-bold text-foreground border-t border-border-default pt-2 shrink-0">
        <span>Invoice total</span>
        <span className="tabular-nums">{rupees(inv.total)}</span>
      </div>
    </div>
  )
}

export function ReportsView() {
  const b2b = RECEIVABLES.filter((r) => r.customer !== INVOICE.buyer)
  const b2bTotal = b2b.reduce((s, r) => s + r.amount, 0)
  const b2cTotal = RECEIVABLES.filter((r) => r.customer === INVOICE.buyer).reduce((s, r) => s + r.amount, 0)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head icon={<LineChart className="w-4 h-4" />} title="Receivables & GSTR-1" />
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.id as string}
          rows={RECEIVABLES as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Invoice', cell: (r) => <span className="font-mono text-xs text-foreground-secondary">{r.invoice as string}</span> },
            { head: 'Customer', cell: (r) => <span className="text-foreground">{r.customer as string}</span> },
            { head: 'Amount', align: 'right', cell: (r) => <span className="text-foreground tabular-nums">{rupees(r.amount as number)}</span> },
            { head: 'Ageing', align: 'right', cell: (r) => <Chip label={r.badge as string} tone={AGE_TONE[r.badge as string] ?? AGE_TONE.partial} /> },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-2 shrink-0">
        <Kv label="GSTR-1 B2B" value={rupees(b2bTotal)} strong />
        <Kv label="GSTR-1 B2C" value={rupees(b2cTotal)} strong />
      </div>
    </div>
  )
}

export function ReturnView() {
  const { world, actions } = useDemo()
  const rr = RETURN_REQUEST
  const stage = world.returnStage
  const done = stage === 'completed'
  const steps: World['returnStage'][] = ['pending_approval', 'approved', 'received', 'completed']
  const idx = steps.indexOf(stage)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<RotateCcw className="w-4 h-4" />}
        title={`Return · Order #${rr.order}`}
        right={<Chip label={stage.replace('_', ' ')} tone={STAGE_TONE[stage]} />}
      />
      <div className="grid grid-cols-2 gap-3 mt-3 shrink-0">
        <Kv label="Customer" value={rr.customer} strong />
        <Kv label="Type" value={rr.type} />
        <Kv label="Item" value={rr.item} />
        <Kv label="Refund" value={rupees(rr.amount)} />
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden">
        <p className="text-xs text-foreground-muted mb-2">Reason: {rr.reason}</p>
        <Steps steps={steps} idx={idx} />
      </div>
      {!done ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.advanceReturn}>
          <RotateCcw className="w-4 h-4" /> Advance return
        </button>
      ) : (
        <p className="text-sm text-green-700 font-medium mt-3 shrink-0">Return completed and refunded.</p>
      )}
    </div>
  )
}

export function QuoteView() {
  const { world, actions } = useDemo()
  const q = QUOTE
  const final = world.quoteFinalized
  const net = q.lines.reduce((s, l) => s + l.qty * l.rate * (1 - l.discount / 100), 0)
  const gst = net * (q.gstRate / 100)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<FileSpreadsheet className="w-4 h-4" />}
        title={`Quotation ${q.number}`}
        right={<Chip label={final ? 'final' : 'draft'} tone={final ? STAGE_TONE.final : STAGE_TONE.draft} />}
      />
      <p className="text-xs text-foreground-muted mt-1 shrink-0">{q.buyer} · GSTIN {q.buyerGstin}</p>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.desc as string}
          rows={q.lines as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Item', cell: (r) => <span className="text-foreground">{r.desc as string}</span> },
            { head: 'HSN', cell: (r) => <span className="font-mono text-xs text-foreground-secondary">{r.hsn as string}</span> },
            { head: 'Qty', align: 'center', cell: (r) => <span className="text-foreground-secondary tabular-nums">{r.qty as number}</span> },
            { head: 'Rate', align: 'right', cell: (r) => <span className="text-foreground-secondary tabular-nums">{rupees(r.rate as number)}</span> },
            { head: 'Disc', align: 'right', cell: (r) => <span className="text-foreground-secondary tabular-nums">{r.discount as number}%</span> },
          ]}
        />
      </div>
      <div className="mt-2 space-y-1 text-sm shrink-0">
        <div className="flex justify-between text-foreground-secondary"><span>Net</span><span className="tabular-nums">{rupees(net)}</span></div>
        <div className="flex justify-between text-foreground-secondary"><span>GST ({q.gstRate}%)</span><span className="tabular-nums">{rupees(gst)}</span></div>
        <div className="flex justify-between font-bold text-foreground border-t border-border-default pt-1.5"><span>Total</span><span className="tabular-nums">{rupees(net + gst)}</span></div>
      </div>
      {!final ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.finalizeQuote}>
          <FileSpreadsheet className="w-4 h-4" /> Finalize & send
        </button>
      ) : (
        <Note />
      )}
    </div>
  )
}

export function RfqView() {
  const { world, actions } = useDemo()
  const r = RFQ
  const stage = world.rfqStage
  const done = stage === 'converted'
  const steps: World['rfqStage'][] = ['negotiating', 'offer_accepted', 'converted']
  const idx = steps.indexOf(stage)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <Head
        icon={<Handshake className="w-4 h-4" />}
        title={`RFQ ${r.number}`}
        right={<Chip label={stage.replace('_', ' ')} tone={STAGE_TONE[stage]} />}
      />
      <p className="text-xs text-foreground-muted mt-1 shrink-0">{r.company} · GSTIN {r.gstin}</p>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(row) => row.line as string}
          rows={r.offers as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Item', cell: (o) => <span className="text-foreground">{o.line as string}</span> },
            { head: 'Qty', align: 'center', cell: (o) => <span className="text-foreground-secondary tabular-nums">{o.qty as number}</span> },
            { head: 'Requested', align: 'right', cell: (o) => <span className="text-foreground-secondary tabular-nums">{rupees(o.requested as number)}</span> },
            { head: 'Offered', align: 'right', cell: (o) => <span className="text-foreground tabular-nums">{rupees(o.offered as number)}</span> },
          ]}
        />
        <div className="mt-3"><Steps steps={steps} idx={idx} /></div>
      </div>
      {!done ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.advanceRfq}>
          <Handshake className="w-4 h-4" /> Advance deal
        </button>
      ) : (
        <p className="text-sm text-green-700 font-medium mt-3 shrink-0">RFQ converted to a B2B order.</p>
      )}
    </div>
  )
}
