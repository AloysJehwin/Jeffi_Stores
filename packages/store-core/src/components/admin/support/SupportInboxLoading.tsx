import { MessagesSquare } from 'lucide-react'
import { Sk } from '@/components/admin/kit/skeleton'

// Server-safe placeholders for the support inbox; labels mirror SupportInbox's filters.
const FILTERS = ['Needs a person', 'Needs approval', 'Mine', 'Assistant', 'All open', 'Closed']
const CHANNELS = ['All channels', 'Website', 'App', 'WhatsApp', 'Email']

/** Conversation rows while the list loads. */
export function SessionRowsLoading({ rows = 7 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex gap-2.5 px-3 py-2.5" aria-hidden>
          <Sk className="h-9 w-9 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Sk className={`h-3.5 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
            <Sk className="h-3 w-5/6" />
            <Sk className="h-3 w-16" />
          </span>
        </li>
      ))}
    </>
  )
}

/** Message bubbles while a conversation loads. */
export function MessagesLoading() {
  return (
    <div className="space-y-3 p-4" aria-hidden>
      {['w-2/3', 'ml-auto w-1/2', 'w-3/5', 'ml-auto w-2/5', 'w-1/2'].map((w, i) => (
        <Sk key={i} className={`h-10 rounded-2xl ${w}`} />
      ))}
    </div>
  )
}

/** A conversation pane (header, then messages) while it loads. */
export function ConversationLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" role="status" aria-busy="true" aria-label="Loading conversation">
      <div className="flex items-center gap-3 border-b border-border-default bg-surface-elevated px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Sk className="h-4 w-40" />
          <Sk className="h-3 w-28" />
        </div>
        <Sk className="h-8 w-24 rounded-lg" />
        <Sk className="h-8 w-20 rounded-lg" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <MessagesLoading />
      </div>
    </div>
  )
}

/** The whole inbox (filters, list and the empty conversation pane) for the page's loading screen. */
export default function SupportInboxLoading() {
  return (
    <div className="grid h-[calc(100dvh-15rem)] min-h-[520px] grid-cols-1 overflow-hidden rounded-xl border border-border-default bg-surface-elevated lg:grid-cols-[minmax(300px,360px)_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-border-default">
        <div className="space-y-2 border-b border-border-default p-3">
          <Sk className="h-9 w-full rounded-lg" />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(f => (
              <span key={f} className={`inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium ${f === 'All open' ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-foreground-secondary'}`}>
                {f}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            {CHANNELS.map(c => (
              <span key={c} className={`inline-flex h-6 items-center rounded-md px-2 text-[11px] ${c === 'All channels' ? 'bg-foreground text-surface' : 'text-foreground-muted'}`}>
                {c}
              </span>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border-default overflow-hidden">
          <SessionRowsLoading />
        </ul>
      </aside>
      <section className="hidden min-h-0 flex-col lg:flex">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-foreground-muted">
          <MessagesSquare className="h-8 w-8 opacity-40" />
          Pick a conversation. The assistant answers every customer first; the ones that need a person are listed first.
        </div>
      </section>
    </div>
  )
}
