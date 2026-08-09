import { queryOne, queryMany } from '@/lib/db'
import CreateAdminForm from '@/components/admin/CreateAdminForm'
import AdminUserActions from '@/components/admin/AdminUserActions'
import { headers } from 'next/headers'
import { ADMIN_SCOPES } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

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
      a.mfa_enabled,
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
    ORDER BY a.created_at DESC
  `)
}

function CertBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    'Pending Download': 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    Revoked: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    Expired: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    'No Certificate': 'bg-surface-secondary text-foreground-muted',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? map['No Certificate']}`}>
      {status}
    </span>
  )
}

function certStatus(admin: any): string {
  const certs = admin.certificates as any[] | null
  if (!certs || certs.length === 0) return 'No Certificate'
  const latest = certs[0]
  if (latest.is_revoked) return 'Revoked'
  if (new Date(latest.expires_at) < new Date()) return 'Expired'
  if (latest.downloaded_at) return 'Active'
  return 'Pending Download'
}

export default async function TeamPage() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()
  const adminInfo = await getAdminInfo(adminId)
  if (adminInfo?.role !== 'super_admin') redirect(ap('/admin/settings', host))

  const allAdmins = await getAllAdmins()

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => { scopeLabels[s.key] = s.label })

  return (
    <div className="p-4 sm:p-6 space-y-6">

      <div>
        <h1 className="text-2xl font-bold text-foreground">Team Members</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          {allAdmins.filter((a: any) => a.is_active !== false).length} active · {allAdmins.length} total
        </p>
      </div>

      {/* Add member */}
      <div className="hidden md:block">
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">Add Team Member</h2>
          <p className="text-xs text-foreground-muted mt-0.5">Generate credentials and a client certificate for a new admin user</p>
        </div>
        <div className="p-5">
          <CreateAdminForm />
        </div>
      </section>
      </div>

      {/* Members table */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">All Members</h2>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border-default">
          {allAdmins.map((admin: any) => {
            const status = certStatus(admin)
            const cert = (admin.certificates as any[])?.[0]
            const scopes: string[] = admin.scopes || []
            return (
              <div key={admin.id} className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-secondary-500/10 dark:bg-secondary-400/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-secondary-600 dark:text-secondary-400 uppercase">{(admin.first_name || admin.username)[0]}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {admin.first_name && admin.last_name ? `${admin.first_name} ${admin.last_name}` : admin.username}
                        {admin.id === adminInfo.id && <span className="ml-1.5 text-xs font-normal text-accent-500">(you)</span>}
                      </p>
                      <p className="text-xs text-foreground-muted capitalize">{admin.role.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                    admin.is_active !== false
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : 'bg-surface-secondary text-foreground-muted'
                  }`}>
                    {admin.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {admin.role === 'super_admin' ? (
                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All Access</span>
                  ) : scopes.length > 0 ? (
                    <>
                      {scopes.slice(0, 4).map(scope => (
                        <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs">{scopeLabels[scope] || scope}</span>
                      ))}
                      {scopes.length > 4 && (
                        <span className="px-2 py-0.5 bg-surface-secondary text-foreground-muted rounded-full text-xs">+{scopes.length - 4}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-foreground-muted">No scopes</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-foreground-muted">
                  <div className="flex items-center gap-2">
                    <CertBadge status={status} />
                    {cert && !cert.is_revoked && new Date(cert.expires_at) > new Date() && (
                      <span>Exp {new Date(cert.expires_at).toLocaleDateString('en-IN')}</span>
                    )}
                  </div>
                  <span>{admin.last_login ? new Date(admin.last_login).toLocaleDateString('en-IN') : 'Never'}</span>
                </div>

                <div className="pt-0.5">
                  <AdminUserActions admin={admin} currentAdminId={adminInfo.id} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default bg-surface-secondary/40">
                <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-48">Member</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-28">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Scopes</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-24">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-16">2FA</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-40">Certificate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider w-28">Last Login</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {allAdmins.map((admin: any) => {
                const status = certStatus(admin)
                const cert = (admin.certificates as any[])?.[0]
                const scopes: string[] = admin.scopes || []
                const visible = scopes.slice(0, 3)
                const overflow = scopes.length - visible.length
                return (
                  <tr key={admin.id} className="hover:bg-surface-secondary/30 transition-colors">
                    <td className="px-5 py-3 w-48">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-secondary-500/10 dark:bg-secondary-400/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-secondary-600 dark:text-secondary-400 uppercase">{(admin.first_name || admin.username)[0]}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground text-sm truncate">
                            {admin.first_name && admin.last_name ? `${admin.first_name} ${admin.last_name}` : admin.username}
                            {admin.id === adminInfo.id && <span className="ml-1 text-xs font-normal text-accent-500">(you)</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground-secondary capitalize w-28">
                      {admin.role.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-nowrap">
                        {admin.role === 'super_admin' ? (
                          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All</span>
                        ) : scopes.length > 0 ? (
                          <>
                            {visible.map(scope => (
                              <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs whitespace-nowrap">{scopeLabels[scope] || scope}</span>
                            ))}
                            {overflow > 0 && (
                              <span className="px-2 py-0.5 bg-surface-secondary text-foreground-muted rounded-full text-xs whitespace-nowrap">+{overflow}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-foreground-muted">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 w-24">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        admin.is_active !== false
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-surface-secondary text-foreground-muted'
                      }`}>
                        {admin.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-16">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        admin.mfa_enabled
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}>
                        {admin.mfa_enabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-40">
                      <CertBadge status={status} />
                      {cert && !cert.is_revoked && new Date(cert.expires_at) > new Date() && (
                        <p className="text-xs text-foreground-muted mt-0.5">Exp {new Date(cert.expires_at).toLocaleDateString('en-IN')}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground-secondary w-28">
                      {admin.last_login ? new Date(admin.last_login).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <AdminUserActions admin={admin} currentAdminId={adminInfo.id} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Available Scopes */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">Available Scopes</h2>
          <p className="text-xs text-foreground-muted mt-0.5">{ADMIN_SCOPES.length} scopes — assign these when creating a team member</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from(new Set(ADMIN_SCOPES.map(s => s.group || 'General'))).map(groupName => {
            const groupScopes = ADMIN_SCOPES.filter(s => (s.group || 'General') === groupName)
            return (
              <div key={groupName} className="bg-surface rounded-lg border border-border-default p-4">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">{groupName}</p>
                <div className="space-y-2.5">
                  {groupScopes.map(scope => (
                    <div key={scope.key} className="flex items-start gap-2.5">
                      <span className="shrink-0 mt-px px-1.5 py-0.5 rounded text-xs font-semibold bg-secondary-500/10 dark:bg-secondary-400/10 border border-secondary-500/20 dark:border-secondary-400/20 text-secondary-700 dark:text-secondary-300 font-mono leading-tight">
                        {scope.label}
                      </span>
                      <span className="text-xs text-foreground-muted leading-relaxed">{scope.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

    </div>
  )
}
