'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { ChannelAlerts, JobRuns } from '@/components/admin/channels/ChannelPanels'
import { Tabs, api } from '@/components/admin/channels/ui'
import { useActionToast } from '@/components/admin/kit'
import Calendar from './Calendar'
import Composer from './Composer'
import Approvals from './Approvals'
import Inbox from './Inbox'
import Insights from './Insights'
import Accounts from './Accounts'
import Library from './Library'
import type { NetworkInfo, Post } from './shared'

type Tab = 'calendar' | 'compose' | 'approvals' | 'inbox' | 'insights' | 'accounts' | 'library' | 'alerts'
const TAB_IDS: Tab[] = ['calendar', 'compose', 'approvals', 'inbox', 'insights', 'accounts', 'library', 'alerts']
const ERRORS: Record<string, string> = {
  not_configured: 'Sign-in for this network is not set up on this platform.',
  bad_state: 'The sign-in link expired. Try again.',
}

export default function SocialPostsClient({ canWrite, canApprove }: { canWrite: boolean; canApprove: boolean }) {
  const router = useRouter()
  const sp = useSearchParams()
  const tabParam = sp.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(tabParam && TAB_IDS.includes(tabParam) ? tabParam : 'calendar')
  const [networks, setNetworks] = useState<NetworkInfo[] | null>(null)
  const [allPosts, setAllPosts] = useState<Post[] | null>(null)
  const toast = useActionToast()
  const setBanner = useCallback((b: { ok: boolean; text: string } | null) => b && toast.result(b), [toast])
  const [autoPick, setAutoPick] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    api<{ networks: NetworkInfo[] }>('/api/admin/social/networks').then(r =>
      setNetworks(r.ok ? (r.data.networks ?? []) : [])
    )
  }, [reloadKey])
  useEffect(() => {
    api<{ posts: Post[] }>('/api/admin/social-posts').then(r => setAllPosts(r.ok ? (r.data.posts ?? []) : []))
  }, [reloadKey])

  // OAuth callback lands here with ?tab=accounts&connected=1|0&network=..&pick=1&error=..
  useEffect(() => {
    const c = sp.get('connected')
    if (!c) return
    const network = sp.get('network')
    if (c === '0') {
      const e = sp.get('error') ?? ''
      setBanner({ ok: false, text: ERRORS[e] || (e ? decodeURIComponent(e) : 'Sign-in failed') })
    } else {
      setBanner({ ok: true, text: sp.get('pick') === '1' ? 'Signed in. Choose where to post below.' : 'Connected.' })
      if (sp.get('pick') === '1' && network) setAutoPick(network)
    }
    setTabState('accounts')
    const url = new URL(window.location.href)
    ;['connected', 'error', 'pick', 'network'].forEach(k => url.searchParams.delete(k))
    window.history.replaceState(null, '', url.toString())
  }, [sp, setBanner])

  function setTab(next: Tab) {
    setTabState(next)
    setBanner(null)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', next)
    router.push(`${ap('/admin/social-posts')}?${params.toString()}`, { scroll: false })
  }

  const waiting = new Set(
    (allPosts ?? [])
      .filter(p => p.approval_status === 'pending' && p.status !== 'cancelled')
      .map(p => p.group_id ?? p.id)
  ).size
  const pendingConnections = (networks ?? []).filter(n => n.status === 'pending').length
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'calendar', label: 'Calendar' },
    ...(canWrite ? [{ id: 'compose' as Tab, label: 'Compose' }] : []),
    ...(waiting || canApprove ? [{ id: 'approvals' as Tab, label: 'Approvals', count: waiting }] : []),
    { id: 'inbox', label: 'Inbox' },
    { id: 'insights', label: 'Insights' },
    { id: 'accounts', label: 'Accounts', count: pendingConnections },
    { id: 'library', label: 'Library' },
    { id: 'alerts', label: 'Alerts and history' },
  ]

  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'calendar' && <Calendar reloadKey={reloadKey} />}
      {tab === 'compose' && (
        <Composer
          networks={networks}
          canApprove={canApprove}
          goAccounts={() => setTab('accounts')}
          onCreated={reload}
        />
      )}
      {tab === 'approvals' && <Approvals posts={allPosts} canApprove={canApprove} onChange={reload} />}
      {tab === 'inbox' && <Inbox reloadKey={reloadKey} />}
      {tab === 'insights' && <Insights onSynced={reload} />}
      {tab === 'accounts' && <Accounts networks={networks} autoPick={autoPick} onChange={reload} />}
      {tab === 'library' && <Library />}
      {tab === 'alerts' && (
        <div className="space-y-4">
          <ChannelAlerts channel="social" params={{ days: 'days before expiry', hours: 'hours' }} />
          <JobRuns channel="social" />
        </div>
      )}
    </div>
  )
}
