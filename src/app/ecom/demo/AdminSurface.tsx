'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import {
  Activity,
  BadgePercent,
  Boxes,
  ClipboardList,
  CreditCard,
  FileText,
  FileSpreadsheet,
  Handshake,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Package,
  PackageCheck,
  Printer,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  Tag,
  Truck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useDemo, type World, type Order, type ActivityRow } from './store'
import { CAMPAIGN, COUPON, CUSTOMERS, DASHBOARD_BARS, STOCK_ROWS, INVOICE } from './data'
import { STATUS_CLASSES, ACCENT } from './theme'
import ShipmentMap from './ShipmentMap'
import {
  InventoryView,
  PoView,
  GrnView,
  SettlementView,
  GstInvoiceView,
  ReportsView,
  ReturnView,
  QuoteView,
  RfqView,
  DataTable,
  Kv,
  rupees,
} from './AdminViews'

const PANEL = 'bg-surface-elevated rounded-xl border border-border-default'
const BTN =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white ecom-accent-bg disabled:opacity-40 disabled:cursor-not-allowed'
const statusPill = (s: string) => STATUS_CLASSES[s] ?? 'bg-yellow-100 text-yellow-800'
const resolveOrder = (world: World): Order | null => world.order ?? world.orders[0] ?? null

const HEALTH: Record<string, { tier: string; tone: string }> = {
  VIP: { tier: 'healthy', tone: 'bg-green-100 text-green-800' },
  Loyal: { tier: 'healthy', tone: 'bg-green-100 text-green-800' },
  Repeat: { tier: 'at_risk', tone: 'bg-yellow-100 text-yellow-800' },
  New: { tier: 'at_risk', tone: 'bg-yellow-100 text-yellow-800' },
}
const SHIP_STAGE: Record<string, string> = {
  pending: 'created',
  processing: 'picked_up',
  shipped: 'in_transit',
  delivered: 'delivered',
}

function Pill({ status }: { status: string }) {
  return <span className={clsx('px-2 py-0.5 text-xs font-semibold rounded-full', statusPill(status))}>{status}</span>
}
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-foreground-muted">{label}</p>
    </div>
  )
}
function Empty({ message }: { message: string }) {
  return (
    <div className={clsx(PANEL, 'h-full p-4 flex items-center justify-center')}>
      <p className="text-sm text-foreground-muted text-center max-w-xs">{message}</p>
    </div>
  )
}
function View({ id, reducedMotion, children }: { id: string; reducedMotion: boolean; children: ReactNode }) {
  if (reducedMotion) return <div className="h-full min-h-0">{children}</div>
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        className="h-full min-h-0"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
function CountUp({ value, prefix = '', animate }: { value: number; prefix?: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : value)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    if (!animate) return setShown(value)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [value, animate])
  return <span>{prefix + shown.toLocaleString('en-IN')}</span>
}
function activityIcon(kind: ActivityRow['kind']) {
  const cls = 'w-4 h-4'
  if (kind === 'payment') return <CreditCard className={cls} />
  if (kind === 'shipment') return <Truck className={cls} />
  if (kind === 'customer') return <UserPlus className={cls} />
  return <ShoppingBag className={cls} />
}

