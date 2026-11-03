import Link from 'next/link'
import type { TenantDetail, BankAccount, TenantBilling } from '@/lib/tenant-registry'
import { Field, FieldGrid, Mono, Section, StatusPill } from '../EcomUI'
import { inr } from '../cells'
import { LedgerTable, TransactionsTable } from '../detail/BillingTables'
import Pager from '../detail/Pager'
import { detailHref } from '../detail/labels'

function maskAccount(n: string | null): string {
  if (!n) return '—'
  return n.length <= 4 ? n : `••••${n.slice(-4)}`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary px-3 py-2.5 sm:px-4 sm:py-3 min-w-0">
      <div className="text-[11px] sm:text-xs uppercase tracking-wide text-foreground-muted truncate">{label}</div>
      <div
        className={`text-base sm:text-lg font-semibold mt-0.5 tabular-nums break-words ${
          tone === 'good' ? 'text-green-600 dark:text-green-400' : tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export interface PageInfo {
  page: number
  pageSize: number
  href: (page: number) => string
}

export default function CommerceTab({
  tenant: t,
  billing,
  bank,
  txPage,
  ledgerPage,
}: {
  tenant: TenantDetail
  billing: TenantBilling | null
  bank: BankAccount | null
  txPage: PageInfo
  ledgerPage: PageInfo
}) {
  const totals = billing?.totals
  const prepaidGross = (totals?.gross ?? 0) - (totals?.codGross ?? 0)

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <Section
        title="Money"
        action={
          <Link href={detailHref(t.id, 'billing')} className="text-sm text-accent-600 hover:underline">
            Full billing →
          </Link>
        }
      >
        {!billing || billing.transactionCount === 0 ? (
          <p className="text-sm text-foreground-muted">No transactions recorded for this store yet, so there is nothing to settle.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Stat label="GMV" value={inr(totals!.gross, 2)} />
            <Stat label="Your commission" value={inr(totals!.commission, 2)} />
            <Stat label="Gateway fees" value={inr(totals!.fees, 2)} />
            <Stat label="Store share" value={inr(totals!.tenantShare, 2)} />
            <Stat label="Settlement balance" value={inr(billing.balance, 2)} tone={billing.balance >= 0 ? 'good' : 'bad'} />
            <Stat label="Transactions" value={billing.transactionCount.toLocaleString('en-IN')} />
            <Stat label="Prepaid" value={inr(prepaidGross, 2)} />
            <Stat label="COD" value={inr(totals!.codGross, 2)} />
          </div>
        )}
      </Section>

      <Section title="Payout account">
        {!bank ? (
          <p className="text-sm text-foreground-muted">No payout account on file. Settlements cannot be released to this store.</p>
        ) : (
          <FieldGrid>
            <Field label="Status" value={<StatusPill status={bank.verification_status} />} />
            <Field label="Holder" value={bank.verified_name || bank.holder_name} />
            <Field label="Account" value={<Mono>{maskAccount(bank.account_number)}</Mono>} />
            <Field label="IFSC" value={<Mono>{bank.ifsc || '—'}</Mono>} />
            {bank.upi_id && <Field wide label="UPI" value={<Mono>{bank.upi_id}</Mono>} />}
            {bank.verified_name && bank.holder_name && bank.verified_name !== bank.holder_name && (
              <Field
                wide
                label="Name mismatch"
                value={
                  <span className="text-amber-600 dark:text-amber-400 text-xs">
                    entered “{bank.holder_name}”, bank returned “{bank.verified_name}”
                  </span>
                }
              />
            )}
          </FieldGrid>
        )}
      </Section>

      {billing && (
        <>
          <Section title="Transactions">
            <TransactionsTable rows={billing.transactions} total={billing.transactionCount} />
            <Pager {...txPage} total={billing.transactionCount} />
          </Section>
          <Section title="Settlement ledger">
            <LedgerTable rows={billing.ledger} total={billing.ledgerCount} balance={billing.balance} />
            <Pager {...ledgerPage} total={billing.ledgerCount} />
          </Section>
        </>
      )}
    </div>
  )
}
