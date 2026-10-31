import type { ServersBilling } from '@controller/lib/billing/infra-status'
import { fmt } from './finance'

const WARN_DAYS = 7

/** Where the wallet stands against the store's servers: paused, about to pause, or how long it lasts. */
export default function ServersNotice({ servers: s }: { servers: ServersBilling }) {
  const alert = s.paused || s.pauseOn != null || s.daysLeft < WARN_DAYS
  const text = s.paused
    ? `Your store is paused: the wallet couldn't pay for its servers. Once the balance reaches ${fmt(s.resumeAtInr)} it starts again within a few minutes. Until then the wallet pays ${fmt(s.dailyInr)} a day to keep its data.`
    : s.pauseOn
      ? `Your wallet is below zero. Top up before ${new Date(s.pauseOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} or the store pauses.`
      : `Your balance covers about ${s.daysLeft} ${s.daysLeft === 1 ? 'day' : 'days'} of servers at ${fmt(s.dailyInr)} a day.`
  return (
    <p className={`rounded-2xl border p-4 text-sm ${alert ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400' : 'border-border-default text-foreground-secondary'}`}>
      {text}
    </p>
  )
}
