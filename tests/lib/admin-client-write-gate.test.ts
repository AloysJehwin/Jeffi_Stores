import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'

/**
 * A read-only member must not be offered an action they cannot take. The endpoints already
 * refuse the write (admin-write-scope-audit), so this is the UX half: every admin client
 * component that fires a mutating request gates its controls through AdminScopesContext
 * (useCanWrite / RequireWrite, or useCanUseAi / RequireAi, which also require the write scope).
 *
 * The allowlist is for components where a tenant :write scope is the wrong gate — a member
 * acting on their own identity or session, the owner-only team/service-account surfaces, and
 * the platform control plane (host + isPlatformAdmin), plus read-only views whose only
 * mutating call is an export or filter persist.
 */
const ALLOWED_WITHOUT_CLIENT_GATE = new Set([
  // Auth / self-service: the member is proving who they are or acting on themselves.
  'controller-service/src/app/(admin)/admin/login/page.tsx',
  'controller-service/src/components/admin/AdminSessionController.tsx',
  'controller-service/src/components/admin/AccessDenied.tsx',
  'controller-service/src/components/admin/TwoFactorCard.tsx',
  'controller-service/src/components/admin/AdminSupportChat.tsx',
  'controller-service/src/components/admin/AdminAgentModal.tsx',
  // Self-service: marks the member's own notification bell read; no scoped record mutation.
  'controller-service/src/components/admin/NotificationBell.tsx',
  // Self-service: the member's own saved filter views. Sharing one is offered only when the
  // server reports the list's :write scope (canShare), which the routes enforce again.
  'controller-service/src/components/admin/kit/saved-views.tsx',
  // Platform control plane: gated by host + isPlatformAdmin, not a tenant scope.
  'controller-service/src/components/admin/ecom/tabs/KycActionButtons.tsx',
  'controller-service/src/components/admin/ecom/TenantActions.tsx',
  'controller-service/src/components/admin/ecom/PurgeCustomerButton.tsx',
  'controller-service/src/app/(admin)/admin/ecom/billing/[id]/AccountModeToggle.tsx',
  'controller-service/src/app/(admin)/admin/ecom/billing/[id]/DeliveryModeToggle.tsx',
  // DNS re-sync for a tenant: platform-admin only (isPlatformAdmin), same as the sibling toggles.
  'controller-service/src/app/(admin)/admin/ecom/billing/[id]/DnsResyncButton.tsx',
  'controller-service/src/app/(admin)/admin/ecom/billing/[id]/ReconcileButton.tsx',
  'controller-service/src/components/admin/ecom/tabs/ShipmentCorrection.tsx',
  'controller-service/src/components/admin/ecom/tabs/BillingReconcile.tsx',
  'controller-service/src/components/admin/ecom/tabs/MessagingTab.tsx',
  'controller-service/src/components/admin/ecom/tabs/ServiceApprovals.tsx',
  // Google Ads manager view (unlink): the page redirects non-platform admins and the API is isPlatformAdmin-only.
  'controller-service/src/app/(admin)/admin/ecom/google-ads/ManagedAccountsClient.tsx',
  // Owner-only: gated on isPlatformOwner, which no tenant scope expresses.
  'controller-service/src/components/admin/CreateAdminForm.tsx',
  'controller-service/src/components/admin/AdminUserActions.tsx',
  'controller-service/src/components/admin/ServiceAccountRevokeButton.tsx',
  // Owner-only revoke rendered only for owners by service-accounts/_components/ServiceAccountsPanel.tsx (replaced the button above).
  'controller-service/src/components/admin/ServiceAccountRowActions.tsx',
  'controller-service/src/app/(admin)/admin/service-accounts/add/page.tsx',
  // Read-only view; its only POST is an export/filter, not a scoped write.
  'controller-service/src/app/(admin)/admin/audit/AdminAuditClient.tsx',
  // Dashboard shell: its only POST is a fire-and-forget payout reconciliation on mount,
  // not a user action. Each mutating tab (receivables/payables/cod) gates on financial:write.
  'controller-service/src/app/(admin)/admin/financial/FinancialClient.tsx',
  // Gated on the exact :write scope, but through a server-derived canWrite prop
  // (hasScope(role, scopes, '<area>:write') in the page) rather than the client context.
  'controller-service/src/app/(admin)/admin/products/ProductsTableClient.tsx',
  'controller-service/src/app/(admin)/admin/products/_components/ProductsMobileList.tsx',
  'controller-service/src/app/(admin)/admin/invoices/InvoicesClient.tsx',
  'controller-service/src/app/(admin)/admin/quotations/QuotationsClient.tsx',
  // Gated by a server-derived `canWrite` prop that wraps the RowActions ({canWrite && <RowActions/>}).
  'controller-service/src/components/admin/CouponTableRow.tsx',
  // Gated on a server-derived canWrite prop (hasScope(role, scopes, 'service_accounts:write')
  // in the page), passed in and used to gate every action — same pattern as the siblings above.
  'controller-service/src/app/(admin)/admin/service-accounts/_components/ServiceAccountsMobileList.tsx',
  // Read-only document/label exports (GET/PDF); no record mutation to gate.
  'controller-service/src/app/(admin)/admin/packing-slips/PackingSlipsClient.tsx',
  'controller-service/src/app/(admin)/admin/packing-slips/_components/order-documents.tsx',
  'controller-service/src/app/(admin)/admin/labels/LabelsClient.tsx',
  'controller-service/src/components/admin/BatchSerialLabelPicker.tsx',
  'controller-service/src/app/(admin)/admin/products/_components/ProductLabelModal.tsx',
  // Shared modal committed via a parent-owned onConfirm — the gate sits on each caller's
  // open control (cash-sale, quotations, invoices, order status), not the modal.
  'controller-service/src/components/admin/BatchPickerModal.tsx',
  // Shared "Fill from scenario" dialog — the opener is only rendered when the caller
  // passes canUseScenarioFill (useCanWrite('templates') / server-derived canEdit), and
  // the applyFill callback lives in the parent editor. Same pattern as BatchPickerModal.
  'controller-service/src/components/admin/messaging-templates/ScenarioFillDialog.tsx',
  // Draft merge dialog: opens only from a publish the caller already gated (draft editors, DraftRowActions).
  'controller-service/src/components/admin/drafts/MergeDialog.tsx',
  // Mutation lives in the parent form; this is a field editor feeding onChange.
  'controller-service/src/components/admin/LineItemsSection.tsx',
  // Image-URL field feeding onChange; its upload POST is a CDN asset write the server gates on the
  // parent form's :write scope (uploads/image EDIT_SCOPES). The record mutation lives in the parent.
  'controller-service/src/components/admin/ImageUrlInput.tsx',
  // Gated on the stricter isSuperAdmin, which no tenant :write scope expresses.
  'controller-service/src/components/admin/CustomerTagDefinitionsCard.tsx',
])

function mutatingClientComponents(): string[] {
  const files = glob.sync(['controller-service/src/app/\\(admin\\)/admin/**/*.tsx', 'controller-service/src/components/admin/**/*.tsx'], {
    cwd: process.cwd(),
  })
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
      // A gate is: the client scope hooks/components, OR a RowActions action carrying a
      // `scope: '<area>:write'` descriptor (RowActions hides scoped actions via useCanWrite).
      return !(
        /useCanWrite\(|RequireWrite\b|useCanUseAi\(|RequireAi\b|useHasScope\(['"][^'"]+:write['"]\)/.test(src) ||
        /scope: *['"][^'"]+:write['"]/.test(src)
      )
    })
    .sort()
}

describe('every mutating admin view gates its actions on a write scope', () => {
  it('reads a meaningful number of components (guards the glob)', () => {
    expect(mutatingClientComponents().length).toBeGreaterThanOrEqual(126)
  })

  it('leaves no mutating view without a client-side write gate', () => {
    expect(ungatedMutatingComponents()).toEqual([])
  })
})
