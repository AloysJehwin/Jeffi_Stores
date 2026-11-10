'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plug } from 'lucide-react'
import ConnectionsGear, { type ConnectionState } from '@/components/admin/ConnectionsGear'
import { ChangeHistory, ChannelAlerts, JobRuns } from '@/components/admin/channels/ChannelPanels'
import { Section, Tabs, api, btnGhost, when } from '@/components/admin/channels/ui'
import { CopyValue } from '@/components/admin/kit/actions'
import { PageHeader } from '@/components/admin/kit/layout'
import { LoadingLines } from '@/components/admin/kit/skeleton'
import { EmptyState, ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { MarketplaceConnectionStatus } from '@/lib/marketplace/connection-route'
import ConnectPanel, { modeBadge } from './ConnectPanel'
import InventoryPanel from './InventoryPanel'
import ListingsMapper from './ListingsMapper'
import MarketplaceOverview from './MarketplaceOverview'
import MarketplaceReturns from './MarketplaceReturns'
import OrdersQueue from './OrdersQueue'
import SettlementsPanel from './SettlementsPanel'
import { MarketplaceBodyLoading } from './skeletons'

type Channel = MarketplaceConnectionStatus['channel']
type Tab = 'overview' | 'orders' | 'returns' | 'listings' | 'inventory' | 'settlements' | 'alerts' | 'changes' | 'runs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'returns', label: 'Returns' },
  { id: 'listings', label: 'Listings' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Changes' },
  { id: 'runs', label: 'Runs' },
]

const INFO: Record<Channel, { title: string; description: string }> = {
  myntra: { title: 'Myntra', description: 'Orders pushed by Myntra, listings, stock, returns and settlements' },
  ajio: { title: 'AJIO', description: 'Orders pushed by AJIO, purchase orders, listings, stock, returns and settlements' },
}

const COMING: Partial<Record<Tab, string>> = {
  listings: 'listing mappings appear here.',
  inventory: 'stock pushed to the marketplace appears here.',
  settlements: 'settlement reports appear here once imported.',
}

/** Console shell for Myntra and AJIO: the connection lives in the gear; tabs fill in as they land. */
export default function MarketplaceConsole({ channel }: { channel: Channel }) {
  const router = useRouter()
  const sp = useSearchParams()
  const info = INFO[channel]
  const tabParam = sp.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [status, setStatus] = useState<MarketplaceConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gearOpen, setGearOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const canWrite = useCanWrite(channel)
  const toast = useActionToast()

  const load = useCallback(async () => {
    const r = await api<MarketplaceConnectionStatus>(`/api/admin/${channel}/connection`)
    if (r.ok) {
      setStatus(r.data)
      setError(null)
    } else setError(r.data.error || 'Could not load')
  }, [channel])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (sp.get('connect') === '1') setGearOpen(true)
  }, [sp])

  const onChanged = useCallback(
    (msg?: string) => {
      if (msg) toast.result({ ok: true, text: msg })
      load()
    },
    [load, toast]
  )
  const onToken = (t: string) => {
    setToken(t)
    setGearOpen(true)
  }

  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(sp.toString())
    params.set('tab', next)
    router.push(`${ap(`/admin/${channel}`)}?${params.toString()}`, { scroll: false })
  }

  const state: ConnectionState = status?.connected ? 'connected' : 'none'
  const panel = status && <ConnectPanel status={status} canWrite={canWrite} onChanged={onChanged} token={token} onToken={onToken} />

  return (
    <div className="space-y-5">
      <PageHeader
        title={info.title}
        description={info.description}
        badges={status?.connected ? modeBadge(status.mode) : null}
        actions={
          <ConnectionsGear title={`${info.title} connection`} scope={channel} state={state} open={gearOpen} onOpenChange={setGearOpen}>
            {panel || (error ? <p className="text-sm text-foreground-muted">{error}</p> : <LoadingLines lines={3} />)}
          </ConnectionsGear>
        }
      />

      {!status ? (
        error ? <ErrorState body={error} /> : <MarketplaceBodyLoading tab={tab} />
      ) : (
        <>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <Body tab={tab} channel={channel} status={status} panel={panel} onOpen={() => setGearOpen(true)} />
        </>
      )}
    </div>
  )
}

function Body({
  tab,
  channel,
  status,
  panel,
  onOpen,
}: {
  tab: Tab
  channel: Channel
  status: MarketplaceConnectionStatus
  panel: React.ReactNode
  onOpen: () => void
}) {
  const name = INFO[channel].title
  if (!status.connected) {
    if (tab === 'overview') return <Section title={`Connect ${name}`}>{panel}</Section>
    return (
      <EmptyState
        icon={<Plug className="h-5 w-5" />}
        title={`Connect ${name} first`}
        body={`Enter your ${name} seller details in the gear (top right).`}
        actionNode={
          <button type="button" className={btnGhost} onClick={onOpen}>
            Connect
          </button>
        }
      />
    )
  }
  if (tab === 'alerts') return <ChannelAlerts channel={channel} />
  if (tab === 'changes') return <ChangeHistory channel={channel} />
  if (tab === 'runs') return <JobRuns channel={channel} />
  if (tab === 'orders') return <OrdersQueue channel={channel} />
  if (tab === 'returns') return <MarketplaceReturns channel={channel} />
  if (tab === 'listings') return <ListingsMapper channel={channel} />
  if (tab === 'inventory') return <InventoryPanel channel={channel} />
  if (tab === 'settlements') return <SettlementsPanel channel={channel} />
  if (tab !== 'overview') return <EmptyState title="Nothing here yet" body={`${name} ${COMING[tab]}`} />
  return (
    <div className="space-y-5">
    <MarketplaceOverview channel={channel} />
    <Section title="Connection">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-foreground-muted">Mode</dt>
          <dd className="mt-0.5">{modeBadge(status.mode)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-foreground-muted">Last event</dt>
          <dd className="mt-0.5 text-sm text-foreground">{status.lastEventAt ? when(status.lastEventAt) : 'None yet'}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-foreground-muted">Push URL</dt>
          <dd className="mt-0.5 flex min-w-0 items-center gap-2">
            <code className="min-w-0 break-all text-xs text-foreground">{status.pushUrl}</code>
            <CopyValue value={status.pushUrl} label="Copy push URL" />
          </dd>
        </div>
      </dl>
      {!status.lastEventAt && (
        <p className="mt-3 text-xs text-foreground-muted">
          No orders have arrived yet. Open the gear for the push token and the steps to register it with {name}.
        </p>
      )}
    </Section>
    </div>
  )
}
