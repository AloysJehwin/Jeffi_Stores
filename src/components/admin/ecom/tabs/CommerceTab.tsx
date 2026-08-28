import Link from 'next/link'
import type { TenantDetail, BankAccount } from '@/lib/tenant-registry'
import { Field, FieldGrid, Mono, Section, StatusPill } from '../EcomUI'

type Billing = Awaited<ReturnType<typeof import('@/lib/tenant-registry').getTenantBilling>> | null

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function maskAccount(n: string | null): string {
  if (!n) return '—'
  return n.length <= 4 ? n : `••••${n.slice(-4)}`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary px-4 py-3 min-w-0">
      <div className="text-xs uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 break-words ${
        tone === 'good' ? 'text-green-600 dark:text-green-400'
        : tone === 'bad' ? 'text-red-600 dark:text-red-400'
        : 'text-foreground'
      }`}>{value}</div>
    </div>
  )
}

export default function CommerceTab({
  tenant: t, billing, bank,
}: {
  tenant: TenantDetail
  billing: Billing
  bank: BankAccount | null
}) {
  const txns = billing?.transactions ?? []
  const ledger = billing?.ledger ?? []
  const totals = billing?.totals

  const cod = txns.filter(x => x.is_cod)
  const codGross = cod.reduce((s, x) => s + Number(x.gross_amount), 0)
  const prepaidGross = (totals?.gross ?? 0) - codGross

  return (
    <div className="space-y-6 min-w-0">
      <Section
        title="Money"
        action={
          <Link href={`/admin/ecom/billing/${t.id}`} className="text-sm text-accent-600 dark:text-accent-400 hover:underline">
            Full billing →
          </Link>
        }
      >
        {!billing || txns.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            No transactions recorded for this store yet, so there is nothing to settle.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="GMV" value={inr(totals!.gross)} />
              <Stat label="Your commission" value={inr(totals!.commission)} />
              <Stat label="Gateway fees" value={inr(totals!.fees)} />
              <Stat label="Store share" value={inr(totals!.tenantShare)} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <Stat
                label="Settlement balance"
                value={inr(billing.balance)}
                tone={billing.balance >= 0 ? 'good' : 'bad'}
              />
              <Stat label="Transactions" value={String(txns.length)} />
              <Stat label="Prepaid" value={inr(prepaidGross)} />
              <Stat label="COD" value={`${inr(codGross)} · ${cod.length}`} />
            </div>
          </>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Payout account">
          {!bank ? (
            <p className="text-sm text-foreground-muted">
              No payout account on file. Settlements cannot be released to this store.
            </p>
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
                  value={<span className="text-amber-600 dark:text-amber-400 text-xs">
                    entered “{bank.holder_name}”, bank returned “{bank.verified_name}”
                  </span>}
                />
              )}
            </FieldGrid>
          )}
        </Section>

        <Section title="Settlement ledger">
          {ledger.length === 0 ? (
            <p className="text-sm text-foreground-muted">No ledger entries.</p>
          ) : (
            <ul className="space-y-2.5">
              {ledger.slice(0, 8).map((e) => {
                const amt = Number(e.amount)
                return (
                  <li key={e.id} className="flex items-start justify-between gap-3 text-sm min-w-0">
                    <div className="min-w-0">
                      <div className="text-foreground capitalize">{e.entry_type.replace(/_/g, ' ')}</div>
                      {e.note && <div className="text-xs text-foreground-muted break-words">{e.note}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className={amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {amt >= 0 ? '+' : ''}{inr(amt)}
                      </div>
                      <div className="text-xs text-foreground-muted">
                        {new Date(e.occurred_at).toLocaleDateString('en-IN')}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      {txns.length > 0 && (
        <Section title="Recent transactions">
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[40rem]">
              <thead className="text-foreground-muted">
                <tr className="text-left border-b border-border-default">
                  <th className="pb-2 font-medium">Order</th>
                  <th className="pb-2 font-medium">Gross</th>
                  <th className="pb-2 font-medium">Commission</th>
                  <th className="pb-2 font-medium">Fee</th>
                  <th className="pb-2 font-medium">Mode</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {txns.slice(0, 15).map((x) => (
                  <tr key={x.id}>
                    <td className="py-2.5"><Mono>{x.order_ref || '—'}</Mono></td>
                    <td className="py-2.5 text-foreground">{inr(Number(x.gross_amount))}</td>
                    <td className="py-2.5 text-foreground-muted">{inr(Number(x.platform_commission))}</td>
                    <td className="py-2.5 text-foreground-muted">{inr(Number(x.gateway_fee))}</td>
                    <td className="py-2.5 text-xs text-foreground-muted">{x.is_cod ? 'COD' : x.gateway}</td>
                    <td className="py-2.5"><StatusPill status={x.status} /></td>
                    <td className="py-2.5 text-xs text-foreground-muted">
                      {new Date(x.occurred_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txns.length > 15 && (
            <p className="text-xs text-foreground-muted mt-3">
              Showing 15 of {txns.length}. <Link href={`/admin/ecom/billing/${t.id}`} className="text-accent-600 dark:text-accent-400 hover:underline">See all →</Link>
            </p>
          )}
        </Section>
      )}
    </div>
  )
}
