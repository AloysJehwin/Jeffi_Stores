'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ShieldCheck, Boxes, Tags, FolderTree, Package, Ticket, MailOpen, ScrollText, Filter,
  ArrowRight, Image as ImageIcon, Truck, Receipt, Wallet, MapPin, Settings,
  Warehouse, TrendingUp, Wand2, ClipboardList, Tag,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock, CheckCircle2, XCircle, RefreshCw, Play, Mail, ChevronDown, ChevronUp, Users, User,
} from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/admin-path'

interface AuditEvent {
  id: string
  admin_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  diff: Record<string, { from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> | null
  metadata: Record<string, any> | null
  ip_address: string | null
  created_at: string
  admin_first_name: string | null
  admin_last_name: string | null
  admin_username: string | null
}

const ENTITY_META: Record<string, { Icon: any; color: string }> = {
  product:              { Icon: Package,      color: 'bg-blue-500' },
  products:             { Icon: Package,      color: 'bg-blue-500' },
  product_variants:     { Icon: Package,      color: 'bg-blue-400' },
  product_sub_variants: { Icon: Package,      color: 'bg-blue-300' },
  product_images:       { Icon: Package,      color: 'bg-blue-300' },
  variant_images:       { Icon: Package,      color: 'bg-blue-300' },
  brand:                { Icon: Tags,         color: 'bg-purple-500' },
  brands:               { Icon: Tags,         color: 'bg-purple-500' },
  category:             { Icon: FolderTree,   color: 'bg-violet-500' },
  categories:           { Icon: FolderTree,   color: 'bg-violet-500' },
  inventory:            { Icon: Boxes,        color: 'bg-amber-500' },
  coupon:               { Icon: Ticket,       color: 'bg-pink-500' },
  coupons:              { Icon: Ticket,       color: 'bg-pink-500' },
  campaign:             { Icon: MailOpen,     color: 'bg-emerald-500' },
  campaigns:            { Icon: MailOpen,     color: 'bg-emerald-500' },
  email_campaigns:      { Icon: MailOpen,     color: 'bg-emerald-500' },
  mailer_template:      { Icon: MailOpen,     color: 'bg-emerald-500' },
  admin:                { Icon: ShieldCheck,  color: 'bg-red-500' },
  order:                { Icon: ScrollText,   color: 'bg-indigo-500' },
  suppliers:            { Icon: Truck,        color: 'bg-amber-500' },
  purchase_orders:      { Icon: ClipboardList,color: 'bg-orange-500' },
  purchase_order_items: { Icon: ClipboardList,color: 'bg-orange-400' },
  grns:                 { Icon: Receipt,      color: 'bg-amber-600' },
  grn_items:            { Icon: Receipt,      color: 'bg-amber-500' },
  expenses:             { Icon: Wallet,       color: 'bg-rose-500' },
  expense_payments:     { Icon: Wallet,       color: 'bg-rose-400' },
  shelf_locations:      { Icon: MapPin,       color: 'bg-cyan-500' },
  shelf_stock:          { Icon: Boxes,        color: 'bg-cyan-400' },
  shipping_zones:       { Icon: MapPin,       color: 'bg-teal-500' },
  site_settings:        { Icon: Settings,     color: 'bg-zinc-600' },
  gallery_images:       { Icon: ImageIcon,    color: 'bg-blue-300' },
  warehouses:           { Icon: Warehouse,    color: 'bg-cyan-600' },
  price_inflation_log:  { Icon: TrendingUp,   color: 'bg-pink-500' },
  scenarios:            { Icon: Wand2,        color: 'bg-fuchsia-500' },
  custom_scenarios:     { Icon: Wand2,        color: 'bg-fuchsia-400' },
  review_forms:         { Icon: ClipboardList,color: 'bg-yellow-500' },
  customer_tag_definitions: { Icon: Tag,      color: 'bg-cyan-500' },
}

function relTime(iso: string) {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface CronJob {
  id: string
  name: string
  path: string
  intervalMs: number
  intervalLabel: string
  enabled: boolean
  lastRun: string | null
  lastStatus: string | null
  lastError: string | null
  log: Array<{ t: string; ok: boolean; err?: string; detail?: unknown }>
}

type PageTab = 'audit' | 'mail_log' | 'cron'

export default function AdminAuditClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)

  const initialTab = (): PageTab => {
    const t = searchParams?.get('tab')
    if (t === 'cron') return t
    if (t === 'mail_log') return t
    return 'audit'
  }
  const [pageTab, setPageTabState] = useState<PageTab>(initialTab)

  function setPageTab(next: PageTab) {
    setPageTabState(next)
    router.push(ap(`/admin/audit?tab=${next}`), { scroll: false })
  }

  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [cronLoading, setCronLoading] = useState(false)
  const [cronTogglingId, setCronTogglingId] = useState<string | null>(null)
  const [cronTriggeringId, setCronTriggeringId] = useState<string | null>(null)
  const [expandedCronId, setExpandedCronId] = useState<string | null>(null)

