import { Card } from '@/components/admin/kit'
import { DraftLockBadge } from '@/components/admin/kit/draft-lock'
import type { DraftListing } from '@/lib/admin/draft-branches'

const btn = 'control-sm inline-flex items-center border border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary transition-colors'

const when = (at: string) => new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * View-page list of an entity's open drafts. `start` is the start*Draft server action: with
 * _draft it opens that draft (read-only when someone else holds it), with _new=1 it starts another.
 */
export default function EntityDrafts({
  drafts,
  start,
  back,
  me,
  noun,
}: {
  drafts: DraftListing[]
  start: (fd: FormData) => Promise<void>
  back: string
  me?: string | null
  noun: string
}) {
  return (
    <Card
      title="Open drafts"
      hint={drafts.length ? `${drafts.length}` : undefined}
      action={
        <form action={start} className="flex items-center gap-2">
          <input type="hidden" name="_back" value={back} />
          <input type="hidden" name="_new" value="1" />
          <input name="_title" maxLength={120} placeholder="Draft name (optional)" className="control-sm w-44 rounded-md border border-border-secondary bg-surface px-2 text-xs" />
          <button type="submit" className={btn}>
            New draft
          </button>
        </form>
      }
    >
      {drafts.length === 0 ? (
        <p className="text-sm text-foreground-muted">No one is editing this {noun}. Edit starts your own draft; others can work on theirs at the same time.</p>
      ) : (
        <ul className="divide-y divide-border-default/60">
          {drafts.map(d => {
            const mine = d.authorId === me
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {d.title || (mine ? 'Your draft' : `${d.authorName ?? 'An admin'}’s draft`)}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {d.authorName ?? 'Unknown'} · updated {when(d.updatedAt)}
                    {d.behind > 0 && (
                      <span className="text-sky-600 dark:text-sky-400">
                        {' '}· live changed {d.behind === 1 ? 'once' : `${d.behind} times`} since it started
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DraftLockBadge lock={d.lock} mine={d.lock?.mine} />
                  <form action={start}>
                    <input type="hidden" name="_back" value={back} />
                    <input type="hidden" name="_draft" value={d.id} />
                    <button type="submit" className={btn}>
                      {d.lock && !d.lock.mine ? 'View' : 'Open'}
                    </button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
