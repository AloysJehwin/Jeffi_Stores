import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'

/**
 * A read-only member must not be offered an action they cannot take. The endpoints already
 * refuse the write (admin-write-scope-audit), so this is the UX half: every admin client
 * component that fires a mutating request gates its controls through AdminScopesContext
 * (useCanWrite / RequireWrite).
 *
 * The allowlist is for components where a tenant :write scope is the wrong gate — a member
 * acting on their own identity or session, the owner-only team/service-account surfaces, and
 * the platform control plane (host + isPlatformAdmin), plus read-only views whose only
 * mutating call is an export or filter persist.
 */
const ALLOWED_WITHOUT_CLIENT_GATE = new Set([
  // Auth / self-service: the member is proving who they are or acting on themselves.
  'src/app/admin/login/page.tsx',
  'src/components/admin/SessionGuard.tsx',
  'src/components/admin/AccessDenied.tsx',
  'src/components/admin/TwoFactorCard.tsx',
  'src/components/admin/AdminSupportChat.tsx',
  'src/components/admin/AdminAgentModal.tsx',
  // Idle auto-logout: POSTs /api/admin/logout on the member's own session (logging oneself out is
  // always allowed) — not a scoped record mutation, so no write gate applies.
  'src/components/admin/AdminIdleWatcher.tsx',
  // Self-service: marks the member's own notification bell read; no scoped record mutation.
  'src/components/admin/NotificationBell.tsx',
  // Platform control plane: gated by host + isPlatformAdmin, not a tenant scope.
  'src/app/admin/ecom/kyc/KycActionButtons.tsx',
  'src/components/admin/ecom/TenantActions.tsx',
  'src/components/admin/ecom/PurgeCustomerButton.tsx',
  'src/app/admin/ecom/billing/[id]/AccountModeToggle.tsx',
  'src/app/admin/ecom/billing/[id]/DeliveryModeToggle.tsx',
  'src/components/admin/ecom/tabs/ShipmentCorrection.tsx',
  // Owner-only: gated on isPlatformOwner, which no tenant scope expresses.
  'src/components/admin/CreateAdminForm.tsx',
  'src/components/admin/AdminUserActions.tsx',
  'src/components/admin/ServiceAccountRevokeButton.tsx',
  'src/app/admin/service-accounts/add/page.tsx',
  // Read-only view; its only POST is an export/filter, not a scoped write.
  'src/app/admin/audit/AdminAuditClient.tsx',
  // Gated on the exact :write scope, but through a server-derived canWrite prop
  // (hasScope(role, scopes, '<area>:write') in the page) rather than the client context.
  'src/components/admin/ProductsTableClient.tsx',
  'src/app/admin/invoices/InvoicesClient.tsx',
  'src/app/admin/quotations/QuotationsClient.tsx',
  // Read-only document/label exports (GET/PDF); no record mutation to gate.
  'src/app/admin/packing-slips/PackingSlipsClient.tsx',
  'src/components/admin/LabelsClient.tsx',
  'src/components/admin/BatchSerialLabelPicker.tsx',
  'src/components/admin/ProductLabelModal.tsx',
  // Shared modal committed via a parent-owned onConfirm — the gate sits on each caller's
  // open control (cash-sale, quotations, invoices, order status), not the modal.
  'src/components/admin/BatchPickerModal.tsx',
  // Mutation lives in the parent form; this is a field editor feeding onChange.
  'src/components/admin/LineItemsSection.tsx',
  // Gated on the stricter isSuperAdmin, which no tenant :write scope expresses.
  'src/components/admin/CustomerTagDefinitionsCard.tsx',
])

function mutatingClientComponents(): string[] {
  const files = glob.sync(['src/app/admin/**/*.tsx', 'src/components/admin/**/*.tsx'], { cwd: process.cwd() })
  const out: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    if (!/['"]use client['"]/.test(src)) continue
    if (!/method: *['"](POST|PATCH|PUT|DELETE)['"]/.test(src)) continue
    out.push(f)
  }
  return out
}

function ungatedMutatingComponents(): string[] {
  return mutatingClientComponents()
    .filter(f => !ALLOWED_WITHOUT_CLIENT_GATE.has(f))
    .filter(f => {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      return !/useCanWrite\(|RequireWrite\b/.test(src)
    })
    .sort()
}

describe('every mutating admin view gates its actions on a write scope', () => {
  it('reads a meaningful number of components (guards the glob)', () => {
    expect(mutatingClientComponents().length).toBeGreaterThan(100)
  })

  it('leaves no mutating view without a client-side write gate', () => {
    expect(ungatedMutatingComponents()).toEqual([])
  })
})
