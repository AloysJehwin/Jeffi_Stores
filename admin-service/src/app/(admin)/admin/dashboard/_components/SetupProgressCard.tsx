import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { badgeCls } from '@/components/admin/kit/tones'
import { ap } from '@/lib/shared/admin-path'
import type { ResolvedStep, SetupGuideResult } from '@/lib/setup-guide/status'

const RANK: Record<string, number> = { needs_attention: 0, todo: 1, in_progress: 2 }

/** Required steps still open (and anything needing attention), most urgent first; empty once setup is finished. */
export function nextSetupSteps(guide: Pick<SetupGuideResult, 'steps'>, n = 3): ResolvedStep[] {
  return guide.steps
    .filter(s => s.status === 'needs_attention' || (!s.optional && (s.status === 'todo' || s.status === 'in_progress')))
    .sort((a, b) => RANK[a.status] - RANK[b.status])
    .slice(0, n)
}

export default function SetupProgressCard({ guide, host }: { guide: SetupGuideResult; host: string }) {
  const next = nextSetupSteps(guide)
  if (!next.length) return null
  const base = Math.max(1, guide.counts.total - guide.counts.skipped)
  const pct = Math.round((guide.counts.done / base) * 100)
  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Finish setting up</p>
        <Link href={ap('/admin/setup', host)} className="text-xs font-medium text-accent-600 hover:underline">
          {guide.counts.done} of {base} done · Setup guide
        </Link>
      </div>
      <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
        <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="divide-y divide-border-default">
        {next.map(s => (
          <li key={s.id}>
            <Link href={ap('/admin/setup', host)} className="flex items-center gap-2 py-2 min-w-0 group">
              <span className={badgeCls(s.status === 'needs_attention' ? 'red' : s.status === 'in_progress' ? 'blue' : 'muted')}>
                {s.status === 'needs_attention' ? 'Needs attention' : s.status === 'in_progress' ? 'Waiting' : 'To do'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:text-accent-600">{s.title}</span>
              <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