  // ── Mail Log state (email_logs — every outbound mail with body) ────────────
  interface MailLogRow {
    id: string
    email: string
    from_email: string | null
    cc: string | null
    bcc: string | null
    subject: string
    template_name: string | null
    kind: string | null
    entity_type: string | null
    entity_id: string | null
    status: 'sent' | 'failed'
    error: string | null
    sent_at: string
    message_id: string | null
    body_size: number
  }
  const [mailRows, setMailRows] = useState<MailLogRow[]>([])
  const [mailLoading, setMailLoading] = useState(false)
  const [mailPage, setMailPage] = useState(1)
  const [mailTotal, setMailTotal] = useState(0)
  const mailPageSize = 25
  const [mailKind, setMailKind] = useState<string>('all')
  const [mailStatus, setMailStatus] = useState<string>('all')
  const [mailQuery, setMailQuery] = useState<string>('')
  const [mailQueryDebounced, setMailQueryDebounced] = useState<string>('')
  const [expandedMailId, setExpandedMailId] = useState<string | null>(null)
  const [mailBodies, setMailBodies] = useState<Record<string, { html: string | null; text: string | null; metadata: any; loading: boolean }>>({})

  async function loadMailLog() {
    setMailLoading(true)
    try {
      const qs = new URLSearchParams({
        page: String(mailPage),
        pageSize: String(mailPageSize),
      })
      if (mailKind !== 'all') qs.set('kind', mailKind)
      if (mailStatus !== 'all') qs.set('status', mailStatus)
      if (mailQueryDebounced) qs.set('q', mailQueryDebounced)
      const res = await fetch(`/api/admin/audit/mail-log?${qs.toString()}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setMailRows(data.rows || [])
        setMailTotal(data.total || 0)
      }
    } finally {
      setMailLoading(false)
    }
  }

  async function loadMailBody(id: string) {
    setMailBodies(prev => ({ ...prev, [id]: { html: null, text: null, metadata: null, loading: true } }))
    try {
      const res = await fetch(`/api/admin/audit/mail-log/${id}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setMailBodies(prev => ({
          ...prev,
          [id]: { html: data.row?.body_html ?? null, text: data.row?.body_text ?? null, metadata: data.row?.metadata ?? null, loading: false },
        }))
      } else {
        setMailBodies(prev => ({ ...prev, [id]: { html: null, text: null, metadata: null, loading: false } }))
      }
    } catch {
      setMailBodies(prev => ({ ...prev, [id]: { html: null, text: null, metadata: null, loading: false } }))
    }
  }

  function toggleMailExpand(id: string) {
    if (expandedMailId === id) {
      setExpandedMailId(null)
      return
    }
    setExpandedMailId(id)
    if (!mailBodies[id]) loadMailBody(id)
  }

