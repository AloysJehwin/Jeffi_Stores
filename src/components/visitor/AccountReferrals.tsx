'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import Pagination from '@/components/visitor/ListPagination'

type Status = 'joined' | 'rewarded' | 'reversed' | 'capped' | 'rejected'

interface Friend {
  id: string
  name: string
  status: Status
  hasOrdered: boolean
  points: number | null
  signedUpAt: string
  rewardedAt: string | null
}

interface ReferralsData {
  enabled: boolean
  eligible?: boolean
  code: string
  program: { rewardPoints: number; yearlyCap: number; qualifyDays: number }
  counts: Record<Status, number>
  pointsEarned: number
  rewardsLeftThisYear: number
  friends: { items: Friend[]; total: number; page: number; pageSize: number }
}

const CARD = 'bg-surface-elevated rounded-xl shadow-sm border border-border-default p-5 sm:p-6'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusChip(friend: Friend): { label: string; className: string } {
  switch (friend.status) {
    case 'rewarded':
      return {
        label: `Rewarded +${(friend.points ?? 0).toLocaleString('en-IN')}`,
        className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      }
    case 'reversed':
      return { label: 'Order returned', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' }
    case 'capped':
      return { label: 'Yearly limit reached', className: 'bg-surface-secondary text-foreground-secondary' }
    case 'rejected':
      return { label: 'Not eligible', className: 'bg-surface-secondary text-foreground-muted' }
    default:
      return friend.hasOrdered
        ? { label: 'Order placed', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' }
        : { label: 'Joined', className: 'bg-surface-secondary text-foreground-secondary' }
  }
}

function ShareCard({ data, storeName }: { data: ReferralsData; storeName: string }) {
  const { showToast } = useToast()
  const [link, setLink] = useState('')
  useEffect(() => setLink(`${window.location.origin}/r/${data.code}`), [data.code])
  const message = `I shop at ${storeName}. Create your account with my link: ${link}`
  const points = data.program.rewardPoints.toLocaleString('en-IN')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      showToast('Link copied', 'success')
    } catch {
      showToast('Could not copy the link', 'error')
    }
  }

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: storeName, text: message, url: link })
        return
      } catch {
        return // dismissed
      }
    }
    copy()
  }

  return (
    <div className="rounded-xl border border-border-default shadow-sm bg-gradient-to-br from-accent-100 to-accent-50 dark:from-accent-900/40 dark:to-accent-800/20 p-5 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold text-foreground">Invite friends, earn {points} points</h1>
      <p className="mt-1 text-sm text-foreground-secondary">
        Share your link. When a friend signs up with it and their first order is delivered, you get {points} points.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-elevated border border-border-default p-2">
        <span className="flex-1 min-w-0 truncate font-mono text-sm text-foreground px-1">{link || '…'}</span>
        <button
          type="button"
          onClick={copy}
          disabled={!link}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
        >
          Copy
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
        <a
          href={link ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          WhatsApp
        </a>
        <button
          type="button"
          onClick={share}
          disabled={!link}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
        >
          Share
        </button>
      </div>
      <p className="mt-3 text-xs text-foreground-muted">
        Your code: <span className="font-mono font-semibold text-foreground">{data.code}</span>
      </p>
    </div>
  )
}

function Stats({ data }: { data: ReferralsData }) {
  const joined = data.counts.joined + data.counts.rewarded + data.counts.reversed + data.counts.capped
  const tiles = [
    { label: 'Friends joined', value: joined },
    { label: 'Rewarded', value: data.counts.rewarded },
    { label: 'Points earned', value: data.pointsEarned },
    { label: 'Rewards left this year', value: data.rewardsLeftThisYear },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map(tile => (
        <div key={tile.label} className="bg-surface-elevated rounded-xl border border-border-default p-4">
          <p className="text-2xl font-bold tabular-nums text-foreground">{tile.value.toLocaleString('en-IN')}</p>
          <p className="text-xs text-foreground-secondary">{tile.label}</p>
        </div>
      ))}
    </div>
  )
}

function Friends({
  friends,
  onPage,
  busy,
}: {
  friends: ReferralsData['friends']
  onPage: (page: number) => void
  busy: boolean
}) {
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Your friends</h2>
      {friends.total === 0 ? (
        <p className="mt-3 text-sm text-foreground-muted">
          No one has joined with your link yet. Share it with a friend to get started.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border-default">
            {friends.items.map(friend => {
              const chip = statusChip(friend)
              return (
                <li key={friend.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{friend.name}</p>
                    <p className="text-xs text-foreground-muted">Joined {formatDate(friend.signedUpAt)}</p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${chip.className}`}>
                    {chip.label}
                  </span>
                </li>
              )
            })}
          </ul>
          <Pagination page={friends.page} total={friends.total} pageSize={friends.pageSize} onChange={onPage} busy={busy} />
        </>
      )}
    </div>
  )
}

function HowItWorks({ program }: { program: ReferralsData['program'] }) {
  const points = program.rewardPoints.toLocaleString('en-IN')
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">How it works</h2>
      <ol className="mt-3 space-y-2 text-sm text-foreground-secondary list-decimal pl-5">
        <li>Share your link with a friend who has not shopped with us before.</li>
        <li>They create an account using your link.</li>
        <li>
          When their first online order is delivered (within {program.qualifyDays} days of signing up), you get {points}{' '}
          points.
        </li>
      </ol>
      <ul className="mt-4 space-y-1.5 text-xs text-foreground-muted list-disc pl-5">
        <li>You can earn up to {program.yearlyCap} referral rewards a year.</li>
        <li>If your friend returns or cancels that order, the points are taken back.</li>
        <li>Referral points can be spent like any other points but do not count toward your tier.</li>
        <li>Signing up yourself with your own link, phone number or device does not count.</li>
      </ul>
      <Link href="/account/rewards" className="mt-4 inline-block text-sm font-medium text-accent-600 hover:text-accent-700">
        See your points
      </Link>
    </div>
  )
}

export default function AccountReferrals() {
  const { user, isLoading: authLoading } = useAuth()
  const config = useStoreConfig()
  const router = useRouter()
  const [data, setData] = useState<ReferralsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [paging, setPaging] = useState(false)

  const load = useCallback(async (page = 1, silent = false) => {
    if (silent) setPaging(true)
    try {
      const res = await fetch(`/api/user/referrals?page=${page}`)
      if (!res.ok) throw new Error('load failed')
      setData(await res.json())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
      setPaging(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login?redirect=/account/referrals')
      return
    }
    load()
  }, [user, authLoading, router, load])

  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)

  return (
    <div className="bg-surface min-h-screen">
      <AccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-10 max-w-5xl">
        {authLoading || loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-44 rounded-xl bg-surface-elevated border border-border-default" />
            <div className="h-20 rounded-xl bg-surface-elevated border border-border-default" />
            <div className="h-56 rounded-xl bg-surface-elevated border border-border-default" />
          </div>
        ) : unavailable || !data ? (
          <div className={`${CARD} text-center py-12`}>
            <p className="text-foreground font-medium">
              {failed ? 'Could not load your referrals' : 'Referrals are not available for this account'}
            </p>
            <Link href="/account" className="mt-3 inline-block text-sm text-accent-600 hover:text-accent-700">
              Back to my account
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <div className="space-y-4 lg:col-span-2">
              <ShareCard data={data} storeName={config.identity.name} />
              <Stats data={data} />
              <Friends friends={data.friends} busy={paging} onPage={page => load(page, true)} />
            </div>
            <div className="lg:sticky lg:top-4">
              <HowItWorks program={data.program} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
