function Res({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[11px] uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-xs font-mono text-foreground mt-0.5 break-all">{value || '—'}</dd>
    </div>
  )
}

/** What the run has created so far (created_resources, the rollback record). */
export function ResourcesPanel({
  res,
  tenant,
}: {
  res: Record<string, any>
  tenant: { rds_endpoint: string | null; s3_bucket: string | null }
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-border-default">
        <h2 className="font-semibold text-foreground text-sm">Created resources</h2>
      </div>
      <div className="p-4 sm:p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Res label="Database endpoint" value={res.endpoint || tenant.rds_endpoint} wide />
          <Res label="DB instance" value={res.dbInstanceId ?? res.sharedDbHost} />
          <Res label="Param group" value={res.paramGroup} />
          <Res label="S3 bucket" value={res.bucket || tenant.s3_bucket} wide />
          <Res label="Compute" value={res.computeMode} />
          <Res label="Serving IP" value={res.ec2Target} />
          <Res
            label="Servers"
            wide
            value={
              res.nodeInstances && Object.keys(res.nodeInstances).length ? (
                <span className="flex flex-col gap-0.5">
                  {Object.entries(res.nodeInstances as Record<string, string>).map(([name, id]) => (
                    <span key={name}>
                      {name} · {id}
                    </span>
                  ))}
                </span>
              ) : (
                res.ec2InstanceId
              )
            }
          />
          <Res
            label="DNS hosts"
            wide
            value={
              Array.isArray(res.dnsHosts) && res.dnsHosts.length ? (
                <span className="flex flex-col gap-0.5">
                  {res.dnsHosts.map((h: string) => (
                    <span key={h}>{h}</span>
                  ))}
                </span>
              ) : null
            }
          />
        </dl>
        <details className="mt-4">
          <summary className="text-xs text-foreground-muted cursor-pointer hover:text-foreground transition-colors">Raw created_resources</summary>
          <pre className="mt-2 text-[11px] whitespace-pre-wrap break-all bg-surface-secondary rounded-lg p-3 max-h-64 overflow-y-auto">
            {JSON.stringify(res, null, 2)}
          </pre>
        </details>
      </div>
    </section>
  )
}
