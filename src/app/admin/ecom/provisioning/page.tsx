import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { listProvisioningJobs, provisioningSummary } from '@/lib/tenant-registry'
import { STEPS } from '@/lib/provisioning/steps'
import { EcomHero, EcomFilters, DetailLink } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

const JOB_PILL: Record<string, string> = {
  done: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  running: 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

function JobPill({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${JOB_PILL[status] || JOB_PILL.pending}`}>
      {status}
    </span>
  )
}

export default async function EcomProvisioningPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const [jobs, summary] = await Promise.all([
    listProvisioningJobs({ status: one(sp, 'status'), q: one(sp, 'q') }),
    provisioningSummary(),
  ])

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Provisioning</h1>
        <p className="text-sm text-foreground-muted mt-1">Infrastructure build jobs — one per tenant, {STEPS.length} steps each</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        <EcomHero
          label="Provisioning jobs"
          value={`${summary.done} / ${summary.total} complete`}
          tiles={[
            { value: summary.running, label: 'In flight' },
            { value: summary.failed, label: 'Failed' },
            { value: summary.done, label: 'Done' },
            { value: summary.total, label: 'Total' },
          ]}
        />
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 lg:h-56 flex flex-col justify-center">
          <h2 className="font-semibold text-foreground mb-2 text-sm">Pipeline</h2>
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted">
                {i + 1}.{s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <EcomFilters
        showPlan={false}
        statusOptions={[
          { value: '', label: 'All job statuses' },
          { value: 'pending', label: 'Pending' },
          { value: 'running', label: 'Running' },
          { value: 'done', label: 'Done' },
          { value: 'failed', label: 'Failed' },
        ]}
      />

      <div className="rounded-xl border border-border-default overflow-x-auto bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">Job status</th>
              <th className="text-left px-4 py-3 font-medium">Step</th>
              <th className="text-left px-4 py-3 font-medium">Progress</th>
              <th className="text-left px-4 py-3 font-medium">Attempts</th>
              <th className="text-left px-4 py-3 font-medium">Updated</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {jobs.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">No provisioning jobs yet.</td></tr>
            )}
            {jobs.map((j) => {
              const idx = STEPS.indexOf(j.step as (typeof STEPS)[number])
              const pct = j.status === 'done' ? 100 : idx < 0 ? 0 : Math.round((idx / STEPS.length) * 100)
              return (
                <tr key={j.id} className="hover:bg-surface-secondary">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <Link href={`/admin/ecom/provisioning/${j.tenant_id}`} className="hover:text-accent-600">{j.display_name}</Link>
                    <div className="text-xs text-foreground-muted">{j.slug}</div>
                  </td>
                  <td className="px-4 py-3"><JobPill status={j.status} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{j.step}</td>
                  <td className="px-4 py-3 min-w-[120px]">
                    <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                      <div className={`h-full ${j.status === 'failed' ? 'bg-red-500' : j.status === 'done' ? 'bg-green-500' : 'bg-accent-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-foreground-muted">{pct}%</span>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary">{j.attempts}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(j.updated_at).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right"><DetailLink href={`/admin/ecom/provisioning/${j.tenant_id}`}>Logs →</DetailLink></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
