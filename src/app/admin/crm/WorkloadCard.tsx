'use client'

import { CompactStat, ListRows, numStr, hoursStr } from '@/components/admin/dashboard/Primitives'
import { ap } from '@/lib/admin-path'
import type { Workload, Assignee, NotesWeek } from '@/lib/crm-insights-shared'

function Sparkline({ weeks }: { weeks: NotesWeek[] }) {
  const max = Math.max(1, ...weeks.map(w => w.count))
  return (
    <div className="flex items-end gap-1 h-10">
      {weeks.map(w => (
        <div key={w.week} className="flex-1 flex flex-col justify-end h-full" title={`${w.week}: ${w.count} notes`}>
          <div className="w-full rounded-sm bg-accent-500/40" style={{ height: `${Math.max(w.count > 0 ? 8 : 2, Math.round((w.count / max) * 100))}%` }} />
        </div>
      ))}
    </div>
  )
}

export default function WorkloadCard({ workload, tasksByAssignee, notesPerWeek }: {
  workload: Workload; tasksByAssignee: Assignee[]; notesPerWeek: NotesWeek[]
}) {
  const empty = workload.open === 0 && workload.overdue === 0 && tasksByAssignee.length === 0
    && notesPerWeek.every(w => w.count === 0)
  if (empty) return null

  const rows = tasksByAssignee.map(a => ({
    key: a.id || a.name,
    primary: a.name,
    secondary: a.overdue > 0 ? `${numStr(a.overdue)} overdue` : undefined,
    value: numStr(a.open),
    href: ap('/admin/tasks?scope=all&status=open'),
  }))

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Team Workload</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <CompactStat label="Open tasks" value={numStr(workload.open)} />
        <CompactStat label="Overdue" value={numStr(workload.overdue)} tone={workload.overdue > 0 ? 'text-red-600 dark:text-red-400' : undefined} />
        <CompactStat label="Auto created" value={numStr(workload.openAuto)} />
        <CompactStat label="Median close time" value={hoursStr(workload.medianHours)} />
      </div>

      {rows.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-1">Open tasks by assignee</p>
          <ListRows rows={rows} />
        </>
      )}

      {notesPerWeek.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Notes per week</p>
          <Sparkline weeks={notesPerWeek} />
        </div>
      )}
    </div>
  )
}
