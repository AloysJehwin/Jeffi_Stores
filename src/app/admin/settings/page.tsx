import { queryOne, queryMany } from '@/lib/db'
import ChangePasswordForm from '@/components/admin/ChangePasswordForm'
import CreateAdminForm from '@/components/admin/CreateAdminForm'
import AdminUserActions from '@/components/admin/AdminUserActions'
import ExtensionTokenCard from '@/components/admin/ExtensionTokenCard'
import StoreRulesForm from '@/components/admin/StoreRulesForm'
import { headers } from 'next/headers'
import { ADMIN_SCOPES } from '@/lib/scopes'

async function getAdminInfo(adminId: string) {
  return queryOne(
    'SELECT id, username, role, scopes, created_at, last_login FROM admins WHERE id = $1',
    [adminId]
  )
}

async function getAllAdmins() {
  return queryMany(`
    SELECT a.id, a.username, a.role, a.scopes, a.is_active, a.created_at, a.last_login,
      (SELECT json_agg(json_build_object(
        'serial_number', ac.serial_number,
        'expires_at', ac.expires_at,
        'is_revoked', ac.is_revoked,
        'downloaded_at', ac.downloaded_at
      ) ORDER BY ac.created_at DESC) FROM admin_certificates ac WHERE ac.admin_id = a.id) AS certificates
    FROM admins a
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

export default async function SettingsPage() {
  const headersList = headers()
  const adminId = headersList.get('x-user-id') || ''

  const adminInfo = await getAdminInfo(adminId)
  const allAdmins = await getAllAdmins()
  const minOrderSetting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
  const minOrderAmount = minOrderSetting ? parseFloat(minOrderSetting.value) || 0 : 0

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => { scopeLabels[s.key] = s.label })

  const isSuperAdmin = adminInfo?.role === 'super_admin'

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-foreground-muted mt-0.5">Manage account, users, and system configuration</p>
      </div>

      {/* ── Account ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
          </div>
          {adminInfo && (
            <div className="p-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <p className="text-foreground-muted text-xs mb-0.5">Username</p>
                <p className="font-medium text-foreground">{adminInfo.username}</p>
              </div>
              <div>
                <p className="text-foreground-muted text-xs mb-0.5">Role</p>
                <p className="font-medium text-foreground capitalize">{adminInfo.role.replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-foreground-muted text-xs mb-0.5">Joined</p>
                <p className="font-medium text-foreground">{new Date(adminInfo.created_at).toLocaleDateString('en-IN')}</p>
              </div>
              <div>
                <p className="text-foreground-muted text-xs mb-0.5">Last Login</p>
                <p className="font-medium text-foreground">
                  {adminInfo.last_login
                    ? `${new Date(adminInfo.last_login).toLocaleDateString('en-IN')} · ${new Date(adminInfo.last_login).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                    : 'Never'}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-foreground-muted text-xs mb-1.5">Scopes</p>
                <div className="flex flex-wrap gap-1.5">
                  {adminInfo.role === 'super_admin' ? (
                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All Access</span>
                  ) : (adminInfo.scopes || []).length > 0 ? (
                    (adminInfo.scopes || []).map((scope: string) => (
                      <span key={scope} className="px-2 py-0.5 bg-surface-secondary border border-border-default text-foreground rounded-md text-xs">
                        {scopeLabels[scope] || scope}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-foreground-muted">No scopes assigned</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Change Password</h2>
          </div>
          <div className="p-5">
            <ChangePasswordForm adminId={adminInfo?.id} />
          </div>
        </div>
      </section>

      {/* ── Store Rules + Extension Token ─────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Store Rules</h2>
          </div>
          <div className="p-5">
            <StoreRulesForm minOrderAmount={minOrderAmount} />
          </div>
        </div>

        <ExtensionTokenCard />
      </section>

      {/* ── Super-admin only ─────────────────────────────────── */}
      {isSuperAdmin && (
        <>
          {/* Create Admin */}
          <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
            <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Create New Admin</h2>
                <p className="text-xs text-foreground-muted mt-0.5">Generate credentials and a client certificate for a new admin user</p>
              </div>
            </div>
            <div className="p-5">
              <CreateAdminForm />
            </div>
          </section>

          {/* Admin Users table */}
          <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
            <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Admin Users</h2>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {allAdmins.filter((a: any) => a.is_active !== false).length} active · {allAdmins.length} total
                </p>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border-default">
              {allAdmins.map((admin: any) => {
                const status = certStatus(admin)
                const cert = (admin.certificates as any[])?.[0]
                return (
                  <div key={admin.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {admin.username}
                          {admin.id === adminInfo.id && <span className="ml-1.5 text-xs text-accent-500">(you)</span>}
                        </p>
                        <p className="text-xs text-foreground-muted capitalize mt-0.5">{admin.role.replace('_', ' ')}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                        admin.is_active !== false
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-surface-secondary text-foreground-muted'
                      }`}>
                        {admin.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {admin.role === 'super_admin' ? (
                        <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All Access</span>
                      ) : (admin.scopes || []).length > 0 ? (
                        (admin.scopes as string[]).map(scope => (
                          <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs">{scopeLabels[scope] || scope}</span>
                        ))
                      ) : (
                        <span className="text-xs text-foreground-muted">No scopes</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-foreground-muted">
                      <CertBadge status={status} />
                      {cert && !cert.is_revoked && new Date(cert.expires_at) > new Date() && (
                        <span>Exp {new Date(cert.expires_at).toLocaleDateString('en-IN')}</span>
                      )}
                      <span className="ml-auto">Login: {admin.last_login ? new Date(admin.last_login).toLocaleDateString('en-IN') : 'Never'}</span>
                    </div>

                    <div className="pt-1">
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
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">User</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Role</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Scopes</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Certificate</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Last Login</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {allAdmins.map((admin: any) => {
                    const status = certStatus(admin)
                    const cert = (admin.certificates as any[])?.[0]
                    return (
                      <tr key={admin.id} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-foreground">
                          {admin.username}
                          {admin.id === adminInfo.id && (
                            <span className="ml-1.5 text-xs text-accent-500 font-normal">(you)</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-foreground-secondary capitalize">
                          {admin.role.replace('_', ' ')}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {admin.role === 'super_admin' ? (
                              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All</span>
                            ) : (admin.scopes || []).length > 0 ? (
                              (admin.scopes as string[]).map(scope => (
                                <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs">{scopeLabels[scope] || scope}</span>
                              ))
                            ) : (
                              <span className="text-xs text-foreground-muted">None</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            admin.is_active !== false
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-surface-secondary text-foreground-muted'
                          }`}>
                            {admin.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <CertBadge status={status} />
                          {cert && !cert.is_revoked && new Date(cert.expires_at) > new Date() && (
                            <p className="text-xs text-foreground-muted mt-0.5">Exp {new Date(cert.expires_at).toLocaleDateString('en-IN')}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-foreground-secondary">
                          {admin.last_login ? new Date(admin.last_login).toLocaleDateString('en-IN') : 'Never'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <AdminUserActions admin={admin} currentAdminId={adminInfo.id} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Available Scopes reference */}
          <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
            <div className="px-5 py-4 border-b border-border-default">
              <h2 className="text-sm font-semibold text-foreground">Available Scopes</h2>
              <p className="text-xs text-foreground-muted mt-0.5">{ADMIN_SCOPES.length} scopes across all groups</p>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(['General', 'Catalogue', 'Operations', 'Marketing', 'Settings'] as const).map(groupName => {
                const groupScopes = ADMIN_SCOPES.filter(s => (s.group || 'General') === groupName)
                if (groupScopes.length === 0) return null
                return (
                  <div key={groupName}>
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">{groupName}</p>
                    <div className="space-y-1">
                      {groupScopes.map(scope => (
                        <div key={scope.key} className="flex items-start gap-2.5 py-1.5">
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold bg-surface-secondary border border-border-default text-foreground font-mono leading-tight mt-px">
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
        </>
      )}

      {/* ── System info (bottom, full width) ─────────────────── */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">System</h2>
        </div>
        <div className="p-5 flex flex-wrap gap-8 text-sm">
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Platform</p>
            <p className="font-medium text-foreground">Jeffi Stores Admin</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Version</p>
            <p className="font-medium text-foreground">1.0.0</p>
          </div>
          <div>
            <p className="text-xs text-foreground-muted mb-0.5">Environment</p>
            <p className="font-medium text-foreground">
              {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
            </p>
          </div>
          {isSuperAdmin && (
            <>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Total Admins</p>
                <p className="font-medium text-foreground">{allAdmins.length}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted mb-0.5">Active Admins</p>
                <p className="font-medium text-green-600 dark:text-green-400">
                  {allAdmins.filter((a: any) => a.is_active !== false).length}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

    </div>
  )
}
