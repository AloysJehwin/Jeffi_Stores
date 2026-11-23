import Link from 'next/link'
import type { SetupOutcome } from '@/lib/tenant-registry/provisioning'
import { Badge, primaryBtn, secondaryBtn } from '../../onboard/ui'

const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const KEPT = [
  ['database', 'store data'],
  ['media', 'images'],
  ['config', 'settings'],
] as const

const list = (w: string[]) => (w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`)

/** Title and badge for a stopped or closed store. */
export function outcomeHeading(o: SetupOutcome): { title: string; badge: string; tone: 'peach' | 'muted' } {
  const title = o.wentLive ? 'Store closed' : 'Setup stopped'
  if (o.state === 'archived') return { title, badge: 'Data kept', tone: 'peach' }
  return { title, badge: o.wentLive ? 'Closed' : 'Stopped', tone: 'muted' }
}

/** A stopped or deprovisioned store, for its owner: what happened, what was kept and what they can do next. */
export default function StoreClosed({ outcome: o, slug, heading = true }: { outcome: SetupOutcome; slug: string; heading?: boolean }) {
  const host = <span className="font-semibold text-foreground">{slug}.jeffistores.in</span>
  const on = o.closedAt ? ` on ${day(o.closedAt)}` : ''
  const kept = o.archive ? KEPT.filter(([k]) => o.archive![k]).map(([, label]) => label) : []
  const h = outcomeHeading(o)
  return (
    <div className="min-w-0 space-y-3">
      {heading && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{h.title}</span>
          <Badge tone={h.tone}>{h.badge}</Badge>
        </div>
      )}
      <p className="text-sm text-foreground-secondary break-words">
        {o.wentLive ? (
          <>
            {host} was closed{on} and is no longer online.
          </>
        ) : (
          <>
            Setting up {host} was stopped{on} before it went live.
          </>
        )}{' '}
        {o.archive && kept.length
          ? `We kept your ${list(kept)} until ${day(o.archive.expiresAt)} — set up your store again to bring ${kept.length > 1 ? 'them' : 'it'} back.`
          : o.closed
            ? 'Nothing from it is kept, so a new store starts empty.'
            : ''}
      </p>
      {o.reapply ? (
        <Link href="/onboard?again=1" className={`${primaryBtn} w-full sm:w-auto`}>
          {o.archive ? 'Set up again and restore →' : 'Set up again →'}
        </Link>
      ) : (
        o.closed && (
          <a href="mailto:support@jeffistores.in" className={`${secondaryBtn} w-full sm:w-auto`}>
            Contact support
          </a>
        )
      )}
    </div>
  )
}
