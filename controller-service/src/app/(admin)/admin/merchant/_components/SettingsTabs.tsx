'use client'

import { useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useHasScope } from '@/contexts/AdminScopesContext'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import Select from '@/components/ui/Select'
import { Badge, Empty, Section, Table, btnGhost, btnPrimary, inputCls, money, when } from '@/components/admin/channels/ui'

const ACTIONS = '/api/admin/merchant/console/actions'
const useCanEditSettings = () => useHasScope('merchant_sync:settings_write')

const SEV_TONE: Record<string, 'red' | 'amber' | 'muted'> = { CRITICAL: 'red', ERROR: 'amber' }

export function AccountView({ d }: { d: any }) {
  return (
    <div className="space-y-5">
      <Section title="Account issues">
        {!d?.issues?.length ? (
          <Empty msg="No account issues reported by Google." />
        ) : (
          <ul className="space-y-2">
            {d.issues.map((i: any) => (
              <li key={i.name} className="rounded-lg border border-border-default p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={SEV_TONE[i.severity] ?? 'muted'}>{i.severity}</Badge>
                  <span className="font-medium">{i.title}</span>
                </div>
                {i.detail && <p className="text-xs text-foreground-muted mt-1">{i.detail}</p>}
                {i.documentation_uri && (
                  <a href={i.documentation_uri} target="_blank" rel="noreferrer" className="text-xs text-accent-500 underline inline-flex items-center gap-1 mt-1">
                    How to fix <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Programs">
        {!d?.programs?.length ? (
          <Empty msg="Refresh reports to load your programs." />
        ) : (
          <Table
            rows={d.programs}
            rowKey={(p: any) => p.name}
            cols={[
              { key: 'name', label: 'Program', render: (p: any) => String(p.name).split('/').pop()?.replace(/-/g, ' ') },
              { key: 'state', label: 'State', render: (p: any) => <Badge tone={p.state === 'ENABLED' ? 'green' : p.state === 'NOT_ELIGIBLE' ? 'red' : 'amber'}>{p.state}</Badge> },
              {
                key: 'unmet',
                label: 'Still needed',
                render: (p: any) => (p.unmetRequirements ?? []).map((u: any) => u.title).join(', ') || '-',
              },
              { key: 'doc', label: '', render: (p: any) => (p.documentationUri ? <a href={p.documentationUri} target="_blank" rel="noreferrer" className="text-xs text-accent-500 underline">Help</a> : null) },
            ]}
          />
        )}
        <p className="text-xs text-foreground-muted mt-3">Refreshed {when(d?.refreshedAt)}</p>
      </Section>
    </div>
  )
}

const iso = (d: Date) => d.toISOString()

export function PromotionsView({ d, onChanged }: { d: any; onChanged: () => void }) {
  const canEdit = useCanEditSettings()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const promotions = d?.promotions ?? []
  const promoProgram = (d?.programs ?? []).find((p: any) => /promotion/i.test(p.name))
  return (
    <Section title="Promotions" action={canEdit ? <IconButton icon={Plus} label="New promotion" onClick={() => setCreating(c => !c)} /> : undefined}>
      {promoProgram && promoProgram.state !== 'ENABLED' && (
        <p className="text-xs text-amber-600 mb-3">Promotions are {String(promoProgram.state).toLowerCase().replace(/_/g, ' ')} on this account; Google will not show them until the program is enabled in Merchant Center.</p>
      )}
      {creating && <PromotionForm onSubmit={p => setPending(p)} />}
      {!promotions.length ? (
        <Empty msg="No promotions yet." />
      ) : (
        <Table
          rows={promotions}
          rowKey={(p: any) => p.promotionId}
          cols={[
            { key: 'title', label: 'Promotion', render: (p: any) => p.attributes?.longTitle ?? p.promotionId },
            {
              key: 'offer',
              label: 'Offer',
              render: (p: any) =>
                p.attributes?.couponValueType === 'PERCENT_OFF'
                  ? `${p.attributes?.percentOff}% off`
                  : p.attributes?.moneyOffAmount
                    ? `${money(Number(p.attributes.moneyOffAmount.amountMicros) / 1e6)} off`
                    : '-',
            },
            { key: 'code', label: 'Code', render: (p: any) => p.attributes?.genericRedemptionCode ?? '-' },
            { key: 'from', label: 'Starts', render: (p: any) => when(p.attributes?.promotionEffectiveTimePeriod?.startTime) },
            { key: 'to', label: 'Ends', render: (p: any) => when(p.attributes?.promotionEffectiveTimePeriod?.endTime) },
            {
              key: 'status',
              label: 'Status',
              render: (p: any) =>
                (p.promotionStatus?.destinationStatuses ?? []).map((s: any) => (
                  <Badge key={s.reportingContext} tone={s.status === 'LIVE' ? 'green' : s.status === 'REJECTED' ? 'red' : 'amber'}>
                    {s.status}
                  </Badge>
                )),
            },
            ...(canEdit
              ? [
                  {
                    key: 'end',
                    label: '',
                    render: (p: any) =>
                      new Date(p.attributes?.promotionEffectiveTimePeriod?.endTime ?? 0) > new Date() ? (
                        <button type="button" className="text-xs text-red-500 underline" onClick={() => setPending({ action: 'promotion.end', promotionId: p.promotionId })}>
                          End now
                        </button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      )}
      {pending && (
        <PreviewApply
          writeScope="merchant_sync:write"
          endpoint={ACTIONS}
          payload={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setCreating(false)
            onChanged()
          }}
        />
      )}
    </Section>
  )
}

function PromotionForm({ onSubmit }: { onSubmit: (p: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ title: '', kind: 'PERCENT_OFF', value: '10', code: '', minimumPurchase: '', days: '7' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }))
  return (
    <div className="rounded-lg border border-border-default p-3 mb-4 grid gap-3 md:grid-cols-3">
      <label className="text-xs text-foreground-muted md:col-span-3">
        Title shown on Google (max 60)
        <input className={inputCls} maxLength={60} value={f.title} onChange={set('title')} placeholder="10% off all power tools" />
      </label>
      <label className="text-xs text-foreground-muted">
        Discount
        <Select
          className="w-full"
          aria-label="Discount"
          value={f.kind}
          onChange={v => setF(s => ({ ...s, kind: v }))}
          options={[
            { value: 'PERCENT_OFF', label: 'Percent off' },
            { value: 'MONEY_OFF', label: 'Amount off (₹)' },
          ]}
        />
      </label>
      <label className="text-xs text-foreground-muted">
        Value
        <input className={inputCls} type="number" min={1} value={f.value} onChange={set('value')} />
      </label>
      <label className="text-xs text-foreground-muted">
        Code (blank for no code)
        <input className={inputCls} value={f.code} onChange={set('code')} placeholder="SAVE10" />
      </label>
      <label className="text-xs text-foreground-muted">
        Minimum order (₹, optional)
        <input className={inputCls} type="number" min={0} value={f.minimumPurchase} onChange={set('minimumPurchase')} />
      </label>
      <label className="text-xs text-foreground-muted">
        Runs for (days)
        <input className={inputCls} type="number" min={1} max={183} value={f.days} onChange={set('days')} />
      </label>
      <div className="flex items-end">
        <button
          type="button"
          className={btnPrimary}
          disabled={!f.title.trim()}
          onClick={() => {
            const start = new Date()
            const end = new Date(start.getTime() + Number(f.days) * 86_400_000)
            onSubmit({
              action: 'promotion.create',
              promotionId: `jeffi_${start.getTime().toString(36)}`,
              title: f.title.trim(),
              kind: f.kind,
              value: Number(f.value),
              code: f.code.trim() || null,
              minimumPurchase: f.minimumPurchase ? Number(f.minimumPurchase) : null,
              start: iso(start),
              end: iso(end),
            })
          }}
        >
          Preview
        </button>
      </div>
    </div>
  )
}

interface ServiceRow {
  name: string
  flatRate: number
  minHandlingDays: number
  maxHandlingDays: number
  minTransitDays: number
  maxTransitDays: number
  active: boolean
}

function servicesFrom(shipping: any): ServiceRow[] {
  return (shipping?.services ?? []).map((s: any) => ({
    name: s.serviceName,
    flatRate: s.rateGroups?.[0]?.singleValue?.flatRate?.amountMicros != null ? Number(s.rateGroups[0].singleValue.flatRate.amountMicros) / 1e6 : 0,
    minHandlingDays: s.deliveryTime?.minHandlingDays ?? 0,
    maxHandlingDays: s.deliveryTime?.maxHandlingDays ?? 1,
    minTransitDays: s.deliveryTime?.minTransitDays ?? 2,
    maxTransitDays: s.deliveryTime?.maxTransitDays ?? 5,
    active: s.active !== false,
  }))
}

export function ShippingView({ d, onChanged }: { d: any; onChanged: () => void }) {
  const canEdit = useCanEditSettings()
  const [rows, setRows] = useState<ServiceRow[]>(() => servicesFrom(d?.shipping))
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const [policy, setPolicy] = useState({ label: 'Standard returns', days: '7', uri: '', freeReturns: true, fee: '0' })
  const num = (i: number, k: keyof ServiceRow) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: k === 'name' ? e.target.value : Number(e.target.value) } : x)))
  const complexRates = (d?.shipping?.services ?? []).some((s: any) => s.rateGroups?.length && !s.rateGroups[0]?.singleValue?.flatRate)
  return (
    <div className="space-y-5">
      <Section title="Shipping services">
        {complexRates && (
          <p className="text-xs text-amber-600 mb-3">Some services use rate tables set in Merchant Center. Saving here keeps those tables and only changes delivery times and on/off.</p>
        )}
        {!rows.length && <Empty msg="No shipping services on Google. Add one below or set them in Merchant Center." />}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-8 items-end rounded-lg border border-border-default p-2">
              <label className="text-xs text-foreground-muted md:col-span-2">
                Service
                <input className={inputCls} value={r.name} disabled={!canEdit} onChange={num(i, 'name')} />
              </label>
              <label className="text-xs text-foreground-muted">
                Flat rate ₹
                <input className={inputCls} type="number" min={0} value={r.flatRate} disabled={!canEdit} onChange={num(i, 'flatRate')} />
              </label>
              {(['minHandlingDays', 'maxHandlingDays', 'minTransitDays', 'maxTransitDays'] as const).map(k => (
                <label key={k} className="text-xs text-foreground-muted">
                  {k.replace(/([A-Z])/g, ' $1').replace('Days', 'days').toLowerCase()}
                  <input className={inputCls} type="number" min={0} value={r[k]} disabled={!canEdit} onChange={num(i, k)} />
                </label>
              ))}
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={r.active} disabled={!canEdit} onChange={e => setRows(x => x.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} /> On
              </label>
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex gap-2 justify-end mt-3">
            <button
              type="button"
              className={btnGhost}
              onClick={() => setRows(r => [...r, { name: 'Standard', flatRate: 0, minHandlingDays: 0, maxHandlingDays: 1, minTransitDays: 2, maxTransitDays: 5, active: true }])}
            >
              <Plus className="w-4 h-4" /> Add service
            </button>
            <button type="button" className={btnPrimary} disabled={!rows.length} onClick={() => setPending({ action: 'shipping.save', services: rows })}>
              Preview changes
            </button>
          </div>
        )}
      </Section>
      <Section title="Return policies">
        {!d?.returnPolicies?.length ? (
          <Empty msg="No return policy on Google. Shoppers see return details when you add one." />
        ) : (
          <Table
            rows={d.returnPolicies}
            rowKey={(p: any) => p.name}
            cols={[
              { key: 'label', label: 'Policy', render: (p: any) => p.label ?? p.returnPolicyId },
              { key: 'days', label: 'Window', render: (p: any) => (p.policy?.days ? `${p.policy.days} days` : String(p.policy?.type ?? '-').toLowerCase().replace(/_/g, ' ')) },
              { key: 'fee', label: 'Return shipping', render: (p: any) => (p.returnShippingFee?.type === 'FREE' ? 'Free' : money(Number(p.returnShippingFee?.fixedFee?.amountMicros ?? 0) / 1e6)) },
              { key: 'uri', label: 'Page', render: (p: any) => (p.returnPolicyUri ? <a href={p.returnPolicyUri} className="text-xs underline" target="_blank" rel="noreferrer">Open</a> : '-') },
              ...(canEdit
                ? [
                    {
                      key: 'del',
                      label: '',
                      render: (p: any) => (
                        <button type="button" aria-label="Delete policy" className="text-red-500" onClick={() => setPending({ action: 'returns.delete', name: p.name })}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {canEdit && (
          <div className="grid gap-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-5 items-end mt-4 rounded-lg border border-border-default p-3">
            <label className="text-xs text-foreground-muted">
              Label
              <input className={inputCls} value={policy.label} onChange={e => setPolicy(p => ({ ...p, label: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Days to return
              <input className={inputCls} type="number" min={1} value={policy.days} onChange={e => setPolicy(p => ({ ...p, days: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted col-span-full xl:col-span-2">
              Returns page URL
              <input className={inputCls} value={policy.uri} onChange={e => setPolicy(p => ({ ...p, uri: e.target.value }))} placeholder="https://yourstore.in/returns" />
            </label>
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={policy.freeReturns} onChange={e => setPolicy(p => ({ ...p, freeReturns: e.target.checked }))} /> Free returns
            </label>
            <div className="col-span-full flex justify-end">
              <button
                type="button"
                className={btnPrimary}
                disabled={!policy.uri}
                onClick={() =>
                  setPending({ action: 'returns.create', label: policy.label, days: Number(policy.days), uri: policy.uri, freeReturns: policy.freeReturns, fee: policy.freeReturns ? null : Number(policy.fee) })
                }
              >
                Preview policy
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-foreground-muted mt-3">Refreshed {when(d?.refreshedAt)}</p>
      </Section>
      {pending && <PreviewApply writeScope="merchant_sync:write" endpoint={ACTIONS} payload={pending} onClose={() => setPending(null)} onDone={onChanged} />}
    </div>
  )
}
