import { queryOne, queryMany } from '@/lib/db'
import TwoFactorCard from '@/components/admin/TwoFactorCard'
import ExtensionTokenCard from '@/components/admin/ExtensionTokenCard'
import StoreRulesForm from '@/components/admin/StoreRulesForm'
import DeliverySettingsForm from '@/components/admin/DeliverySettingsForm'
import CustomerTagDefinitionsCard from '@/components/admin/CustomerTagDefinitionsCard'
import { getDeliverySettings } from '@/lib/delivery-settings'
import { headers } from 'next/headers'
import { ADMIN_SCOPES } from '@/lib/scopes'

async function getAdminInfo(adminId: string) {
  return queryOne(
    `SELECT a.id, a.role, a.scopes, a.created_at, a.last_login,
      u.first_name, u.last_name, u.email,
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS username
     FROM admins a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.id = $1`,
    [adminId]
  )
}

async function getAllAdmins() {
  return queryMany(`SELECT id, is_active FROM admins`)
}

export default async function SettingsPage() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''

  const adminInfo = await getAdminInfo(adminId)
  const allAdmins = await getAllAdmins()
  const minOrderSetting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
  const minOrderAmount = minOrderSetting ? parseFloat(minOrderSetting.value) || 0 : 0
  const deliverySettings = await getDeliverySettings()

  const scopeLabels: Record<string, string> = {}
  ADMIN_SCOPES.forEach(s => { scopeLabels[s.key] = s.label })

  const isSuperAdmin = adminInfo?.role === 'super_admin'

  return (
    <div className="p-4 sm:p-6 space-y-6">

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
                <p className="text-foreground-muted text-xs mb-0.5">Name</p>
                <p className="font-medium text-foreground">
                  {adminInfo.first_name && adminInfo.last_name
                    ? `${adminInfo.first_name} ${adminInfo.last_name}`
                    : adminInfo.email}
                </p>
              </div>
              <div>
                <p className="text-foreground-muted text-xs mb-0.5">Email</p>
                <p className="font-medium text-foreground">{adminInfo.email}</p>
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
            <h2 className="text-sm font-semibold text-foreground">Two-Factor Authentication</h2>
          </div>
          <div className="p-5">
            <TwoFactorCard />
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

      {/* ── Delivery & Shipping ─────────────────────────────────── */}
      <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-foreground">Delivery & Shipping</h2>
          <p className="text-xs text-foreground-muted mt-0.5">Control whether shipping is charged, set free-delivery thresholds, and apply discounts.</p>
        </div>
        <div className="p-5">
          <DeliverySettingsForm initial={deliverySettings} />
        </div>
      </section>

      {/* ── Customer Tags ──────────────────────────────────────── */}
      <CustomerTagDefinitionsCard isSuperAdmin={isSuperAdmin} />

      {/* ── System info ─────────────────────────────────────────── */}
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
