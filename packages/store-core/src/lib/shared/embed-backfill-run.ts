// One store's embedding backfill with per-store progress, shared by scripts/backfill-tenant-embeddings.ts.
import { runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { backfillProductEmbeddings, type BackfillResult } from '@/lib/shared/embed-products'

export async function runStoreBackfill(
  label: string,
  ctx: TenantContext | null,
  opts: { force?: boolean; log?: (line: string) => void } = {}
): Promise<BackfillResult> {
  const log = opts.log ?? console.log
  let lastPct = -1
  const fn = () =>
    backfillProductEmbeddings({
      onlyMissing: true,
      force: opts.force,
      onProgress: (done, total) => {
        const pct = total ? Math.floor((done / total) * 10) * 10 : 100
        if (pct !== lastPct) {
          lastPct = pct
          log(`[${label}] ${done}/${total} (${pct}%)`)
        }
      },
    })
  const result = ctx ? await runWithTenantContext(ctx, fn) : await fn()
  log(`[${label}] total=${result.total} embedded=${result.embedded} skipped=${result.skipped} failed=${result.failed}${opts.force ? ' (forced)' : ''}`)
  return result
}
