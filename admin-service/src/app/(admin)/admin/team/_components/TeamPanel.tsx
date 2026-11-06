import { queryOne, queryMany } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import CreateAdminForm from '@/components/admin/CreateAdminForm'
import TeamTable from './TeamTable'
import { Card } from '@/components/admin/kit/layout'
import TeamTabs from './TeamTabs'
import { Suspense } from 'react'
import { ChevronRight } from 'lucide-react'
import { headers } from 'next/headers'
import { ADMIN_SCOPES, isPlatformOwner, assignableScopes } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import SettingsHub from '@/components/admin/SettingsHub'

async function getAdminInfo(adminId: string) {
  return queryOne(
    `SELECT a.id, a.role, a.scopes, a.created_at, a.last_login,
      u.first_name, u.last_name,
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS username
     FROM admins a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = $1`,
    [adminId]
  )
}

async function getAllAdmins() {
  return queryMany(`
    SELECT a.id, a.role, a.scopes, a.is_active, a.created_at, a.last_login,
      a.mfa_enabled, a.idle_timeout_minutes,
      CASE WHEN a.mobile_verified_at IS NOT NULL
        THEN TRIM(LEFT(a.mobile, GREATEST(LENGTH(a.mobile) - 10, 0)) || ' ••••••' || RIGHT(a.mobile, 4)) END AS mobile_hint,
      (SELECT COUNT(*) FROM admin_mfa_recovery_codes WHERE admin_id = a.id AND used_at IS NULL) AS mfa_recovery_codes_remaining,
      u.first_name, u.last_name,
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS username,
      (SELECT json_agg(json_build_object(
        'serial_number', ac.serial_number,
        'expires_at', ac.expires_at,
        'is_revoked', ac.is_revoked,
        'downloaded_at', ac.downloaded_at
      ) ORDER BY ac.created_at DESC) FROM admin_certificates ac WHERE ac.admin_id = a.id) AS certificates
    FROM admins a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.role IS DISTINCT FROM 'service_account'
    ORDER BY a.created_at DESC
  `)
}

// The portal writes downloaded_at/revoked_at to the CENTRAL portal_certs (control plane), not the
// store-local admin_certificates. Overlay that central state onto each cert by serial so the team
// page reflects a portal download/revoke. Best-effort: if the control plane is unreachable, the
// store-local flags stand.
async function overlayPortalState(admins: any[]): Promise<void> {
  const serials = admins
    .flatMap((a: any) => (a.certificates as any[] | null) || [])
    .map((c: any) => c?.serial_number)
    .filter(Boolean)
  if (serials.length === 0) return
  try {
    const { rows } = await controlPlanePool().query(
      `SELECT lower(serial) AS serial, downloaded_at, revoked_at FROM portal_certs
        WHERE lower(serial) = ANY($1::text[])`,
      [serials.map((s: string) => s.toLowerCase())]
    )
    const byId = new Map(rows.map((r: any) => [r.serial, r]))
    for (const a of admins) {
      for (const c of (a.certificates as any[] | null) || []) {
        const central = byId.get(String(c.serial_number).toLowerCase())
        if (!central) continue
        if (central.downloaded_at && !c.downloaded_at) c.downloaded_at = central.downloaded_at
        if (central.revoked_at && !c.is_revoked) c.is_revoked = true
      }
    }
  } catch {
    // control plane unreachable — keep store-local flags
  }
}

function certStatus(admin: any): string {
  const certs = admin.certificates as any[] | null
  if (!certs || certs.length === 0) return 'No Certificate'
  const latest = certs[0]
  if (latest.is_revoked) return 'Revoked'
  if (new Date(latest.expires_at) < new Date()) return 'Expired'
  if (latest.downloaded_at) return 'Active'
  // Platform-owner roles (super_admin / administrator) administer directly and are treated as
  // provisioned — their certificate is not gated on a portal download.
  if (isPlatformOwner(admin.role)) return 'Active'
  return 'Pending Download'
}

/** Team Members tab of the Settings hub. */
export default async function TeamPanel() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()
  // Control-plane scopes belong to the platform operator alone. On a tenant the list narrows
  // again to what its plan actually sells, so nobody is offered a scope the gate would refuse.
  const tenantId = headersList.get('x-tenant-id')
  let visibleScopes = assignableScopes(false)
  let planSlug: string | null = null
  if (tenantId) {
    const { getTenantPlan } = await import('@/lib/auth/plan-gate')
    const { plan, scopes } = await getTenantPlan(tenantId)
    planSlug = plan
    if (scopes.size > 0) visibleScopes = visibleScopes.filter(s => scopes.has(s.key))
  }
  const allowedScopeKeys = tenantId ? visibleScopes.map(s => s.key) : undefined
  const adminInfo = await getAdminInfo(adminId)
  if (!isPlatformOwner(adminInfo?.role || '')) redirect(ap('/admin/settings', host))

  const allAdmins = await getAllAdmins()
  await overlayPortalState(allAdmins as any[])

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => {
    scopeLabels[s.key] = s.label
  })

  return (
    <>
      <SettingsHub active="team" />
      <div className="p-4 sm:p-6 space-y-5">
        <Suspense fallback={null}>
          <TeamTabs>
            {/* Add member */}
            <Card title="Add Team Member" hint="Generate credentials and a client certificate for a new admin user">
              <CreateAdminForm allowedScopeKeys={allowedScopeKeys} />
            </Card>

            <Card
              title="All Members"
              hint={`${allAdmins.filter((a: any) => a.is_active !== false).length} active · ${allAdmins.length} total`}
              flush
            >
              <TeamTable
                admins={allAdmins}
                currentAdminId={adminInfo.id}
                allowedScopeKeys={allowedScopeKeys}
                scopeLabels={scopeLabels}
                certStatuses={Object.fromEntries(allAdmins.map((a: any) => [a.id, certStatus(a)]))}
              />
            </Card>

            <Card
              title="Available Scopes"
              hint={`${visibleScopes.length} scopes${planSlug ? ` on the ${planSlug} plan` : ''} — assign these when creating a team member`}
            >
              <div className="space-y-2">
                {Array.from(new Set(visibleScopes.map(s => s.group || 'General'))).map(groupName => {
                  const groupScopes = visibleScopes.filter(s => (s.group || 'General') === groupName)
                  return (
                    <details key={groupName} className="group rounded-lg border border-border-default bg-surface">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90" aria-hidden />
                        <span className="text-sm font-semibold text-foreground">{groupName}</span>
                        <span className="text-xs text-foreground-muted tabular-nums">{groupScopes.length}</span>
                      </summary>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2.5 px-4 pb-4">
                        {groupScopes.map(scope => (
                          <div key={scope.key} className="flex flex-wrap items-start gap-2.5 sm:flex-nowrap">
                            <span className="shrink-0 max-w-full sm:max-w-none mt-px px-1.5 py-0.5 rounded text-xs font-semibold bg-surface-secondary border border-border-default text-foreground-secondary font-mono leading-tight">
                              {scope.label}
                            </span>
                            <span className="text-xs text-foreground-muted leading-relaxed">{scope.description}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })}
              </div>
            </Card>
          </TeamTabs>
        </Suspense>
      </div>
    </>
  )
}
