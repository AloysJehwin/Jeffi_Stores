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
      )) FROM admin_certificates ac WHERE ac.admin_id = a.id) AS certificates
    FROM admins a
    ORDER BY a.created_at DESC
  `)
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

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Settings</h1>
        <p className="text-foreground-secondary mt-1">Manage your account and system settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Account Information</h2>
            </div>
            <div className="p-4 sm:p-6">
              {adminInfo && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-foreground-secondary">Username</p>
                    <p className="font-medium text-foreground mt-1">{adminInfo.username}</p>
                  </div>
                  <div>
                    <p className="text-sm text-foreground-secondary">Role</p>
                    <p className="font-medium text-foreground mt-1 capitalize">{adminInfo.role.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-foreground-secondary">Scopes</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {adminInfo.role === 'super_admin' ? (
                        <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All Access</span>
                      ) : (
                        (adminInfo.scopes || []).map((scope: string) => (
                          <span key={scope} className="px-2 py-0.5 bg-surface-secondary border border-border-default text-foreground rounded-md text-xs font-medium">
                            {scopeLabels[scope] || scope}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-foreground-secondary">Account Created</p>
                    <p className="font-medium text-foreground mt-1">
                      {new Date(adminInfo.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  {adminInfo.last_login && (
                    <div>
                      <p className="text-sm text-foreground-secondary">Last Login</p>
                      <p className="font-medium text-foreground mt-1">
                        {new Date(adminInfo.last_login).toLocaleDateString('en-IN')} at{' '}
                        {new Date(adminInfo.last_login).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Change Password</h2>
            </div>
            <div className="p-4 sm:p-6">
              <ChangePasswordForm adminId={adminInfo?.id} />
            </div>
          </div>

          {adminInfo?.role === 'super_admin' && (
            <>
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
                <div className="px-6 py-4 border-b border-border-default">
                  <h2 className="text-lg font-semibold text-foreground">Create New Admin</h2>
                  <p className="text-sm text-foreground-muted mt-1">Create an admin user with specific scopes and generate a client certificate</p>
                </div>
                <div className="p-4 sm:p-6">
                  <CreateAdminForm />
                </div>
              </div>

              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
                <div className="px-6 py-4 border-b border-border-default">
                  <h2 className="text-lg font-semibold text-foreground">Admin Users</h2>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="md:hidden space-y-3">
                    {allAdmins.map((admin: any) => {
                      const latestCert = admin.certificates?.[admin.certificates.length - 1]
                      const certStatus = latestCert
                        ? latestCert.is_revoked
                          ? 'Revoked'
                          : new Date(latestCert.expires_at) < new Date()
                          ? 'Expired'
                          : latestCert.downloaded_at
                          ? 'Active'
                          : 'Pending Download'
                        : 'No Certificate'

                      const certStatusColor =
                        certStatus === 'Active' ? 'text-green-600 dark:text-green-400' :
                        certStatus === 'Pending Download' ? 'text-amber-600 dark:text-amber-400' :
                        certStatus === 'Revoked' ? 'text-red-600 dark:text-red-400' :
                        certStatus === 'Expired' ? 'text-red-600 dark:text-red-400' :
                        'text-foreground-muted'

                      return (
                        <div key={admin.id} className="border border-border-default rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-foreground">
                              {admin.username}
                              {admin.id === adminInfo.id && (
                                <span className="ml-2 text-xs text-accent-500">(You)</span>
                              )}
                            </div>
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                              admin.is_active !== false
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                : 'bg-surface-secondary text-foreground'
                            }`}>
                              {admin.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div className="text-xs text-foreground-secondary capitalize mb-2">
                            {admin.role.replace('_', ' ')}
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {admin.role === 'super_admin' ? (
                              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All Access</span>
                            ) : (
                              (admin.scopes || []).map((scope: string) => (
                                <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs">
                                  {scopeLabels[scope] || scope}
                                </span>
                              ))
                            )}
                            {(!admin.scopes || admin.scopes.length === 0) && admin.role !== 'super_admin' && (
                              <span className="text-xs text-foreground-muted">No scopes</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs mb-3">
                            <span className={`font-medium ${certStatusColor}`}>{certStatus}</span>
                            <span className="text-foreground-muted">
                              Login: {admin.last_login ? new Date(admin.last_login).toLocaleDateString('en-IN') : 'Never'}
                            </span>
                          </div>
                          <div className="pt-2 border-t border-border-default">
                            <AdminUserActions admin={admin} currentAdminId={adminInfo.id} />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="hidden md:block overflow-x-auto">
                    <table className="min-w-full divide-y divide-border-default">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Username</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Role</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Scopes</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Certificate</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Last Login</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {allAdmins.map((admin: any) => {
                          const latestCert = admin.certificates?.[admin.certificates.length - 1]
                          const certStatus = latestCert
                            ? latestCert.is_revoked
                              ? 'Revoked'
                              : new Date(latestCert.expires_at) < new Date()
                              ? 'Expired'
                              : latestCert.downloaded_at
                              ? 'Active'
                              : 'Pending Download'
                            : 'No Certificate'

                          const certStatusColor =
                            certStatus === 'Active' ? 'text-green-600 dark:text-green-400' :
                            certStatus === 'Pending Download' ? 'text-amber-600 dark:text-amber-400' :
                            certStatus === 'Revoked' ? 'text-red-600 dark:text-red-400' :
                            certStatus === 'Expired' ? 'text-red-600 dark:text-red-400' :
                            'text-foreground-muted'

                          return (
                            <tr key={admin.id} className="hover:bg-surface-secondary">
                              <td className="px-4 py-3 text-sm font-medium text-foreground">
                                {admin.username}
                                {admin.id === adminInfo.id && (
                                  <span className="ml-2 text-xs text-accent-500">(You)</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground-secondary capitalize">
                                {admin.role.replace('_', ' ')}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {admin.role === 'super_admin' ? (
                                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">All</span>
                                  ) : (
                                    (admin.scopes || []).map((scope: string) => (
                                      <span key={scope} className="px-2 py-0.5 bg-surface-secondary text-foreground-secondary rounded-full text-xs">
                                        {scopeLabels[scope] || scope}
                                      </span>
                                    ))
                                  )}
                                  {(!admin.scopes || admin.scopes.length === 0) && admin.role !== 'super_admin' && (
                                    <span className="text-xs text-foreground-muted">None</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  admin.is_active !== false
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                    : 'bg-surface-secondary text-foreground'
                                }`}>
                                  {admin.is_active !== false ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium ${certStatusColor}`}>
                                  {certStatus}
                                </span>
                                {latestCert && !latestCert.is_revoked && new Date(latestCert.expires_at) > new Date() && (
                                  <p className="text-xs text-foreground-muted mt-0.5">
                                    Exp: {new Date(latestCert.expires_at).toLocaleDateString('en-IN')}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-foreground-secondary">
                                {admin.last_login
                                  ? new Date(admin.last_login).toLocaleDateString('en-IN')
                                  : 'Never'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <AdminUserActions
                                  admin={admin}
                                  currentAdminId={adminInfo.id}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4 sm:space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">System Info</h2>
            </div>
            <div className="p-4 sm:p-6 space-y-3 text-sm">
              <div>
                <p className="text-foreground-secondary">Platform</p>
                <p className="font-medium text-foreground mt-1">Jeffi Stores Admin</p>
              </div>
              <div>
                <p className="text-foreground-secondary">Version</p>
                <p className="font-medium text-foreground mt-1">1.0.0</p>
              </div>
              <div>
                <p className="text-foreground-secondary">Environment</p>
                <p className="font-medium text-foreground mt-1">
                  {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Quick Stats</h2>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-secondary">Total Admins</span>
                <span className="text-lg font-bold text-secondary-500 dark:text-foreground">{allAdmins.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-foreground-secondary">Active Admins</span>
                <span className="text-lg font-bold text-green-500">
                  {allAdmins.filter((a: any) => a.is_active !== false).length}
                </span>
              </div>
            </div>
          </div>

          <ExtensionTokenCard />

          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
            <div className="px-6 py-4 border-b border-border-default">
              <h2 className="text-lg font-semibold text-foreground">Store Rules</h2>
            </div>
            <div className="p-4 sm:p-6">
              <StoreRulesForm minOrderAmount={minOrderAmount} />
            </div>
          </div>

          {adminInfo?.role === 'super_admin' && (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
              <div className="px-6 py-4 border-b border-border-default">
                <h2 className="text-lg font-semibold text-foreground">Available Scopes</h2>
                <p className="text-xs text-foreground-muted mt-1">{ADMIN_SCOPES.length} scopes</p>
              </div>
              <div className="p-4 space-y-4">
                {(['General', 'Catalogue', 'Operations', 'Marketing', 'Settings'] as const).map(groupName => {
                  const groupScopes = ADMIN_SCOPES.filter(s => (s.group || 'General') === groupName)
                  if (groupScopes.length === 0) return null
                  return (
                    <div key={groupName}>
                      <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">{groupName}</p>
                      <div className="divide-y divide-border-default border border-border-default rounded-lg overflow-hidden">
                        {groupScopes.map(scope => (
                          <div key={scope.key} className="flex items-start gap-3 px-4 py-2.5">
                            <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-surface-secondary border border-border-default text-foreground font-mono">
                              {scope.label}
                            </span>
                            <span className="text-xs text-foreground-secondary leading-relaxed">{scope.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
