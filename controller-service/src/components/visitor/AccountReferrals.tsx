'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import { useInfiniteList, InfiniteFooter, fetchJson } from '@/components/admin/kit/infinite'

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

const ICON = 'w-4 h-4 shrink-0'

function CopyIcon() {
  return (
    <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.7 10.7l6.6-3.4m-6.6 6l6.6 3.4M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zm12 7a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z" />
    </svg>
  )
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
      } catch {
        // dismissed
      }
      return
    }
    copy()
  }

  return (
    <div className="rounded-xl border border-border-default shadow-sm bg-gradient-to-br from-accent-100 to-accent-50 dark:from-accent-900/40 dark:to-accent-800/20 p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">Refer &amp; Earn</p>
      <h1 className="mt-1 text-lg sm:text-2xl font-bold leading-snug text-foreground">
        Invite friends, earn {points} points each
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">
        When a friend signs up with your link and their first order is delivered, the points are yours.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface-elevated border border-border-default pl-3 pr-1.5 py-1.5">
        <span className="flex-1 min-w-0 truncate font-mono text-xs sm:text-sm text-foreground">{link || '…'}</span>
        <button
          type="button"
          onClick={copy}
          disabled={!link}
          aria-label="Copy link"
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-default text-xs sm:text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
        >
          <CopyIcon />
          <span>Copy</span>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
        <a
          href={link ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          <WhatsAppIcon />
          WhatsApp
        </a>
        <button
          type="button"
          onClick={share}
          disabled={!link}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
        >
          <ShareIcon />
          Share
        </button>
      </div>

      <p className="mt-3 text-xs text-foreground-muted">
        Or share your code{' '}
        <span className="inline-block px-1.5 py-0.5 rounded bg-surface-elevated border border-border-default font-mono font-semibold text-foreground">
          {data.code}
        </span>
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
    { label: 'Left this year', value: data.rewardsLeftThisYear },
  ]
  return (
    // A 1px gap over the border colour draws the dividers for both the 2x2 and 4-across layouts.
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl border border-border-default bg-border-default overflow-hidden">
      {tiles.map(tile => (
        <div key={tile.label} className="bg-surface-elevated px-4 py-3">
          <p className="text-xl font-bold tabular-nums text-foreground">{tile.value.toLocaleString('en-IN')}</p>
          <p className="text-xs text-foreground-secondary">{tile.label}</p>
        </div>
      ))}
    </div>
  )
}

function Friends({ friendsList }: { friendsList: ReturnType<typeof useFriendsList> }) {
  const { rows, total } = friendsList
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">Your friends</h2>
      {total === 0 && !friendsList.loading ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-surface-secondary p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
            <ShareIcon />
          </span>
          <p className="text-sm text-foreground-secondary">
            No one has joined with your link yet. Share it above to get started.
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border-default">
            {rows.map(friend => {
              const chip = statusChip(friend)
              return (
                <li key={friend.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{friend.name}</p>
                    <p className="text-xs text-foreground-muted">Joined {formatDate(friend.signedUpAt)}</p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${chip.className}`}>
                    {chip.label}
                  </span>
                </li>
              )
            })}
          </ul>
          <InfiniteFooter shown={rows.length} control={friendsList} noun="friends" />
        </>
      )}
    </div>
  )
}

// Shared return type for the Friends child.
function useFriendsList(opts: Parameters<typeof useInfiniteList<Friend>>[0]) {
  return useInfiniteList<Friend>(opts)
}

function HowItWorks({ program }: { program: ReferralsData['program'] }) {
  const points = program.rewardPoints.toLocaleString('en-IN')
  const steps = [
    'Share your link with a friend who has not shopped with us before.',
    'They create an account using your link.',
    `When their first online order is delivered (within ${program.qualifyDays} days of signing up), you get ${points} points.`,
  ]
  return (
    <div className={CARD}>
      <h2 className="font-semibold text-foreground">How it works</h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm text-foreground-secondary">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-4 space-y-1.5 border-t border-border-default pt-3 text-xs text-foreground-muted list-disc pl-5">
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
  // The friends list auto-paginates; the surrounding stats come from page 1 of the same payload.
  const [staticData, setStaticData] = useState<ReferralsData | null>(null)
  const [failed, setFailed] = useState(false)

  const friendsList = useFriendsList({
    key: user ? `referrals-${user.id}` : null,
    pageSize: 20,
    fetchPage: async (page, signal) => {
      try {
        const data = await fetchJson<ReferralsData>(`/api/user/referrals?page=${page}`, signal)
        if (page === 1) {
          setStaticData(data)
          setFailed(false)
        }
        return { rows: data.friends.items, total: data.friends.total }
      } catch (e) {
        if (page === 1) setFailed(true)
        throw e
      }
    },
    getKey: f => f.id,
  })

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login?redirect=/account/referrals')
    }
  }, [user, authLoading, router])

  const loading = authLoading || (friendsList.loading && !staticData)
  const data = staticData
  const unavailable = !loading && (failed || !data || !data.enabled || data.eligible === false)

  return (
    <div className="bg-surface min-h-screen">
      <AccountMobileHeader />
      <div className="container mx-auto px-4 pt-4 pb-10">
        {authLoading || loading ? (
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start animate-pulse">
            <div className="space-y-4 lg:col-span-2">
              <div className="h-44 rounded-xl bg-surface-elevated border border-border-default" />
              <div className="h-20 rounded-xl bg-surface-elevated border border-border-default" />
              <div className="h-56 rounded-xl bg-surface-elevated border border-border-default" />
            </div>
            <div className="hidden lg:block h-72 rounded-xl bg-surface-elevated border border-border-default" />
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
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <ShareCard data={data} storeName={config.identity.name} />
              <Stats data={data} />
              <Friends friendsList={friendsList} />
            </div>
            <div className="min-w-0 lg:sticky lg:top-4">
              <HowItWorks program={data.program} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
