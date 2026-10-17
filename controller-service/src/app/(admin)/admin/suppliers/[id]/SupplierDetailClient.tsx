'use client'

import { useEffect, useState } from 'react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { Tabs } from '@/components/admin/kit/core'
import { DetailHeader } from '@/components/admin/kit/actions'
import { Card, Field, Fields, PageBody } from '@/components/admin/kit/layout'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { DetailSkeleton, ErrorState } from '@/components/admin/kit/states'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { badgeCls } from '@/components/admin/kit/tones'
import { formatINR as formatINRBase, formatDate } from '@/lib/shared/format'

const formatINR = (n: number) => formatINRBase(n, 0)

const DOC_STATUS: StatusMap = {
  paid: { label: 'Paid', tone: 'green' },
  partial: { label: 'Partial', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'red' },
  pending: { label: 'Pending', tone: 'amber' },
  ordered: { label: 'Ordered', tone: 'blue' },
  draft: { label: 'Draft', tone: 'muted' },
  sent: { label: 'Sent', tone: 'blue' },
  received: { label: 'Received', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}

type Tab = 'pos' | 'expenses' | 'products'
const VALID_TABS: Tab[] = ['pos', 'expenses', 'products']

const muted = 'text-foreground-secondary'
const money = (v: unknown) => <span className="font-semibold text-foreground">{formatINR(parseFloat(String(v || '0')))}</span>
const dateCell = (v: unknown) => <span className={`${muted} whitespace-nowrap`}>{formatDate(v as string)}</span>

export default function SupplierDetailClient({
  id,
  hasDraft = false,
  startDraftAction,
}: {
  id: string
  hasDraft?: boolean
  startDraftAction?: (formData: FormData) => void | Promise<void>
}) {
  const canFinancial = useHasScope('financial:read')
  const canInventoryWrite = useHasScope('inventory:write')
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const initialTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'pos'

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState<Tab>(initialTab)

  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(ap(`/admin/suppliers/${id}/view?${params.toString()}`), { scroll: false })
  }

  useEffect(() => {
    fetch(`/api/admin/suppliers/${id}`)
      .then(r => r.json())
      .then(j => {
        setData(j)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const listHref = ap('/admin/suppliers?tab=suppliers')

  if (!loading && !data?.supplier) {
    return (
      <PageBody>
        <ErrorState
          title="Supplier not found."
          body={data?.error ? <span className="font-mono">{data.error}</span> : undefined}
          actionNode={
            <Link href={listHref} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
              Back to Suppliers
            </Link>
          }
        />
      </PageBody>
    )
  }

  if (loading || !data?.supplier) {
    return (
      <PageBody>
        <DetailSkeleton kpis={3} />
      </PageBody>
    )
  }

  const s = data.supplier
  const pos: any[] = data.pos || []
  const expenses: any[] = data.expenses || []
  const linkedProducts: any[] = data.linkedProducts || []
  const purchasedProducts: any[] = data.purchasedProducts || []

  const poCols: DataCol<any>[] = [
    {
      key: 'po',
      label: 'PO #',
      sort: r => String(r.po_number ?? ''),
      render: r => (
        <Link href={ap(`/admin/purchase-orders?tab=orders&po=${r.po_number}`)} className="font-mono font-medium text-accent-500 hover:underline">
          {r.po_number}
        </Link>
      ),
    },
    { key: 'date', label: 'Date', sort: r => String(r.order_date ?? ''), render: r => dateCell(r.order_date) },
    { key: 'expected', label: 'Expected', hideBelow: 'sm', sort: r => String(r.expected_date ?? ''), render: r => dateCell(r.expected_date) },
    { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} map={DOC_STATUS} /> },
    { key: 'amount', label: 'Amount', num: true, sort: r => parseFloat(r.total_amount || '0'), render: r => money(r.total_amount) },
  ]

  const expenseCols: DataCol<any>[] = [
    {
      key: 'bill',
      label: 'Bill #',
      sort: r => String(r.expense_number ?? ''),
      render: r =>
        canFinancial ? (
          <Link href={ap(`/admin/financial/payables/${r.id}/view`)} className="font-mono font-medium text-accent-500 hover:underline">
            {r.expense_number}
          </Link>
        ) : (
          <span className="font-mono font-medium text-foreground">{r.expense_number}</span>
        ),
    },
    { key: 'po', label: 'PO #', hideBelow: 'md', render: r => <span className="font-mono text-xs text-foreground-secondary">{r.po_number || '—'}</span> },
    { key: 'date', label: 'Date', sort: r => String(r.expense_date ?? ''), render: r => dateCell(r.expense_date) },
    {
      key: 'due',
      label: 'Due',
      sort: r => String(r.due_date ?? ''),
      render: r => (
        <span className={`whitespace-nowrap ${new Date(r.due_date) < new Date() && r.status !== 'paid' ? 'text-red-500 font-medium' : muted}`}>
          {formatDate(r.due_date)}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} map={DOC_STATUS} /> },
    { key: 'amount', label: 'Amount', num: true, sort: r => parseFloat(r.total_amount || '0'), render: r => money(r.total_amount) },
  ]

  const productLink = (r: any) => (
    <Link href={ap(`/admin/products/${r.product_id}`)} className="font-medium text-accent-500 hover:underline">
      {r.product_name}
    </Link>
  )
  const variantCell = (r: any) => <span className={muted}>{r.sub_variant_name || r.variant_name || '—'}</span>
  const linkedCols: DataCol<any>[] = [
    { key: 'product', label: 'Product', sort: r => String(r.product_name ?? ''), render: productLink },
    { key: 'variant', label: 'Variant / Sub-variant', render: variantCell },
    { key: 'cost', label: 'Buy Price', num: true, sort: r => parseFloat(r.unit_cost || '0'), render: r => money(r.unit_cost) },
    { key: 'pref', label: 'Preferred', render: r => <span className={muted}>{r.is_preferred ? '★' : '—'}</span> },
    { key: 'moq', label: 'MOQ', num: true, hideBelow: 'md', render: r => <span className={muted}>{r.moq ?? '—'}</span> },
    { key: 'lead', label: 'Lead (days)', num: true, hideBelow: 'md', render: r => <span className={muted}>{r.lead_time_days ?? '—'}</span> },
  ]
  const purchasedCols: DataCol<any>[] = [
    { key: 'product', label: 'Product', sort: r => String(r.product_name ?? ''), render: productLink },
    { key: 'variant', label: 'Variant', render: variantCell },
    { key: 'qty', label: 'Total Qty', num: true, sort: r => Number(r.total_qty || 0), render: r => <span className="text-foreground">{Number(r.total_qty || 0)}</span> },
    { key: 'last_cost', label: 'Last Unit Cost', num: true, sort: r => parseFloat(r.last_unit_cost || '0'), render: r => money(r.last_unit_cost) },
    { key: 'last_order', label: 'Last Ordered', hideBelow: 'md', sort: r => String(r.last_order_date ?? ''), render: r => dateCell(r.last_order_date) },
    { key: 'pos', label: 'POs', num: true, render: r => <span className={muted}>{r.po_count ?? 0}</span> },
  ]

  const link = (href: string, text: string) => (
    <a href={href} className="text-accent-500 hover:underline">
      {text}
    </a>
  )
  const bold = (v: ReactNodeLike) => <span className="font-semibold tabular-nums">{v}</span>

  return (
    <PageBody>
      <DetailHeader
        back={{ href: listHref, label: 'Suppliers' }}
        title={s.name}
        status={
          <>
            {!s.is_active && <span className={badgeCls('muted')}>Inactive</span>}
            {hasDraft && <span className={badgeCls('amber')}>Draft pending</span>}
          </>
        }
        identifiers={s.gstin ? [{ label: 'GSTIN', value: s.gstin, copy: true }] : undefined}
        secondary={[{ key: 'all', label: 'All Suppliers', href: listHref }]}
        actions={
          canInventoryWrite ? (
            hasDraft ? (
              <Link
                href={ap(`/admin/suppliers/${id}/edit`)}
                className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                Edit Draft
              </Link>
            ) : startDraftAction ? (
              <form action={startDraftAction}>
                <button
                  type="submit"
                  className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600"
                >
                  Edit
                </button>
              </form>
            ) : null
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <Card title="Contact">
          <Fields cols={1}>
            <Field label="Contact" value={s.contact_name} />
            <Field label="Phone" value={s.phone ? link(`tel:+91${s.phone}`, `+91 ${s.phone}`) : null} />
            <Field label="Email" value={s.email ? link(`mailto:${s.email}`, s.email) : null} />
            <Field label="Address" value={s.address} />
          </Fields>
        </Card>

        <Card title="GST & Payment">
          <Fields cols={1}>
            <Field label="GSTIN" value={s.gstin} mono />
            <Field label="Payment Terms" value={s.payment_terms ? `${s.payment_terms} days` : null} />
            <Field label="Bank" value={s.bank_name} />
            <Field label="Account" value={s.account_number} mono />
            <Field label="IFSC" value={s.ifsc} mono />
            <Field label="UPI" value={s.upi_id} mono />
          </Fields>
        </Card>

        <Card title="Summary">
          <Fields cols={2}>
            <Field label="Total POs" value={bold(s.po_count)} />
            <Field label="PO Value" value={bold(formatINR(parseFloat(s.po_total || '0')))} />
            <Field label="Total Bills" value={bold(s.expense_count)} />
            <Field label="Bills Value" value={bold(formatINR(parseFloat(s.expense_total || '0')))} />
          </Fields>
        </Card>
      </div>

      <div className="space-y-4">
        <Tabs
          tabs={[
            { id: 'pos' as Tab, label: `Purchase Orders (${pos.length})` },
            { id: 'expenses' as Tab, label: `Bills / Expenses (${expenses.length})` },
            { id: 'products' as Tab, label: `Products (${linkedProducts.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'pos' && (
          <Card flush>
            <DataTable rows={pos} cols={poCols} rowKey={r => String(r.id)} empty="No purchase orders found" bare />
          </Card>
        )}

        {tab === 'expenses' && (
          <Card flush>
            <DataTable rows={expenses} cols={expenseCols} rowKey={r => String(r.id)} empty="No bills/expenses found" bare />
          </Card>
        )}

        {tab === 'products' && (
          <div className="space-y-4">
            <Card title="Linked (buy-price list)" flush>
              <DataTable
                rows={linkedProducts}
                cols={linkedCols}
                rowKey={r => `${r.product_id}-${r.variant_id || ''}-${r.sub_variant_id || ''}-${linkedProducts.indexOf(r)}`}
                empty="No products linked to this supplier"
                bare
              />
            </Card>
            <Card title="Purchased (from POs)" flush>
              <DataTable
                rows={purchasedProducts}
                cols={purchasedCols}
                rowKey={r => `${r.product_id}-${r.variant_id || ''}-${purchasedProducts.indexOf(r)}`}
                empty="No purchases recorded from this supplier"
                bare
              />
            </Card>
          </div>
        )}
      </div>

      {s.notes && (
        <Card title="Notes">
          <p className="text-sm text-foreground whitespace-pre-wrap">{s.notes}</p>
        </Card>
      )}
    </PageBody>
  )
}

type ReactNodeLike = string | number | null | undefined