  async function load() {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (entityFilter !== 'all') qs.set('entity_type', entityFilter)
      if (actionFilter !== 'all') qs.set('action', actionFilter)
      const res = await fetch(`/api/admin/audit?${qs.toString()}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || [])
        setTotal(data.total || 0)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadCronJobs() {
    setCronLoading(true)
    try {
      const res = await fetch('/api/admin/cron/status', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setCronJobs(data.jobs || [])
      }
    } finally {
      setCronLoading(false)
    }
  }

  async function toggleCronJob(jobId: string, enabled: boolean) {
    setCronTogglingId(jobId)
    try {
      await fetch('/api/admin/cron/config', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, enabled }),
      })
      setCronJobs(prev => prev.map(j => j.id === jobId ? { ...j, enabled } : j))
    } finally {
      setCronTogglingId(null)
    }
  }

  async function triggerCronJob(jobId: string) {
    setCronTriggeringId(jobId)
    try {
      await fetch('/api/admin/cron/trigger', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      await loadCronJobs()
    } finally {
      setCronTriggeringId(null)
    }
  }

  useEffect(() => { setPage(1) }, [entityFilter, actionFilter, pageSize])
  useEffect(() => { load() }, [entityFilter, actionFilter, page, pageSize])
  useEffect(() => { if (pageTab === 'cron') loadCronJobs() }, [pageTab])
  useEffect(() => { if (pageTab === 'mail_log') loadMailLog() }, [pageTab, mailPage, mailKind, mailStatus, mailQueryDebounced])
  useEffect(() => {
    const id = setTimeout(() => setMailQueryDebounced(mailQuery), 300)
    return () => clearTimeout(id)
  }, [mailQuery])
  useEffect(() => { setMailPage(1) }, [mailKind, mailStatus, mailQueryDebounced])

  const entityOptions = useMemo(() => [
    { value: 'all', label: 'All entities' },
    { value: 'products', label: 'Products' },
    { value: 'product_variants', label: 'Variants' },
    { value: 'product_sub_variants', label: 'Sub-variants' },
    { value: 'product_images', label: 'Product images' },
    { value: 'variant_images', label: 'Variant images' },
    { value: 'brands', label: 'Brands' },
    { value: 'categories', label: 'Categories' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'coupons', label: 'Coupons' },
    { value: 'campaigns', label: 'Campaigns' },
    { value: 'email_campaigns', label: 'Mailer broadcasts' },
    { value: 'suppliers', label: 'Suppliers' },
    { value: 'purchase_orders', label: 'Purchase orders' },
    { value: 'purchase_order_items', label: 'PO items' },
    { value: 'grns', label: 'GRNs' },
    { value: 'grn_items', label: 'GRN items' },
    { value: 'expenses', label: 'Expenses' },
    { value: 'expense_payments', label: 'Expense payments' },
    { value: 'shelf_locations', label: 'Shelf locations' },
    { value: 'shelf_stock', label: 'Shelf stock' },
    { value: 'shipping_zones', label: 'Shipping zones' },
    { value: 'site_settings', label: 'Site settings' },
    { value: 'gallery_images', label: 'Gallery images' },
    { value: 'warehouses', label: 'Warehouses' },
    { value: 'price_inflation_log', label: 'Price inflation' },
    { value: 'scenarios', label: 'Scenarios' },
    { value: 'custom_scenarios', label: 'Custom scenarios' },
    { value: 'review_forms', label: 'Review forms' },
    { value: 'customer_tag_definitions', label: 'Tag definitions' },
  ], [])

  const actionOptions = useMemo(() => [
    { value: 'all', label: 'All actions' },
    { value: 'create', label: 'Create' },
    { value: 'update', label: 'Update' },
    { value: 'delete', label: 'Delete' },
    { value: 'inventory_adjust', label: 'Inventory adjust' },
    { value: 'feature', label: 'Feature' },
    { value: 'unfeature', label: 'Unfeature' },
    { value: 'send', label: 'Send' },
    { value: 'export', label: 'Export' },
  ], [])

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

  function actorLabel(e: AuditEvent) {
    const f = e.admin_first_name || ''
    const l = e.admin_last_name || ''
    return `${f} ${l}`.trim() || e.admin_username || (e.admin_id ? 'Admin' : 'System')
  }

  interface ImageGroup {
    kind: 'image_group'
    id: string
    productId: string | null
    productName: string | null
    representative: AuditEvent
    children: AuditEvent[]
    operation: 'create' | 'replace' | 'delete' | 'reorder'
    oldImage: { url: string | null; thumb: string | null; name: string | null } | null
    newImage: { url: string | null; thumb: string | null; name: string | null } | null
  }
  interface ProductGroup {
    kind: 'product_group'
    id: string
    productId: string
    productName: string
    representative: AuditEvent
    children: AuditEvent[]
    variantCount: number
    subVariantCount: number
    imageCount: number
    parentTable?: string
  }
  type RowItem = (AuditEvent & { kind: 'event' }) | ImageGroup | ProductGroup

  function productIdOf(e: AuditEvent): string | null {
    if (e.entity_type === 'products') return e.entity_id
    if (e.entity_type === 'product_variants' || e.entity_type === 'product_sub_variants' || e.entity_type === 'product_images') {
      return (e.metadata?.product_id as string) || null
    }
    if (e.entity_type === 'variant_images') {
      return (e.metadata?.product_id as string) || (e.metadata?.variant_id as string) || null
    }
    return null
  }

  function parentKeyOf(e: AuditEvent): string | null {
    if (e.metadata?.inflation_id) return `inflation:${e.metadata.inflation_id}`
    if (e.entity_type === 'price_inflation_log') return `inflation:${e.entity_id}`
    const pid = productIdOf(e)
    if (pid) return `product:${pid}`
    if (e.entity_type === 'purchase_orders') return `po:${e.entity_id}`
    if (e.entity_type === 'purchase_order_items' && e.metadata?.po_id) return `po:${e.metadata.po_id}`
    if (e.entity_type === 'grns') return `grn:${e.entity_id}`
    if (e.entity_type === 'grn_items' && e.metadata?.grn_id) return `grn:${e.metadata.grn_id}`
    if (e.entity_type === 'expenses') return `expense:${e.entity_id}`
    if (e.entity_type === 'expense_payments' && e.metadata?.expense_id) return `expense:${e.metadata.expense_id}`
    if (e.entity_type === 'shelf_locations') return `shelf:${e.entity_id}`
    if (e.entity_type === 'shelf_stock' && e.metadata?.location_id) return `shelf:${e.metadata.location_id}`
    return null
  }

  const rows = useMemo<RowItem[]>(() => {
    const out: RowItem[] = []
    let i = 0
    while (i < events.length) {
      const e = events[i]
      const pid = productIdOf(e)
      const hasInflation = !!e.metadata?.inflation_id || e.entity_type === 'price_inflation_log'

      if (pid && !hasInflation) {
        const t0 = new Date(e.created_at).getTime()
        const cluster: AuditEvent[] = [e]
        let j = i + 1
        while (j < events.length) {
          const n = events[j]
          if (productIdOf(n) !== pid) break
          if (n.admin_id !== e.admin_id) break
          if (Math.abs(new Date(n.created_at).getTime() - t0) > 5000) break
          cluster.push(n)
          j++
        }

        const isImageOnly = cluster.every(c => c.entity_type === 'product_images' || c.entity_type === 'variant_images')
        const hasNonImage = cluster.some(c => c.entity_type !== 'product_images' && c.entity_type !== 'variant_images')

        if (cluster.length > 1 && isImageOnly) {
          const createChild = cluster.find(c => c.action === 'create')
          const deleteChild = cluster.find(c => c.action === 'delete')
          const repr = createChild || deleteChild || cluster[0]
          let operation: 'create' | 'replace' | 'delete' | 'reorder'
          if (createChild && deleteChild) operation = 'replace'
          else if (createChild) operation = 'create'
          else if (deleteChild) operation = 'delete'
          else operation = 'reorder'
          const productName = (repr.summary.match(/"([^"]+)"$/)?.[1]) || null
          const newImage = createChild?.metadata ? {
            url: createChild.metadata.image_url || null,
            thumb: createChild.metadata.thumbnail_url || null,
            name: createChild.metadata.file_name || null,
          } : null
          const oldImage = deleteChild?.metadata ? {
            url: deleteChild.metadata.image_url || null,
            thumb: deleteChild.metadata.thumbnail_url || null,
            name: deleteChild.metadata.file_name || null,
          } : null
          out.push({
            kind: 'image_group',
            id: `grp-${e.id}`,
            productId: pid,
            productName,
            representative: repr,
            children: cluster,
            operation,
            oldImage,
            newImage,
          })
          i = j
          continue
        }

        if (cluster.length > 1 && hasNonImage) {
          const productRow = cluster.find(c => c.entity_type === 'products')
          const repr = productRow || cluster[0]
          const productName = (repr.summary.match(/"([^"]+)"/)?.[1]) || pid
          out.push({
            kind: 'product_group',
            id: `pgrp-${e.id}`,
            productId: pid,
            productName,
            representative: repr,
            children: cluster,
            variantCount: cluster.filter(c => c.entity_type === 'product_variants').length,
            subVariantCount: cluster.filter(c => c.entity_type === 'product_sub_variants').length,
            imageCount: cluster.filter(c => c.entity_type === 'product_images').length,
          })
          i = j
          continue
        }
      }

      const pkey = parentKeyOf(e)
      if (pkey) {
        const t0 = new Date(e.created_at).getTime()
        const cluster: AuditEvent[] = [e]
        const windowMs = pkey.startsWith('inflation:') ? 60_000 : 5000
        let j = i + 1
        while (j < events.length) {
          const n = events[j]
          if (parentKeyOf(n) !== pkey) break
          if (n.admin_id !== e.admin_id) break
          if (Math.abs(new Date(n.created_at).getTime() - t0) > windowMs) break
          cluster.push(n)
          j++
        }
        if (cluster.length > 1) {
          const [parentTableHint] = pkey.split(':')
          const parentEntityMap: Record<string, string> = {
            po: 'purchase_orders',
            grn: 'grns',
            expense: 'expenses',
            shelf: 'shelf_locations',
            inflation: 'price_inflation_log',
          }
          const parentTable = parentEntityMap[parentTableHint] || ''
          const parentRow = parentTable ? cluster.find(c => c.entity_type === parentTable) : undefined
          const repr = parentRow || cluster[0]
          const parentName = (repr.summary.match(/"([^"]+)"/)?.[1]) || pkey.split(':')[1]
          out.push({
            kind: 'product_group',
            id: `pkgrp-${e.id}`,
            productId: pkey.split(':')[1],
            productName: parentName,
            representative: repr,
            children: cluster,
            variantCount: 0,
            subVariantCount: 0,
            imageCount: 0,
            parentTable,
          })
          i = j
          continue
        }
      }

      out.push({ ...e, kind: 'event' })
      i++
    }
    return out
  }, [events])

  return (
    <div className="p-4 sm:p-6 w-full">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-accent-500" />
        <h1 className="text-xl font-bold text-foreground">Admin Audit Log</h1>
      </div>

      <div className="flex items-center gap-1 border-b border-border-default mb-5">
        {([
          { id: 'audit', label: 'Audit Events', icon: ScrollText },
          { id: 'mail_log', label: 'Mail Log', icon: Mail },
          { id: 'cron', label: 'Cron Jobs', icon: Clock },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPageTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
              pageTab === id
                ? 'text-accent-600 dark:text-accent-400 border-accent-500'
                : 'text-foreground-muted hover:text-foreground border-transparent'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {pageTab === 'mail_log' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <p className="text-sm text-foreground-muted">Every outbound email — transactional, automation, business, and broadcasts. Click a row to see the full HTML body.</p>
            <button
              type="button"
              onClick={loadMailLog}
              disabled={mailLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-50 self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${mailLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_140px] gap-2 mb-4">
            <input
              type="text"
              placeholder="Search by recipient or subject..."
              value={mailQuery}
              onChange={e => setMailQuery(e.target.value)}
              className="text-sm px-3 py-2 rounded border border-border-default bg-surface-elevated text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
            <AdminSelect
              value={mailKind}
              onChange={(v) => setMailKind(v)}
              options={[
                { value: 'all', label: 'All kinds' },
                { value: 'otp', label: 'OTP' },
                { value: 'welcome', label: 'Welcome' },
                { value: 'order', label: 'Order' },
                { value: 'invoice', label: 'Invoice' },
                { value: 'quotation', label: 'Quotation' },
                { value: 'rfq', label: 'RFQ' },
                { value: 'purchase_order', label: 'Purchase Order' },
                { value: 'business', label: 'Business' },
                { value: 'automation', label: 'Automation' },
                { value: 'campaign', label: 'Campaign' },
                { value: 'admin_notification', label: 'Admin notification' },
                { value: 'support', label: 'Support' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <AdminSelect
              value={mailStatus}
              onChange={(v) => setMailStatus(v)}
              options={[
                { value: 'all', label: 'All status' },
                { value: 'sent', label: 'Sent' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>

          {mailLoading && mailRows.length === 0 ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-lg bg-surface-secondary animate-pulse" />)}
            </div>
          ) : mailRows.length === 0 ? (
            <p className="text-sm text-foreground-muted italic">No emails found.</p>
          ) : (
            <div className="space-y-2">
              {mailRows.map(row => {
                const isExpanded = expandedMailId === row.id
                const body = mailBodies[row.id]
                return (
                  <div key={row.id} className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleMailExpand(row.id)}
                      className="w-full text-left p-3 sm:p-4 flex items-center gap-3 sm:gap-4 hover:bg-surface-secondary/40 transition-colors"
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 ${row.status === 'sent' ? 'bg-emerald-500' : 'bg-red-500'}`}>
                        {row.status === 'sent' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground truncate">{row.subject || '(no subject)'}</span>
                          {row.kind && (
                            <span className="text-[10px] font-mono uppercase tracking-wide text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                              {row.kind}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-foreground-muted mt-0.5 truncate">
                          To: {row.email}
                          {row.from_email ? <span className="ml-2">From: {row.from_email}</span> : null}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-muted">
                            {new Date(row.sent_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {row.entity_type && row.entity_id && (
                            <span className="text-[11px] text-foreground-muted">
                              {row.entity_type} · <span className="font-mono">{row.entity_id.slice(0, 8)}</span>
                            </span>
                          )}
                          {row.template_name && (
                            <span className="text-[10px] font-mono text-foreground-muted">{row.template_name}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-foreground-muted" />
                          : <ChevronDown className="w-4 h-4 text-foreground-muted" />
                        }
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border-default">
                        {row.error && (
                          <div className="px-4 py-2 bg-red-50 dark:bg-red-950/30 text-[11px] text-red-700 dark:text-red-300 font-mono break-all">
                            {row.error}
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-0 md:gap-4 text-xs">
                          <dl className="px-4 py-3 space-y-1.5 bg-surface-secondary/40 md:bg-transparent">
                            <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">From</dt><dd className="text-foreground break-all">{row.from_email || '—'}</dd></div>
                            <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">To</dt><dd className="text-foreground break-all">{row.email}</dd></div>
                            {row.cc && <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">Cc</dt><dd className="text-foreground break-all">{row.cc}</dd></div>}
                            {row.bcc && <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">Bcc</dt><dd className="text-foreground break-all">{row.bcc}</dd></div>}
                            <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">Subject</dt><dd className="text-foreground">{row.subject}</dd></div>
                            {row.message_id && <div><dt className="text-foreground-muted text-[10px] uppercase tracking-wide">Message-ID</dt><dd className="text-foreground font-mono text-[10px] break-all">{row.message_id}</dd></div>}
                          </dl>
                          <div className="p-3 sm:p-4">
                            {body?.loading ? (
                              <div className="flex items-center justify-center py-10"><RefreshCw className="w-4 h-4 animate-spin text-foreground-muted" /></div>
                            ) : body?.html ? (
                              <iframe
                                title={`mail-${row.id}`}
                                srcDoc={body.html}
                                sandbox=""
                                className="w-full h-96 rounded border border-border-default bg-white"
                              />
                            ) : body?.text ? (
                              <pre className="text-xs whitespace-pre-wrap text-foreground bg-surface-secondary/50 p-3 rounded border border-border-default max-h-96 overflow-auto">{body.text}</pre>
                            ) : (
                              <p className="text-xs text-foreground-muted italic">No body recorded for this email.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!mailLoading && mailTotal > mailPageSize && (() => {
            const totalPages = Math.ceil(mailTotal / mailPageSize)
            return (
              <div className="mt-6 flex items-center justify-between border-t border-border-default pt-4">
                <p className="text-xs text-foreground-muted">
                  Page <span className="font-medium text-foreground">{mailPage}</span> of <span className="font-medium text-foreground">{totalPages}</span> · {mailTotal} email{mailTotal !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setMailPage(p => Math.max(1, p - 1))} disabled={mailPage === 1} className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setMailPage(p => Math.min(totalPages, p + 1))} disabled={mailPage >= totalPages} className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {pageTab === 'cron' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-foreground-muted">Background jobs running in the server process. Toggle to enable/disable; last run status reflects current deployment.</p>
            <button
              type="button"
              onClick={loadCronJobs}
              disabled={cronLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cronLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          {cronLoading && cronJobs.length === 0 ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-lg bg-surface-secondary animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {cronJobs.map(job => {
                  const isExpanded = expandedCronId === job.id
                  return (
                <div key={job.id} className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden">
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{job.name}</span>
                      <span className="text-[10px] font-mono text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">{job.intervalLabel}</span>
                      {job.lastStatus === 'ok' && (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-700 dark:text-green-400">
                          <CheckCircle2 className="w-3 h-3" /> last run ok
                        </span>
                      )}
                      {job.lastStatus === 'error' && (
                        <span className="flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400">
                          <XCircle className="w-3 h-3" /> last run failed
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-foreground-muted mt-0.5 font-mono">{job.path}</p>
                    {job.lastRun && (
                      <p className="text-[11px] text-foreground-muted mt-0.5">
                        Last run: {new Date(job.lastRun).toLocaleString('en-IN')}
                        {job.lastError ? ` — ${job.lastError}` : ''}
                      </p>
                    )}
                    {!job.lastRun && <p className="text-[11px] text-foreground-muted mt-0.5 italic">No runs recorded yet</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={cronTriggeringId === job.id}
                      onClick={() => triggerCronJob(job.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-surface-secondary text-foreground-muted hover:bg-accent-100 dark:hover:bg-accent-900/30 hover:text-accent-700 dark:hover:text-accent-300 disabled:opacity-50 transition-colors"
                    >
                      {cronTriggeringId === job.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <Play className="w-3 h-3" />
                      }
                      Trigger now
                    </button>
                    {job.log.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedCronId(isExpanded ? null : job.id)}
                        className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-secondary text-foreground-muted hover:bg-surface-elevated transition-colors"
                      >
                        {isExpanded ? 'Hide' : `Logs (${job.log.length})`}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={cronTogglingId === job.id}
                      onClick={() => toggleCronJob(job.id, !job.enabled)}
                      className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-50 ${
                        job.enabled
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-800 dark:hover:text-red-300'
                          : 'bg-surface-secondary text-foreground-muted hover:bg-green-100 dark:hover:bg-green-900/30 hover:text-green-800 dark:hover:text-green-300'
                      }`}
                    >
                      {cronTogglingId === job.id ? '...' : job.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  </div>
                  {isExpanded && job.log.length > 0 && (
                    <div className="border-t border-border-default divide-y divide-border-default max-h-96 overflow-y-auto">
                      {job.log.map((entry, i) => (
                        <div key={i} className={`px-4 py-2 flex items-start gap-2 text-[11px] ${entry.ok ? '' : 'bg-red-50/50 dark:bg-red-900/10'}`}>
                          {entry.ok
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />
                            : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-px" />
                          }
                          <div className="flex-1 min-w-0">
                            <span className="text-foreground-muted">{new Date(entry.t).toLocaleString('en-IN')}</span>
                            {!entry.ok && entry.err && (
                              <span className="ml-2 text-red-600 dark:text-red-400 font-mono">{entry.err}</span>
                            )}
                            {entry.detail !== undefined && (
                              <pre className="mt-1 text-[10px] font-mono bg-surface-secondary rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all text-foreground-muted leading-relaxed">
                                {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                  )
                })}
            </div>
          )}
        </div>
      )}


      {pageTab === 'audit' && (
        <>
        <div className="flex flex-wrap gap-2 mb-4">
        <div className="min-w-[180px]">
          <AdminSelect sm value={entityFilter} onChange={setEntityFilter} options={entityOptions} />
        </div>
        <div className="min-w-[180px]">
          <AdminSelect sm value={actionFilter} onChange={setActionFilter} options={actionOptions} />
        </div>
        <button
          type="button"
          onClick={() => { setEntityFilter('all'); setActionFilter('all') }}
          className="text-xs px-3 py-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary flex items-center gap-1"
        >
          <Filter className="w-3.5 h-3.5" /> Reset
        </button>
        </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-surface-secondary" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-surface-secondary rounded w-3/4" />
                <div className="h-2 bg-surface-secondary rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-foreground-muted italic">No audit events yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            if (r.kind === 'image_group') {
              const repr = r.representative
              const meta = ENTITY_META.product_images
              const Icon = meta.Icon
              const summary = r.operation === 'replace'
                ? `Replaced image for "${r.productName || 'product'}"`
                : r.operation === 'create'
                  ? `Uploaded image for "${r.productName || 'product'}"`
                  : r.operation === 'delete'
                    ? `Deleted image from "${r.productName || 'product'}"`
                    : `Reordered images for "${r.productName || 'product'}"`
              const sideEffects = r.children.filter(c => c.id !== repr.id).length
              const isExpanded = expandedGroupId === r.id

              const renderThumb = (img: ImageGroup['oldImage'], state: 'old' | 'new' | 'placeholder') => {
                const ringColor = state === 'old' ? 'border-red-400/60' : state === 'new' ? 'border-emerald-400/60' : 'border-border-default'
                if (!img || !img.thumb) {
                  return (
                    <div className={`shrink-0 w-14 h-14 rounded border ${ringColor} bg-surface-secondary flex items-center justify-center`} title="No image">
                      <ImageIcon className="w-5 h-5 text-foreground-muted opacity-50" />
                    </div>
                  )
                }
                return (
                  <a
                    href={img.url || img.thumb}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`shrink-0 block w-14 h-14 rounded overflow-hidden border ${ringColor} bg-surface-secondary`}
                    title={img.name || 'View full image'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.thumb} alt={img.name || ''} className="w-full h-full object-cover" />
                  </a>
                )
              }

              return (
                <div key={r.id} className="bg-surface-elevated border border-border-default rounded-lg p-3">
                  <div className="flex gap-3 items-start">
                    <div className={`w-8 h-8 rounded-full ${meta.color} flex items-center justify-center text-white shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-6 gap-y-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase tracking-wide text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                            product_images.{r.operation}
                          </span>
                          <span className="text-[10px] text-foreground-muted">{relTime(repr.created_at)}</span>
                          {sideEffects > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedGroupId(isExpanded ? null : r.id)}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors flex items-center gap-1"
                            >
                              {isExpanded ? '−' : '+'}{sideEffects} cascading update{sideEffects !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-foreground mt-1 break-words">{summary}</p>
                        <p className="text-[11px] text-foreground-muted mt-0.5">
                          {actorLabel(repr)}{repr.ip_address ? ` · ${repr.ip_address}` : ''}
                        </p>
                      </div>

                      <div className="bg-surface-secondary/60 rounded p-2 flex items-center gap-3">
                        {r.operation === 'replace' && (
                          <>
                            {renderThumb(r.oldImage, 'old')}
                            <ArrowRight className="w-4 h-4 text-foreground-muted" />
                            {renderThumb(r.newImage, 'new')}
                          </>
                        )}
                        {r.operation === 'create' && (
                          <>
                            {renderThumb(null, 'placeholder')}
                            <ArrowRight className="w-4 h-4 text-foreground-muted" />
                            {renderThumb(r.newImage, 'new')}
                          </>
                        )}
                        {r.operation === 'delete' && (
                          <>
                            {renderThumb(r.oldImage, 'old')}
                            <ArrowRight className="w-4 h-4 text-foreground-muted" />
                            {renderThumb(null, 'placeholder')}
                          </>
                        )}
                        {r.operation === 'reorder' && (
                          <>
                            {renderThumb(r.newImage, 'new')}
                            <span className="text-[11px] text-foreground-muted">image order changed</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 border-l-2 border-border-default pl-3 space-y-2">
                      {r.children.map(child => {
                        const childRender = (raw: unknown, label: string | undefined) => {
                          if (label) return <>&quot;{label}&quot;</>
                          if (raw === null || raw === undefined) return <span className="text-foreground-muted italic">none</span>
                          if (typeof raw === 'boolean') return raw ? 'true' : 'false'
                          if (typeof raw === 'string' && raw.length > 40) return JSON.stringify(raw.slice(0, 40) + '…')
                          return JSON.stringify(raw)
                        }
                        return (
                          <div key={child.id} className="text-[11px]">
                            <div className="flex items-center gap-2">
                              <span className="font-mono uppercase text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                                {child.entity_type}.{child.action}
                              </span>
                              <span className="text-foreground-muted">{relTime(child.created_at)}</span>
                            </div>
                            <div className="mt-0.5 font-mono text-foreground-muted break-all">
                              {child.diff && Object.entries(child.diff).map(([k, v]) => {
                                const vAny = v as any
                                return (
                                  <span key={k} className="mr-3">
                                    <span className="text-foreground-muted">{k}:</span>{' '}
                                    <span className="text-red-500 line-through">{childRender(vAny.from, vAny.fromLabel)}</span>
                                    <span> → </span>
                                    <span className="text-emerald-600">{childRender(vAny.to, vAny.toLabel)}</span>
                                  </span>
                                )
                              })}
                              {!child.diff && <span className="italic">no field-level diff</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            if (r.kind === 'product_group') {
              const repr = r.representative
              const meta = ENTITY_META.products
              const Icon = meta.Icon
              const sideEffects = r.children.length - 1
              const isExpanded = expandedGroupId === r.id
              const reprDiff = repr.diff
              const reprActionTag = `${repr.entity_type}.${repr.action}`
              const childRender = (raw: unknown, label: string | undefined) => {
                if (label) return <>&quot;{label}&quot; <span className="text-foreground-muted opacity-60">({String(raw).slice(0, 8)}…)</span></>
                if (raw === null || raw === undefined) return <span className="text-foreground-muted italic">none</span>
                if (typeof raw === 'boolean') return raw ? 'true' : 'false'
                if (typeof raw === 'string' && raw.length > 60) return JSON.stringify(raw.slice(0, 60) + '…')
                return JSON.stringify(raw)
              }
              const tally: string[] = []
              if (r.variantCount) tally.push(`${r.variantCount} variant${r.variantCount !== 1 ? 's' : ''}`)
              if (r.subVariantCount) tally.push(`${r.subVariantCount} sub-variant${r.subVariantCount !== 1 ? 's' : ''}`)
              if (r.imageCount) tally.push(`${r.imageCount} image${r.imageCount !== 1 ? 's' : ''}`)
              if (r.parentTable) {
                const childCounts = r.children.reduce<Record<string, number>>((acc, c) => {
                  if (c.entity_type !== r.parentTable) acc[c.entity_type] = (acc[c.entity_type] || 0) + 1
                  return acc
                }, {})
                Object.entries(childCounts).forEach(([k, v]) => tally.push(`${v} ${k.replace(/_/g, ' ')}`))
              }
              return (
                <div key={r.id} className="bg-surface-elevated border border-border-default rounded-lg p-3">
                  <div className="flex gap-3 items-start">
                    <div className={`w-8 h-8 rounded-full ${meta.color} flex items-center justify-center text-white shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-6 gap-y-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase tracking-wide text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                            {reprActionTag}
                          </span>
                          <span className="text-[10px] text-foreground-muted">{relTime(repr.created_at)}</span>
                          {sideEffects > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedGroupId(isExpanded ? null : r.id)}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors flex items-center gap-1"
                            >
                              {isExpanded ? '−' : '+'}{sideEffects} cascading update{sideEffects !== 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-foreground mt-1 break-words">{repr.summary}</p>
                        {tally.length > 0 && (
                          <p className="text-[11px] text-foreground-muted mt-0.5">
                            also touched: {tally.join(' · ')}
                          </p>
                        )}
                        <p className="text-[11px] text-foreground-muted mt-0.5">
                          {actorLabel(repr)}{repr.ip_address ? ` · ${repr.ip_address}` : ''}
                        </p>
                      </div>

                      {reprDiff && Object.keys(reprDiff).length > 0 ? (
                        <div className="bg-surface-secondary/60 rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                          {Object.entries(reprDiff).map(([k, v]) => {
                            const vAny = v as any
                            return (
                              <div key={k} className="text-[11px] font-mono leading-snug break-all">
                                <span className="text-foreground-muted">{k}:</span>{' '}
                                <span className="text-red-500 line-through">{childRender(vAny.from, vAny.fromLabel)}</span>
                                <span className="text-foreground-muted"> → </span>
                                <span className="text-emerald-600">{childRender(vAny.to, vAny.toLabel)}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-foreground-muted italic self-center">
                          {repr.action === 'create' ? 'New product created' : repr.action === 'delete' ? 'Product deleted' : 'No direct fields changed on parent'}
                        </div>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 border-l-2 border-border-default pl-3 space-y-2">
                      {r.children.filter(c => c.id !== repr.id).map(child => (
                        <div key={child.id} className="text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono uppercase text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                              {child.entity_type}.{child.action}
                            </span>
                            <span className="text-foreground-muted">{relTime(child.created_at)}</span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5">{child.summary}</p>
                          {child.diff && (
                            <div className="mt-0.5 font-mono text-foreground-muted break-all">
                              {Object.entries(child.diff).map(([k, v]) => {
                                const vAny = v as any
                                return (
                                  <span key={k} className="mr-3">
                                    <span className="text-foreground-muted">{k}:</span>{' '}
                                    <span className="text-red-500 line-through">{childRender(vAny.from, vAny.fromLabel)}</span>
                                    <span> → </span>
                                    <span className="text-emerald-600">{childRender(vAny.to, vAny.toLabel)}</span>
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            const e = r
            const meta = ENTITY_META[e.entity_type] || { Icon: ScrollText, color: 'bg-zinc-500' }
            const Icon = meta.Icon
            const hasDiff = e.diff && Object.keys(e.diff).length > 0
            const renderSide = (raw: unknown, label: string | undefined) => {
              if (label) return <>&quot;{label}&quot; <span className="text-foreground-muted opacity-60">({String(raw).slice(0, 8)}…)</span></>
              if (raw === null || raw === undefined) return <span className="text-foreground-muted italic">none</span>
              if (typeof raw === 'boolean') return raw ? 'true' : 'false'
              if (typeof raw === 'string' && raw.length > 60) return JSON.stringify(raw.slice(0, 60) + '…')
              return JSON.stringify(raw)
            }
            return (
              <div key={e.id} className="bg-surface-elevated border border-border-default rounded-lg p-3">
                <div className="flex gap-3 items-start">
                  <div className={`w-8 h-8 rounded-full ${meta.color} flex items-center justify-center text-white shrink-0`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono uppercase tracking-wide text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                          {e.entity_type}.{e.action}
                        </span>
                        <span className="text-[10px] text-foreground-muted">{relTime(e.created_at)}</span>
                      </div>
                      <p className="text-sm text-foreground mt-1 break-words">{e.summary}</p>
                      <p className="text-[11px] text-foreground-muted mt-0.5">
                        {actorLabel(e)}{e.ip_address ? ` · ${e.ip_address}` : ''}
                      </p>
                    </div>

                    {hasDiff ? (
                      <div className="bg-surface-secondary/60 rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                        {(e.entity_type === 'product_images' || e.entity_type === 'variant_images') && e.metadata?.thumbnail_url && (
                          <a
                            href={e.metadata.image_url || e.metadata.thumbnail_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="float-right ml-2 mb-1 block w-12 h-12 rounded overflow-hidden border border-border-default bg-surface"
                            title={e.metadata.file_name || 'View full image'}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.metadata.thumbnail_url} alt={e.metadata.file_name || ''} className="w-full h-full object-cover" />
                          </a>
                        )}
                        {Object.entries(e.diff!).map(([k, v]) => {
                          const vAny = v as any
                          return (
                            <div key={k} className="text-[11px] font-mono leading-snug break-all">
                              <span className="text-foreground-muted">{k}:</span>{' '}
                              <span className="text-red-500 line-through">{renderSide(vAny.from, vAny.fromLabel)}</span>
                              <span className="text-foreground-muted"> → </span>
                              <span className="text-emerald-600">{renderSide(vAny.to, vAny.toLabel)}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (e.entity_type === 'product_images' || e.entity_type === 'variant_images') && e.metadata?.thumbnail_url ? (
                      <div className="bg-surface-secondary/60 rounded p-2 flex items-center gap-3 self-center w-full">
                        <a
                          href={e.metadata.image_url || e.metadata.thumbnail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 block w-14 h-14 rounded overflow-hidden border border-border-default bg-surface"
                          title={e.metadata.file_name || 'View full image'}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={e.metadata.thumbnail_url} alt={e.metadata.file_name || ''} className="w-full h-full object-cover" />
                        </a>
                        <span className="text-[11px] text-foreground-muted italic">
                          {e.action === 'create' ? 'New image uploaded' : e.action === 'delete' ? 'Image removed' : 'Image updated'}
                        </span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-foreground-muted italic self-center">
                        {e.action === 'create' ? 'New record created' : e.action === 'delete' ? 'Record deleted' : 'No field-level diff'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && total > 0 && (() => {
        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        const from = (page - 1) * pageSize + 1
        const to = Math.min(page * pageSize, total)
        return (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border-default pt-4">
            <p className="text-xs text-foreground-muted">
              Showing <span className="font-medium text-foreground">{from}–{to}</span> of <span className="font-medium text-foreground">{total}</span>
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-foreground-muted">Per page</span>
                <AdminSelect
                  sm
                  value={String(pageSize)}
                  onChange={v => setPageSize(parseInt(v, 10))}
                  options={[
                    { value: '25', label: '25' },
                    { value: '50', label: '50' },
                    { value: '100', label: '100' },
                    { value: '200', label: '200' },
                  ]}
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"
                  title="First page"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"
                  title="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs px-2 text-foreground">
                  Page <span className="font-medium">{page}</span> of <span className="font-medium">{totalPages}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"
                  title="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary disabled:opacity-40"
                  title="Last page"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )
      })()}
        </>
      )}
    </div>
  )
}
