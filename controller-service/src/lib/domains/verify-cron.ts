import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { verifyDomain } from './dns-verify'
import { requestCert, isCertReady } from './acm'

// Cron entry point: moves every in-flight custom domain forward one step.
// pending       → verify TXT; on match → dns-verified
// dns-verified  → requestCert → cert-pending
// cert-pending  → isCertReady (cert-manager has issued) → verified
// 'verified' domains are picked up by reconcileK8sPlan's listCustomDomains filter.
export async function runDomainVerifyCron(): Promise<{
  checked: number
  advanced: number
  errors: Array<{ id: string; error: string }>
}> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, status FROM tenant_custom_domains
     WHERE status IN ('pending','dns-verified','cert-pending')`
  )
  const rows: Array<{ id: string; status: string }> = res.rows
  let advanced = 0
  const errors: Array<{ id: string; error: string }> = []

  // Trigger a k8s reconcile when any domain moves to 'verified', so the IngressRoute refreshes.
  const tenantsToReconcile = new Set<string>()

  for (const row of rows) {
    try {
      if (row.status === 'pending') {
        const out = await verifyDomain(row.id)
        if (out.ok) advanced++
      } else if (row.status === 'dns-verified') {
        // Re-check in case DNS flipped away; otherwise request the cert.
        await verifyDomain(row.id).catch(() => {})
        await requestCert(row.id)
        advanced++
      } else if (row.status === 'cert-pending') {
        const ready = await isCertReady(row.id)
        if (ready) {
          advanced++
          const t = await pool.query(`SELECT tenant_id FROM tenant_custom_domains WHERE id=$1`, [row.id])
          if (t.rows[0]?.tenant_id) tenantsToReconcile.add(t.rows[0].tenant_id)
        }
      }
    } catch (e) {
      errors.push({ id: row.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Nudge the workload reconcile so verified domains get their Ingress + Certificate applied.
  if (tenantsToReconcile.size) {
    try {
      const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
      const { getProvisioningProvider } = await import('@controller/lib/provisioning')
      const provider = await getProvisioningProvider()
      for (const tenantId of tenantsToReconcile) {
        await reconcileK8sPlan(tenantId, provider, { force: true }).catch(e => {
          errors.push({ id: tenantId, error: `reconcile: ${e instanceof Error ? e.message : String(e)}` })
        })
      }
    } catch (e) {
      errors.push({ id: 'reconcile', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { checked: rows.length, advanced, errors }
}
