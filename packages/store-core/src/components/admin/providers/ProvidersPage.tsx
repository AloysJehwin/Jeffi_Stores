'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Select from '@/components/ui/Select'
import { Badge, Banner, api, btnGhost } from '@/components/admin/kit/core'
import { EmptyState, ErrorState } from '@/components/admin/kit/states'
import { Sk } from '@/components/admin/kit/skeleton'
import { CAPS, PROVIDERS_URL, type ProvidersData, type TenantRow } from './model'
import ChannelProviders from './ChannelProviders'
import AiRouting from './AiRouting'
import Integrations from './Integrations'
import SecretsStatus from './SecretsStatus'

// Settings → Providers (variant 'settings') and Ecom → Configuration → Provider overrides (variant 'overrides').
// The flagship administrator picks the platform default or one store; a store admin sees its own store.
// What each viewer may change comes from the API's canEdit, narrowed by settings:write.

export default function ProvidersPage({ variant = 'settings' }: { variant?: 'settings' | 'overrides' }) {
  const canWrite = useCanWrite('settings:write')
  const overrides = variant === 'overrides'
  const [tenant, setTenant] = useState<string | null>(null)
  const [data, setData] = useState<ProvidersData | null>(null)
  const [tenants, setTenants] = useState<TenantRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const load = useCallback(async (t: string | null) => {
    const n = ++seq.current
    setLoading(true)
    const { ok, data: d } = await api<ProvidersData>(t ? `${PROVIDERS_URL}?${new URLSearchParams({ tenant: t })}` : PROVIDERS_URL).catch(() => ({
      ok: false,
      data: { error: 'Could not reach the server' } as ProvidersData & { error?: string },
    }))
    if (n !== seq.current) return
    setLoading(false)
    if (!ok) return setError(d.error || 'Could not load the providers')
    setError(null)
    setData(d)
    if (d.tenants) setTenants(d.tenants)
  }, [])

  useEffect(() => {
    load(tenant)
  }, [load, tenant])
  const reload = useCallback(() => load(tenant), [load, tenant])

  const flagship = tenants !== null || data?.scope.kind === 'platform'
  const store = data?.scope.kind === 'store'
  const picking = overrides && !tenant

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{overrides ? 'Store overrides' : 'Providers'}</h2>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {overrides ? "A store's own providers and AI routing, which beat the platform default in Settings → Providers. " : ''}
            Configuration only. Keys live in the platform&apos;s secrets.
          </p>
        </div>
        {flagship && tenants ? (
          <div className="w-full sm:w-72">
            <span className="mb-1 block text-xs text-foreground-muted">{overrides ? 'Store' : 'Showing'}</span>
            <Select
              className="w-full"
              size="sm"
              aria-label={overrides ? 'Store' : 'Scope'}
              value={tenant ?? ''}
              placeholder="Pick a store"
              onChange={v => setTenant(v || null)}
              options={[
                ...(overrides ? [] : [{ value: '', label: 'Platform default' }]),
                ...tenants.map(t => ({ value: t.id, label: t.display_name || t.slug, hint: t.slug })),
              ]}
            />
          </div>
        ) : store && data?.scope.tenantName ? (
          <Badge tone="muted">
            <span className="inline-flex items-center gap-1">
              <Store aria-hidden className="h-3 w-3" />
              {data.scope.tenantName}
            </span>
          </Badge>
        ) : null}
      </header>

      {error && data && <Banner ok={false}>{error}</Banner>}

      {picking && tenants ? (
        <EmptyState icon={<Store className="h-5 w-5" />} title="Pick a store" body="Its SMS, WhatsApp and AI routing show here. Anything it does not override follows the platform default." />
      ) : !data ? (
        error ? (
          <ErrorState
            title="Could not load the providers"
            body={error}
            actionNode={
              <button type="button" className={btnGhost} onClick={reload}>
                Try again
              </button>
            }
          />
        ) : (
          <ProvidersSkeleton />
        )
      ) : (
        <div key={data.scope.tenantId ?? 'platform'} aria-busy={loading} className={`space-y-5 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          {store && flagship && (
            <p className="text-xs text-foreground-muted">
              Showing <span className="font-medium text-foreground">{data.scope.tenantName ?? 'this store'}</span>. Anything without a store override follows the platform default.
            </p>
          )}
          <ChannelProviders data={data} flagship={flagship} canWrite={canWrite} onSaved={reload} />
          <AiRouting data={data} canWrite={canWrite} onSaved={reload} />
          {flagship && !store && (data.voice || data.secrets) && (
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <Integrations data={data} canWrite={canWrite} onSaved={reload} />
              {data.secrets && (
                <div className="xl:sticky xl:top-4">
                  <SecretsStatus secrets={data.secrets} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Three channel cards and the six routing rows, with their real labels, while the settings load. */
function ProvidersSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading providers" className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {['SMS', 'WhatsApp', 'Calling'].map(l => (
          <div key={l} className="space-y-2.5 rounded-xl border border-border-default bg-surface-elevated p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{l}</p>
            <Sk className="h-control w-full rounded-lg" />
            <Sk className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">AI routing</p>
        <div className="divide-y divide-border-default">
          {CAPS.map((c, i) => (
            <div key={c.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-6">
              <p className="text-sm font-medium text-foreground">{c.label}</p>
              <div className="flex flex-wrap gap-3">
                {Array.from({ length: i % 2 ? 2 : 3 }).map((_, j) => (
                  <Sk key={j} className="h-[6.5rem] w-full rounded-lg sm:w-[15.5rem]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
