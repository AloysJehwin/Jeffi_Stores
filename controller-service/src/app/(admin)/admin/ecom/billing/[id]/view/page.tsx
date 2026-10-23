import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { Card, PageHeader } from '@/components/admin/kit/layout'
import { LedgerTable, TransactionsTable } from '../BillingTables'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant, getTenantBilling } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import DnsResyncButton from '../DnsResyncButton'
import ReconcileButton from '../ReconcileButton'

export const dynamic = 'force-dynamic'

const inr = (n: number | string) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const LEDGER_LABEL: Record<string, string> = {
  order_capture: 'Order capture (tenant share)',
  commission: 'Platform commission',
  gateway_fee: 'Gateway fee',
  subscription_charge: 'Subscription charge',
  cod_remittance: 'COD remittance',
  delhivery_correction: 'Delhivery charge correction',
  refund: 'Refund',
  payout: 'Payout to tenant',
  adjustment: 'Adjustment',
}

export default async function TenantBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()
  const { transactions, ledger, balance, totals } = await getTenantBilling(id)

  const tile = (label: string, value: string, tone = 'text-foreground') => (
    <div className="rounded-xl border border-border-default p-4 bg-surface-elevated">
      <div className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</div>
      <div className={`text-lg sm:text-xl font-bold tabular-nums break-words ${tone}`}>{value}</div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader back={{ href: '/admin/ecom/billing', label: 'Billing' }} title={`${t.display_name}: Billing`} badges={<StatusPill status={t.status} />} />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        {tile('Settlement balance', inr(balance), balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}
        {tile('GMV', inr(totals.gross))}
        {tile('Tenant share', inr(totals.tenantShare))}
        {tile('Your commission', inr(totals.commission), 'text-accent-600')}
        {tile('Gateway fees', inr(totals.fees))}
        <ReconcileButton tenantId={id} />
        <DnsResyncButton tenantId={id} />
      </div>

      <Card title="Transactions & splits" flush>
        <TransactionsTable rows={transactions} />
      </Card>

      <Card title="Settlement ledger">
        <LedgerTable rows={ledger} labels={LEDGER_LABEL} balance={balance} />
      </Card>
    </div>
  )
}
