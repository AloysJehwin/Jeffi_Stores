'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnPrimary, inputCls, Kpi, KpiGrid, Section, Table, when, type Col } from '@/components/admin/kit/core'
import type { Tone } from '@/components/admin/kit/tones'
import { useActionToast } from '@/components/admin/kit/toast'
import type { AdminDomainRow } from '@controller/lib/domains/admin'
import type { DomainPricingSettings } from '@controller/lib/domains/pricing'

type View = { domains: AdminDomainRow[]; settings: DomainPricingSettings; defaults: DomainPricingSettings; live: boolean; usdInr: number }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const usd = (n: number) => `$${n.toFixed(2)}`
const LIVE = ['active', 'configuring']
const TONE: Record<string, Tone> = { active: 'green', configuring: 'blue', registering: 'blue', requested: 'amber', failed: 'red', cancelled: 'muted', expired: 'red' }
const RENEWAL_TONE: Record<string, Tone> = { done: 'green', renewing: 'blue', due: 'amber', off: 'muted', lapsed: 'red' }

/** Ecom Store → Domains: every bought domain and the margin setting. */
export default function DomainsClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [form, setForm] = useState({ marginPct: 25, renewLeadDays: 30, renewCutoffDays: 3, tlds: '' })
  const [saving, setSaving] = useState(false)

  const load = (v: View) => {
    setView(v)
    setForm({ marginPct: v.settings.marginPct, renewLeadDays: v.settings.renewLeadDays, renewCutoffDays: v.settings.renewCutoffDays, tlds: v.settings.tlds.join(', ') })
  }
  useEffect(() => {
    api<View>('/api/admin/ecom/domains').then(({ ok, data }) => ok && load(data))
  }, [])

  const stats = useMemo(() => {
    const rows = view?.domains ?? []
    const live = rows.filter(r => LIVE.includes(r.status))
    const yearInr = live.reduce((a, r) => a + (r.renewal?.priceInr ?? r.priceInr), 0)
    const yearCostInr = live.reduce((a, r) => a + (r.renewal?.costUsd ?? r.costUsd) * r.usdInr, 0)
    const atRisk = live.filter(r => r.renewal && ['due', 'lapsed'].includes(r.renewal.status) && (r.renewal.status === 'lapsed' || r.renewal.attempts > 0)).length
    return { live: live.length, yearInr, yearCostInr, atRisk, failed: rows.filter(r => r.status === 'failed').length }
  }, [view])

  if (!view) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />

  async function save() {
    setSaving(true)
    const { ok, data } = await api<{ settings: DomainPricingSettings }>('/api/admin/ecom/domains', {
      method: 'PUT',
      json: { marginPct: Number(form.marginPct), renewLeadDays: Number(form.renewLeadDays), renewCutoffDays: Number(form.renewCutoffDays), tlds: form.tlds.split(/[\s,]+/).filter(Boolean) },
    })
    setSaving(false)
    if (!ok) return toast.error(data.error || 'Could not save the domain settings.')
    load({ ...view!, settings: data.settings })
    toast.success('Saved. New searches and renewals use the new margin; bought years keep their price.')
  }

  const cols: Col<AdminDomainRow>[] = [
    { key: 'domain', label: 'Domain', render: r => <span className="font-mono">{r.domain}</span>, sort: r => r.domain },
    {
      key: 'store',
      label: 'Store',
      render: r => (
        <Link href={`/admin/ecom/customers/${r.tenantId}/view`} className="hover:underline">
          {r.storeName || r.slug}
        </Link>
      ),
      sort: r => r.slug,
    },
    {
      key: 'status',
      label: 'Status',
      render: r => (
        <span title={r.lastError ?? undefined}>
          <Badge tone={TONE[r.status] ?? 'muted'}>{r.status === 'configuring' ? `setting up · ${r.step}` : r.status}</Badge>
          {!r.contactVerified && r.status === 'active' && <span className="ml-1 text-xs text-foreground-muted">email unconfirmed</span>}
        </span>
      ),
      sort: r => r.status,
    },
    { key: 'registered', label: 'Registered', render: r => when(r.registeredAt), sort: r => r.registeredAt ?? '' },
    { key: 'expires', label: 'Expires', render: r => when(r.expiresAt), sort: r => r.expiresAt ?? '' },
    {
      key: 'renewal',
      label: 'Renewal',
      render: r =>
        r.renewal ? (
          <span title={r.renewal.lastError ?? undefined}>
            <Badge tone={RENEWAL_TONE[r.renewal.status] ?? 'muted'}>{r.renewal.status}</Badge>
            {r.renewal.attempts > 0 && r.renewal.status === 'due' && <span className="ml-1 text-xs text-foreground-muted">{r.renewal.attempts} tries</span>}
          </span>
        ) : r.expiresAt && LIVE.includes(r.status) ? (
          <span className="text-xs text-foreground-muted">opens {when(new Date(new Date(r.expiresAt).getTime() - view.settings.renewLeadDays * 86400_000).toISOString())}</span>
        ) : (
          '-'
        ),
    },
    { key: 'auto', label: 'Auto-renew', render: r => (r.autoRenew ? 'On' : 'Off') },
    { key: 'cost', label: 'AWS cost', num: true, render: r => <span title={`${usd(r.costUsd)} at ₹${r.usdInr}/$`}>{inr(r.costUsd * r.usdInr)}</span>, sort: r => r.costUsd * r.usdInr },
    { key: 'price', label: 'Charged', num: true, render: r => (r.refundedInr ? <span className="line-through text-foreground-muted">{inr(r.priceInr)}</span> : inr(r.priceInr)), sort: r => r.priceInr },
    {
      key: 'margin',
      label: 'Margin',
      num: true,
      render: r => (r.refundedInr || !['active', 'configuring', 'expired', 'registering'].includes(r.status) ? '-' : `${inr(r.priceInr - r.costUsd * r.usdInr + r.renewedInr - r.renewedCostUsd * r.usdInr)} (${Math.round(r.margin * 100)}%)`),
      sort: r => r.priceInr - r.costUsd * r.usdInr,
    },
  ]

  const margin = Number(form.marginPct) || 0
  return (
    <div className="space-y-4 min-w-0">
      {!view.live && <p className="text-xs text-foreground-muted">Registrar: fake (local / test). Nothing is registered at AWS until DOMAIN_REGISTRAR=route53 in production.</p>}
      <KpiGrid>
        <Kpi label="Live domains" value={String(stats.live)} sub={stats.failed ? `${stats.failed} failed (refunded)` : undefined} />
        <Kpi label="Yearly revenue" value={inr(stats.yearInr)} sub="next renewals at current price" />
        <Kpi label="Yearly AWS cost" value={inr(stats.yearCostInr)} sub={`margin ${inr(stats.yearInr - stats.yearCostInr)}`} />
        <Kpi label="Renewals at risk" value={String(stats.atRisk)} sub="wallet short or lapsed" highlight={stats.atRisk > 0} />
      </KpiGrid>

      <Section title="Bought domains">
        <Table rows={view.domains} cols={cols} rowKey={r => r.id} empty="No store has bought a domain yet." noun="domains" />
      </Section>

      <Section title="Pricing and renewal">
        <div className="space-y-4">
          <p className="text-xs text-foreground-muted">
            A domain costs the store AWS&apos;s yearly price × the server-pricing USD rate × (1 + margin), rounded up to the rupee, from its wallet. Renewals are charged
            from the renewal window; one still unpaid at the cut-off is not renewed and the domain expires. AWS auto-renew is always off.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="text-sm">
              <span className="text-foreground-secondary">Margin (%)</span>
              <input type="number" min={0} max={500} value={form.marginPct} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, marginPct: Number(e.target.value) }))} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-foreground-secondary">Renewal window (days before expiry)</span>
              <input type="number" min={7} max={60} value={form.renewLeadDays} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, renewLeadDays: Number(e.target.value) }))} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm">
              <span className="text-foreground-secondary">Give up (days before expiry)</span>
              <input type="number" min={1} max={30} value={form.renewCutoffDays} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, renewCutoffDays: Number(e.target.value) }))} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-sm sm:col-span-3">
              <span className="text-foreground-secondary">TLDs offered, in order</span>
              <input value={form.tlds} disabled={!canWrite} onChange={e => setForm(f => ({ ...f, tlds: e.target.value }))} className={`${inputCls} mt-1 font-mono`} />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default pt-3">
            <p className="text-sm text-foreground">
              Example: a $15.00 .com is <span className="font-semibold">{inr(Math.ceil(15 * view.usdInr * (1 + margin / 100)))}/year</span> at {margin}% and ₹{view.usdInr}/$
              {margin !== view.settings.marginPct && <span className="text-foreground-muted"> (now {view.settings.marginPct}%)</span>}
            </p>
            {canWrite && (
              <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}
