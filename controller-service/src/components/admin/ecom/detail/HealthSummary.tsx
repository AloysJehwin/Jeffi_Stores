import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { StatusBadge } from '@/components/admin/kit/status'
import { Field, FieldGrid, Mono, Section } from '../EcomUI'
import { JOB_STATUS, dateTimeIN } from '../cells'

type Tone = 'good' | 'warn' | 'bad'
const BOX: Record<Tone, string> = {
  good: 'border-green-500/40 bg-green-500/5',
  warn: 'border-amber-500/40 bg-amber-500/5',
  bad: 'border-red-500/40 bg-red-500/5',
}
const DOT: Record<Tone, string> = { good: 'bg-green-500', warn: 'bg-amber-500', bad: 'bg-red-500' }

/** Is the store serving, are its pods up, and how did the last provisioning run end. */
export default function HealthSummary({ d }: { d: TenantDetailData }) {
  const { t, job, fleet, fleetKnown, row } = d
  const serving = t.status === 'active' && !!t.rds_endpoint
  const podsOk = !fleetKnown || (!!fleet?.pods.total && fleet.pods.ready === fleet.pods.total)
  const failed = job?.status === 'failed' || row?.compute_status === 'failed' || fleet?.postgresReady === false
  const tone: Tone = failed || t.status === 'suspended' ? 'bad' : serving && podsOk ? 'good' : 'warn'
  const headline =
    tone === 'good'
      ? 'Serving customers'
      : failed
        ? job?.status === 'failed'
          ? `Provisioning failed at ${job.step}`
          : row?.compute_status === 'failed'
            ? 'A compute change failed'
            : 'Its database pod is not ready'
        : serving
          ? 'Serving, but not every pod is ready'
          : 'Not serving customer traffic'

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <div className={`rounded-xl border p-4 sm:p-5 ${BOX[tone]}`}>
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="font-semibold text-foreground">{headline}</span>
        </div>
      </div>

      <Section title="Health">
        <FieldGrid>
          <Field label="Serving" value={serving ? 'Yes' : 'No'} />
          <Field
            label="Pods"
            value={
              !fleetKnown ? (
                <span className="text-foreground-muted">— (cluster only)</span>
              ) : fleet?.pods.total ? (
                <span className={podsOk ? undefined : 'text-amber-600 dark:text-amber-400'}>
                  {fleet.pods.ready}/{fleet.pods.total} ready
                </span>
              ) : (
                'None running'
              )
            }
          />
          <Field label="Database" value={t.rds_endpoint ? (fleet?.postgresReady === false ? <span className="text-red-600 dark:text-red-400">Pod not ready</span> : 'Provisioned') : 'Not provisioned'} />
          <Field label="Compute" value={<span className="capitalize">{row?.compute_status ?? '—'}</span>} />
          <Field label="Instance state" value={<span className="capitalize">{t.instance_state}</span>} />
          <Field
            label="Last job"
            value={
              job ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={job.status} map={JOB_STATUS} />
                  <Mono>{job.step}</Mono>
                </span>
              ) : (
                '—'
              )
            }
          />
          <Field label="Last change" value={job ? dateTimeIN(job.updated_at) : '—'} />
          <Field label="Worker ticks" value={job ? job.attempts : '—'} />
        </FieldGrid>
        {job?.last_error && (
          <pre className="mt-4 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-all bg-red-500/10 rounded-lg p-3 max-h-48 overflow-y-auto">{job.last_error}</pre>
        )}
      </Section>
    </div>
  )
}
