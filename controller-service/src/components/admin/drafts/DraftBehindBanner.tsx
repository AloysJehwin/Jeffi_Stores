import { GitMerge } from 'lucide-react'

interface Behind {
  behind: number
  last: { by: string | null; at: string; draftTitle: string | null; fields: number } | null
}

/** "Live changed since you started this draft" — publishing merges, overlapping fields ask first. */
export default function DraftBehindBanner({ info, siblings = 0, noun = 'item' }: { info: Behind | null; siblings?: number; noun?: string }) {
  if (!info?.behind && !siblings) return null
  const when = info?.last ? new Date(info.last.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-200">
      <GitMerge className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {info?.behind ? (
          <p>
            Live changed since you started this draft
            {info.last ? ` — ${info.last.by ?? 'another admin'} published ${info.last.draftTitle ? `“${info.last.draftTitle}” ` : ''}${when ? `on ${when}` : ''}` : ''}
            {info.behind > 1 ? ` (${info.behind} changes)` : ''}. Publishing keeps their edits; any field you both changed asks which to keep.
          </p>
        ) : null}
        {siblings ? (
          <p className={info?.behind ? 'mt-1 text-xs opacity-80' : ''}>
            {siblings} other draft{siblings === 1 ? ' is' : 's are'} open on this {noun}. Whoever publishes first wins; later publishes merge on top.
          </p>
        ) : null}
      </div>
    </div>
  )
}