function DashboardView({ reducedMotion }: { reducedMotion: boolean }) {
  const { world } = useDemo()
  const m = world.metrics
  const aov = Math.round(m.revenue / Math.max(1, m.orderCount))
  const lowStock = STOCK_ROWS.filter((r) => r.status !== 'In Stock').length
  const cards = [
    { label: 'Revenue', node: <CountUp value={m.revenue} prefix="Rs. " animate={!reducedMotion} /> },
    { label: 'Orders', node: <CountUp value={m.orderCount} animate={!reducedMotion} /> },
    { label: 'AOV', node: <CountUp value={aov} prefix="Rs. " animate={!reducedMotion} /> },
    { label: 'Customers', node: <CountUp value={CUSTOMERS.length * 261} animate={!reducedMotion} /> },
    { label: 'Gross margin', node: '38%' },
  ]
  const attention = [
    { label: '1 order pending > 24h', tone: 'bg-yellow-100 text-yellow-800' },
    { label: `${lowStock} low / out of stock`, tone: 'bg-red-100 text-red-800' },
    { label: '1 open return', tone: 'bg-blue-100 text-blue-800' },
  ]
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 shrink-0">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface-secondary rounded-xl border border-border-default p-2.5">
            <p className="text-[11px] text-foreground-secondary">{c.label}</p>
            <p className="text-sm sm:text-base font-bold text-foreground mt-1 tabular-nums">{c.node}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {attention.map((a) => (
          <span key={a.label} className={clsx('px-2.5 py-1 text-xs font-semibold rounded-full', a.tone)}>
            {a.label}
          </span>
        ))}
      </div>
      <div className={clsx(PANEL, 'p-4 shrink-0')}>
        <p className="text-sm font-semibold text-foreground mb-3">Revenue trend</p>
        <div className="flex items-end gap-1 h-16">
          {DASHBOARD_BARS.map((h, i) => (
            <motion.div
              key={i}
              className="flex-1 rounded-t ecom-accent-bg"
              style={{ opacity: 0.65, height: reducedMotion ? `${h}%` : undefined }}
              initial={reducedMotion ? false : { height: 0 }}
              animate={reducedMotion ? undefined : { height: `${h}%` }}
              transition={{ duration: 0.5, delay: i * 0.02 }}
            />
          ))}
        </div>
      </div>
      <div className={clsx(PANEL, 'p-4 flex-1 min-h-0 overflow-hidden')}>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 ecom-accent-text" />
          <p className="text-sm font-semibold text-foreground">Live activity</p>
        </div>
        <ul className="space-y-2">
          {world.activity.slice(0, 4).map((row) => (
            <li key={row.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 ecom-accent-text shrink-0">{activityIcon(row.kind)}</span>
              <span className="text-sm text-foreground leading-snug">
                {row.label}
                <span className="text-foreground-muted text-xs ml-1">· {row.at}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function OrderView() {
  const { world, actions } = useDemo()
  const order = resolveOrder(world)
  if (!order) return <Empty message="No live order yet. Complete checkout to bring an order here." />
  const canConfirm = order.status === 'pending'
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <p className="text-sm font-semibold text-foreground">Order #{order.number}</p>
          <p className="text-xs text-foreground-muted mt-0.5">
            {order.customer} · {order.placedAt} · Razorpay
          </p>
        </div>
        <Pill status={order.status} />
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden divide-y divide-border-default border-y border-border-default">
        {order.items.map((it) => (
          <div key={it.productId} className="flex items-center justify-between py-2 text-sm">
            <span className="text-foreground">
              {it.name} <span className="text-foreground-muted">x{it.qty}</span>
            </span>
            <span className="text-foreground tabular-nums">{rupees(it.price * it.qty)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between py-2 text-sm font-semibold text-foreground shrink-0">
        <span>Order total</span>
        <span className="tabular-nums">{rupees(order.total)}</span>
      </div>
      <button className={clsx(BTN, 'self-start shrink-0')} disabled={!canConfirm} onClick={actions.markProcessing}>
        <Package className="w-4 h-4" /> Mark processing
      </button>
      <p className="text-[11px] text-foreground-muted mt-3 shrink-0">Demo only. No real email or SMS is sent.</p>
    </div>
  )
}

function ShipmentView({ reducedMotion }: { reducedMotion: boolean }) {
  const { world, actions } = useDemo()
  const order = resolveOrder(world)
  if (!order) return <Empty message="No order to ship yet." />
  const stage = SHIP_STAGE[order.status] ?? 'created'
  const notShipped = order.status === 'pending' || order.status === 'processing'
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <p className="text-sm font-semibold text-foreground">Shipment · Order #{order.number}</p>
          <p className="text-xs text-foreground-muted mt-0.5">{order.customer}</p>
        </div>
        <Pill status={order.status} />
      </div>
      {notShipped ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} disabled={order.status !== 'processing'} onClick={actions.ship}>
          <Truck className="w-4 h-4" /> Create shipment
        </button>
      ) : null}
      <div className="mt-3 flex-1 min-h-0 overflow-hidden">
        <ShipmentMap stage={stage} timeline={order.timeline} awb={order.awb} reduced={reducedMotion} />
      </div>
    </div>
  )
}

function DocsView() {
  const { world, actions } = useDemo()
  const order = resolveOrder(world)
  if (!order) return <Empty message="No order to document yet." />
  return (
    <div className="h-full min-h-0 grid grid-rows-[1fr_auto] gap-3">
      <div className={clsx(PANEL, 'min-h-0 p-4 flex flex-col overflow-hidden')}>
        <div className="flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold text-foreground">GST packing slip</p>
          <span className="text-xs text-foreground-muted">GSTIN {INVOICE.buyerGstin === '-' ? '29ABCDE1234F1Z5' : INVOICE.buyerGstin}</span>
        </div>
        <div className="mt-3 flex-1 min-h-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-foreground-secondary uppercase tracking-wider border-b border-border-default">
                <th className="text-left font-semibold py-1.5">Product</th>
                <th className="text-left font-semibold py-1.5">HSN/SAC</th>
                <th className="text-center font-semibold py-1.5">GST%</th>
                <th className="text-center font-semibold py-1.5">Qty</th>
                <th className="text-right font-semibold py-1.5">Rate</th>
                <th className="text-right font-semibold py-1.5">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {order.items.map((it) => (
                <tr key={it.productId}>
                  <td className="py-2 text-foreground">{it.name}</td>
                  <td className="py-2 font-mono text-xs text-foreground-secondary">{INVOICE.hsn}</td>
                  <td className="py-2 text-center text-foreground-secondary tabular-nums">18%</td>
                  <td className="py-2 text-center text-foreground-secondary tabular-nums">{it.qty}</td>
                  <td className="py-2 text-right text-foreground-secondary tabular-nums">{rupees(it.price)}</td>
                  <td className="py-2 text-right text-foreground tabular-nums">{rupees(it.price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {order.awb ? (
        <div className={clsx(PANEL, 'p-3 flex items-center justify-between shrink-0')}>
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 ecom-accent-text" />
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wider">Shipping label · Delhivery</p>
              <p className="text-sm font-semibold text-foreground">To {order.customer}</p>
            </div>
          </div>
          <span className="rounded-md border border-border-default px-2 py-1 font-mono text-[11px] font-semibold text-foreground">
            AWB {order.awb}
          </span>
        </div>
      ) : (
        <button className={clsx(BTN, 'self-start shrink-0')} onClick={actions.generateInvoice}>
          <FileText className="w-4 h-4" /> Generate docs
        </button>
      )}
    </div>
  )
}

function CampaignView() {
  const { world, actions } = useDemo()
  const sent = world.campaignSent
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-center gap-2 shrink-0">
        <Megaphone className="w-4 h-4 ecom-accent-text" />
        <p className="text-sm font-semibold text-foreground">Email campaign</p>
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden space-y-3">
        <Kv label="Campaign name" value={CAMPAIGN.name} strong />
        <div className="grid grid-cols-2 gap-3">
          <Kv label="Audience" value={CAMPAIGN.audience} />
          <Kv label="Status" value={sent ? 'Active' : 'Paused'} />
        </div>
        {sent ? (
          <div className="rounded-lg border border-border-default p-3">
            <p className="text-sm font-semibold text-foreground">Campaign sent</p>
            <div className="grid grid-cols-3 gap-3 mt-2 text-center">
              <Stat value={CAMPAIGN.reach.toLocaleString('en-IN')} label="Reach" />
              <Stat value={`${CAMPAIGN.openRate}%`} label="Open rate" />
              <Stat value={CAMPAIGN.orders} label="Orders" />
            </div>
          </div>
        ) : null}
      </div>
      {!sent ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.sendCampaign}>
          <Megaphone className="w-4 h-4" /> Send campaign
        </button>
      ) : null}
      <p className="text-[11px] text-foreground-muted mt-3 shrink-0">Demo only. No real email is sent.</p>
    </div>
  )
}

function CouponView() {
  const { world, actions } = useDemo()
  const created = world.couponCreated
  const pct = Math.min(100, Math.round((COUPON.used / COUPON.cap) * 100))
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-center gap-2 shrink-0">
        <BadgePercent className="w-4 h-4 ecom-accent-text" />
        <p className="text-sm font-semibold text-foreground">Discount coupon</p>
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Kv label="Code" value={COUPON.code} strong />
          <Kv label="Type" value={`Percentage · ${COUPON.off}`} />
        </div>
        <Kv label="Minimum cart" value={rupees(COUPON.minCart)} />
        {created ? (
          <div className="rounded-lg border border-border-default p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Live · {COUPON.code}</p>
              <p className="text-xs text-foreground-muted tabular-nums">
                {COUPON.used} / {COUPON.cap} used
              </p>
            </div>
            <div className="mt-2 h-2 rounded-full bg-surface-secondary overflow-hidden">
              <motion.div
                className="h-full ecom-accent-bg"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6 }}
              />
            </div>
          </div>
        ) : null}
      </div>
      {!created ? (
        <button className={clsx(BTN, 'self-start mt-3 shrink-0')} onClick={actions.createCoupon}>
          <Tag className="w-4 h-4" /> Create coupon
        </button>
      ) : null}
    </div>
  )
}

function CrmView() {
  const rows = CUSTOMERS.slice(0, 5)
  return (
    <div className={clsx(PANEL, 'h-full min-h-0 p-4 flex flex-col')}>
      <div className="flex items-center gap-2 shrink-0">
        <Users className="w-4 h-4 ecom-accent-text" />
        <p className="text-sm font-semibold text-foreground">Customers & CRM</p>
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <DataTable
          keyOf={(r) => r.id as string}
          rows={rows as unknown as Record<string, unknown>[]}
          cols={[
            { head: 'Customer', cell: (c) => <span className="text-foreground">{c.name as string}</span> },
            { head: 'Orders', align: 'center', cell: (c) => <span className="text-foreground-secondary tabular-nums">{c.orders as number}</span> },
            { head: 'Lifetime', align: 'right', cell: (c) => <span className="text-foreground tabular-nums">{rupees(c.spent as number)}</span> },
            {
              head: 'Health', align: 'center', cell: (c) => {
                const h = HEALTH[c.tag as string] ?? HEALTH.New
                return <span className={clsx('px-2 py-0.5 text-xs font-semibold rounded-full', h.tone)}>{h.tier}</span>
              },
            },
            { head: 'Segment', align: 'right', cell: (c) => <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">{(c.tag as string).toLowerCase()}</span> },
          ]}
        />
      </div>
    </div>
  )
}

type Render = (rm: boolean) => ReactNode
const TABS: { focus: string; label: string; icon: typeof LayoutDashboard; render: Render }[] = [
  { focus: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, render: (rm) => <DashboardView reducedMotion={rm} /> },
  { focus: 'order', label: 'Order', icon: Package, render: () => <OrderView /> },
  { focus: 'shipment', label: 'Shipment', icon: Truck, render: (rm) => <ShipmentView reducedMotion={rm} /> },
  { focus: 'docs', label: 'Docs', icon: Printer, render: () => <DocsView /> },
  { focus: 'inventory', label: 'Inventory', icon: Boxes, render: () => <InventoryView /> },
  { focus: 'po', label: 'Purchase order', icon: ClipboardList, render: () => <PoView /> },
  { focus: 'grn', label: 'Goods receipt', icon: PackageCheck, render: () => <GrnView /> },
  { focus: 'settlement', label: 'Settlement', icon: Wallet, render: () => <SettlementView /> },
  { focus: 'gstinvoice', label: 'GST invoice', icon: ReceiptText, render: () => <GstInvoiceView /> },
  { focus: 'reports', label: 'Reports', icon: LineChart, render: () => <ReportsView /> },
  { focus: 'return', label: 'Return', icon: RotateCcw, render: () => <ReturnView /> },
  { focus: 'quote', label: 'Quotation', icon: FileSpreadsheet, render: () => <QuoteView /> },
  { focus: 'rfq', label: 'RFQ', icon: Handshake, render: () => <RfqView /> },
  { focus: 'campaign', label: 'Campaign', icon: Megaphone, render: () => <CampaignView /> },
  { focus: 'coupon', label: 'Coupon', icon: BadgePercent, render: () => <CouponView /> },
  { focus: 'crm', label: 'CRM', icon: Users, render: () => <CrmView /> },
]

export default function AdminSurface() {
  const { chapter, reducedMotion } = useDemo()
  const focus = chapter.focus ?? 'dashboard'
  const active = TABS.find((t) => t.focus === focus) ?? TABS[0]
  return (
    <div
      className="ecom-clean bg-surface text-foreground h-full w-full flex flex-col overflow-hidden rounded-xl p-4"
      style={{ ['--accent' as string]: ACCENT }}
    >
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-foreground-muted uppercase tracking-widest">Store admin</p>
          <h3 className="text-base font-bold text-foreground mt-0.5 truncate">{active.label}</h3>
        </div>
        <nav className="flex items-center gap-1 flex-wrap justify-end max-w-[70%]">
          {TABS.map((t) => {
            const Icon = t.icon
            const on = t.focus === focus
            return (
              <span
                key={t.focus}
                title={t.label}
                className={clsx(
                  'inline-flex items-center justify-center w-7 h-7 rounded-lg',
                  on ? 'ecom-accent-bg text-white' : 'text-foreground-muted bg-surface-secondary'
                )}
              >
                <Icon className="w-4 h-4" />
              </span>
            )
          })}
        </nav>
      </div>
      <div className="mt-4 flex-1 min-h-0">
        <View id={focus} reducedMotion={reducedMotion}>
          {active.render(reducedMotion)}
        </View>
      </div>
    </div>
  )
}
