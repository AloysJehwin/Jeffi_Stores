import { supabaseAdmin } from '@/lib/supabase'
import ChangePasswordForm from '@/components/admin/ChangePasswordForm'
import { headers } from 'next/headers'

async function getAdminInfo(adminId: string) {
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('id, username, role, created_at, last_login, is_active')
    .eq('id', adminId)
    .single()

  if (error) return null
  return data
}

async function getAllAdmins() {
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('id, username, role, is_active, created_at, last_login')
    .order('created_at', { ascending: false })

  if (error) return []
  return data
}

export default async function SettingsPage() {
  // Middleware already verified authentication and set user headers
  const headersList = headers()
  const adminId = headersList.get('x-user-id') || ''

  const adminInfo = await getAdminInfo(adminId)
  const allAdmins = await getAllAdmins()

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

          {/* All Admins (Super Admin Only) */}
          {adminInfo?.role === 'super_admin' && (
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {allAdmins.map((admin: any) => (
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
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              admin.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {admin.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {admin.last_login
                              ? new Date(admin.last_login).toLocaleDateString('en-IN')
                              : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
                  {allAdmins.filter((a: any) => a.is_active).length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
