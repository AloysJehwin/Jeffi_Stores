import { queryOne, queryMany } from '@/lib/db'
import ChangePasswordForm from '@/components/admin/ChangePasswordForm'
import CreateAdminForm from '@/components/admin/CreateAdminForm'
import AdminUserActions from '@/components/admin/AdminUserActions'
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

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => { scopeLabels[s.key] = s.label })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-secondary-500">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account and system settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Information */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Account Information</h2>
            </div>
            <div className="p-6">
              {adminInfo && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Username</p>
                    <p className="font-medium text-gray-900 mt-1">{adminInfo.username}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Role</p>
                    <p className="font-medium text-gray-900 mt-1 capitalize">{adminInfo.role.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Scopes</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {adminInfo.role === 'super_admin' ? (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">All Access</span>
                      ) : (
                        (adminInfo.scopes || []).map((scope: string) => (
                          <span key={scope} className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded-full text-xs font-medium">
                            {scopeLabels[scope] || scope}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Account Created</p>
                    <p className="font-medium text-gray-900 mt-1">
                      {new Date(adminInfo.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  {adminInfo.last_login && (
                    <div>
                      <p className="text-sm text-gray-600">Last Login</p>
                      <p className="font-medium text-gray-900 mt-1">
                        {new Date(adminInfo.last_login).toLocaleDateString('en-IN')} at{' '}
                        {new Date(adminInfo.last_login).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Change Password */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
            </div>
            <div className="p-6">
              <ChangePasswordForm adminId={adminInfo?.id} />
            </div>
          </div>

          {/* Admin Users Management (Super Admin Only) */}
          {adminInfo?.role === 'super_admin' && (
            <>
              {/* Create New Admin */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Create New Admin</h2>
                  <p className="text-sm text-gray-500 mt-1">Create an admin user with specific scopes and generate a client certificate</p>
                </div>
                <div className="p-6">
                  <CreateAdminForm />
                </div>
              </div>

              {/* All Admins */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Admin Users</h2>
                </div>
                <div className="p-6">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scopes</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificate</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
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
                            certStatus === 'Active' ? 'text-green-600' :
                            certStatus === 'Pending Download' ? 'text-amber-600' :
                            certStatus === 'Revoked' ? 'text-red-600' :
                            certStatus === 'Expired' ? 'text-red-600' :
                            'text-gray-400'

                          return (
                            <tr key={admin.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                {admin.username}
                                {admin.id === adminInfo.id && (
                                  <span className="ml-2 text-xs text-accent-500">(You)</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 capitalize">
                                {admin.role.replace('_', ' ')}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {admin.role === 'super_admin' ? (
                                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">All</span>
                                  ) : (
                                    (admin.scopes || []).map((scope: string) => (
                                      <span key={scope} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                                        {scopeLabels[scope] || scope}
                                      </span>
                                    ))
                                  )}
                                  {(!admin.scopes || admin.scopes.length === 0) && admin.role !== 'super_admin' && (
                                    <span className="text-xs text-gray-400">None</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                  admin.is_active !== false
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {admin.is_active !== false ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium ${certStatusColor}`}>
                                  {certStatus}
                                </span>
                                {latestCert && !latestCert.is_revoked && new Date(latestCert.expires_at) > new Date() && (
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    Exp: {new Date(latestCert.expires_at).toLocaleDateString('en-IN')}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
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

        {/* Sidebar */}
        <div className="space-y-6">
          {/* System Information */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">System Info</h2>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div>
                <p className="text-gray-600">Platform</p>
                <p className="font-medium text-gray-900 mt-1">Jeffi Stores Admin</p>
              </div>
              <div>
                <p className="text-gray-600">Version</p>
                <p className="font-medium text-gray-900 mt-1">1.0.0</p>
              </div>
              <div>
                <p className="text-gray-600">Environment</p>
                <p className="font-medium text-gray-900 mt-1">
                  {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Quick Stats</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Admins</span>
                <span className="text-lg font-bold text-secondary-500">{allAdmins.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Active Admins</span>
                <span className="text-lg font-bold text-green-500">
                  {allAdmins.filter((a: any) => a.is_active !== false).length}
                </span>
              </div>
            </div>
          </div>

          {/* Scope Reference */}
          {adminInfo?.role === 'super_admin' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Available Scopes</h2>
              </div>
              <div className="p-6 space-y-2">
                {ADMIN_SCOPES.map(scope => (
                  <div key={scope.key} className="flex items-start gap-2">
                    <span className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded text-xs font-mono mt-0.5">
                      {scope.key}
                    </span>
                    <span className="text-xs text-gray-500">{scope.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
