import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'
import { AI_ACTION_SCOPES } from '@/lib/auth/ai-scope'

/**
 * Every mutating admin endpoint must gate on a :write scope, so an action is never reachable
 * by a read-only member. Several did not: brochure generation and scan/resolve gated on a read
 * scope, and the merchant family had no gate above it at all.
 *
 * The allowlist is for endpoints where a write scope is genuinely wrong — authentication,
 * a caller acting on their own session or MFA, and machine-to-machine callers that carry a
 * bearer secret instead. Adding to it should need a reason.
 */
const ALLOWED_WITHOUT_WRITE_SCOPE = new Set([
  // Pre-auth or self-service: the caller is proving who they are, or acting on themselves.
  'auth/email-otp/start',
  'auth/email-otp/verify',
  'logout',
  'refresh',
  // Activity heartbeat on the caller's own session: extends its idle window, mutates nothing else.
  'session/heartbeat',
  // Draft presence heartbeat: records that the caller has a draft open (display only); passive,
  // gated on the draft type's read scope like viewing the draft itself.
  'draft-locks/presence',
  'mfa/enroll-start',
  'mfa/enroll-confirm',
  'mfa/verify',
  'mfa/recovery-codes',
  'account/mobile/send-otp',
  'account/mobile/verify-otp',
  'sessions/[id]/revoke',
  'sessions/revoke-all',
  'access-request',
  // Self-service: a member marking their own notification bell read, not a scoped action.
  'notifications/read',
  // Self-service: a member's own saved filter views, gated on the list's read scope; sharing a
  // view with the team checks the list's :write scope (writeScopeOf) in the handler.
  'saved-views',
  'saved-views/[id]',
  // Owner-only team management, gated on isPlatformOwner rather than a scope.
  'users',
  'users/[id]',
  'users/[id]/revoke-sessions',
  'users/[id]/resend-certificate',
  // Platform control plane: gated by host and isPlatformAdmin in middleware.
  'ecom/kyc/[tenantId]/approve',
  'ecom/kyc/[tenantId]/reject',
  // Platform-admin tenant billing controls (admin.jeffistores.in): gated on isPlatformAdmin,
  // which is strictly stronger than any :write scope, so a read-only member can never reach them.
  'ecom/[tenantId]/account-mode',
  'ecom/[tenantId]/delivery-mode',
  'ecom/[tenantId]/shipments/[orderId]/correct',
  // Revoke a tenant admin certificate — platform-owner only (isPlatformAdmin), same as the other
  // ecom/[tenantId] controls above.
  'ecom/[tenantId]/certs/revoke',
  // Re-apply a tenant's DNS host set to its plan tier — platform-admin only (isPlatformAdmin).
  'ecom/[tenantId]/dns/resync',
  // Settle a tenant's captured-but-unsettled payments — platform-admin only (isPlatformAdmin).
  'ecom/[tenantId]/reconcile-settlements',
  // Platform-admin shipping-wallet controls (admin.jeffistores.in): manual credit + Delhivery
  // billing reconcile — gated on isPlatformAdmin, stronger than any tenant :write scope.
  'ecom/[tenantId]/wallet',
  'ecom/[tenantId]/wallet/reconcile-billing',
  // Tenant self-recharge GET returns the wallet; its POST is a 403 stub (manual credits are a
  // platform op) — it writes nothing. The real top-up is financial/wallet/topup (delhivery:write).
  'financial/wallet/recharge',
  // Hard-delete of a deprovisioned tenant — gated on isPlatformAdmin (platform super-admin),
  // which is strictly stronger than any :write scope, so a read-only member can never reach it.
  'ecom/customers/[id]/purge',
  // Approve/reject a tenant's Messaging/Documents service — /api/admin/ecom/* is isPlatformAdmin-only
  // in middleware, same as the kyc + purge controls above.
  'ecom/customers/[id]/services',
  // Unlink a store's Google Ads account from the platform manager: isPlatformAdmin-only, like the ecom controls above.
  'ecom/google-ads/[customerId]',
  // Closes the caller's OWN editor session (admin_id must match); opening one is gated on the
  // resource's :write scope, so a read-only member never holds a session to close.
  'editor-sessions/[id]/close',
  // Signature-verified webhook, not an admin action.
  'financial/payables/webhook',
  // Renders a preview; writes nothing.
  'orders/[id]/send-customer-mail/preview',
  // Delivery-estimate preview: computes a date from posted draft settings; writes nothing.
  'edd-settings/preview',
  // Daily ops email preview from the posted draft settings; writes nothing.
  'site-controls/ops-email/preview',
  // Pre-auth: proves identity before any session exists.
  'auth/google',
  // Mints a token whose scopes are filtered to a subset of the caller's own — cannot escalate.
  'token/generate',
  // Cron Jobs self-service (Audit > Cron Jobs tab): a store toggling its OWN scheduled job on/off,
  // gated on audit:read — the read-tier sibling of cron/trigger (which is CRON_SECRET-exempt above).
  // It writes only this store's own cron_enabled_* flag; no cross-tenant or privileged effect.
  'cron/config',
  // Support chat on screen: presence beats, read receipts and translation into the viewer's own
  // language. They record what this member saw; anyone who can read the chat may do them.
  'support/sessions/[sessionId]/heartbeat',
  'support/sessions/[sessionId]/receipts',
  'support/sessions/[sessionId]/translate',
  // The member's own chat language, like their own session or MFA.
  'support/preferences',
  // Approving a customer's reply: decideAsAdmin checks the scenario's record :write scope
  // (orders, quotations, invoices, business_rfqs, subscriptions) before acting.
  'replies/actions/[id]',
])

function mutatingRoutesWithoutWriteScope(): string[] {
  const files = glob.sync('controller-service/src/app/api/\\(admin\\)/admin/**/route.ts', { cwd: process.cwd() })
  const offenders: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    if (!/export async function (POST|PATCH|PUT|DELETE)\b/.test(src)) continue
    // Gates: hasScope(...), requireAdminScope(req, '...:write'), aiDenial(role, scopes, '...:write'),
    // proxyAdminDocs(req, path, '...:write') (document-service proxy; checks hasScope before forwarding),
    // or aiDenial on a resolveAiScope() result, which only yields AI_ACTION_SCOPES (all :write).
    if (/hasScope\([^)]*:write'\)|requireAdminScope\([^)]*:write'\)|aiDenial\([^)]*:write'\)|proxyAdminDocs\([^)]*:write'\)/.test(src)) continue
    // Drive and support route helpers that authenticate and check the named scope (lib/drive/http,
    // lib/support/http).
    if (/(driveActor|adminChat|adminFor)\([^)]*:write'/.test(src)) continue
    // hasScope over a const list/map whose scope literals are all :write (uploads/image EDIT_SCOPES.some(...),
    // editor-sessions WRITE_SCOPE[resourceType]).
    const lits = src.match(/'[a-z_]+:(?:read|write)'/g) ?? []
    if (/hasScope\(/.test(src) && lits.length > 0 && lits.every(l => l.endsWith(":write'"))) continue
    if (/aiDenial\(/.test(src) && /resolveAiScope\(/.test(src)) continue
    if (/CRON_SECRET|verifyCronRequest|authenticateServiceAccount/.test(src)) continue
    const route = f.replace('controller-service/src/app/api/(admin)/admin/', '').replace('/route.ts', '')
    if (ALLOWED_WITHOUT_WRITE_SCOPE.has(route)) continue
    offenders.push(route)
  }
  return offenders.sort()
}

// Admin-only handlers that live OUTSIDE /api/admin (the storefront-facing api tree) but are
// only ever called by the admin console. They authenticate as an admin, so a read-only member
// with a valid admin session could reach the write unless it also gates on a :write scope.
// Each glob is a mutating handler that must carry the same :write check the /api/admin tree uses.
const ADMIN_ONLY_OUTSIDE_ADMIN = [
  'controller-service/src/app/api/(public)/brands/route.ts',
  'controller-service/src/app/api/(public)/brands/[id]/route.ts',
  'controller-service/src/app/api/(public)/categories/[id]/route.ts',
  'controller-service/src/app/api/(public)/categories/reorder/route.ts',
  'controller-service/src/app/api/(public)/upload/route.ts',
  'controller-service/src/app/api/(public)/gallery/upload/route.ts',
  'controller-service/src/app/api/(public)/generate-image/route.ts',
  'controller-service/src/app/api/(public)/orders/[id]/refund/route.ts',
  'controller-service/src/app/api/(public)/orders/[id]/cancel-review/route.ts',
  'controller-service/src/app/api/(public)/orders/[id]/return-review/route.ts',
  'controller-service/src/app/api/(public)/orders/[id]/route.ts',
  'controller-service/src/app/api/(public)/razorpay/payment-link/route.ts',
  'controller-service/src/app/api/(public)/products/[id]/route.ts',
]

// products/[id] DELETE is a hard 405 that mutates nothing, so it needs no scope; the file's
// PATCH is what carries products:write.
const MUTATING_WITHOUT_SCOPE_OK = new Set(['controller-service/src/app/api/(public)/products/[id]/route.ts'])

function adminOnlyRoutesWithoutWriteScope(): string[] {
  const offenders: string[] = []
  for (const f of ADMIN_ONLY_OUTSIDE_ADMIN) {
    const abs = path.join(process.cwd(), f)
    if (!fs.existsSync(abs)) {
      offenders.push(`${f} (missing)`)
      continue
    }
    const src = fs.readFileSync(abs, 'utf8')
    if (!/export async function (POST|PATCH|PUT|DELETE)\b/.test(src)) continue
    if (/hasScope\([^)]*:write'\)|requireAdminScope\([^)]*:write'\)|aiDenial\([^)]*:write'\)/.test(src)) continue
    if (MUTATING_WITHOUT_SCOPE_OK.has(f)) continue
    offenders.push(f)
  }
  return offenders.sort()
}

describe('an admin action is never reachable with read-only access', () => {
  it('gates every mutating endpoint on a :write scope', () => {
    expect(mutatingRoutesWithoutWriteScope()).toEqual([])
  })

  it('gates admin-only write handlers outside /api/admin on a :write scope', () => {
    expect(adminOnlyRoutesWithoutWriteScope()).toEqual([])
  })

  it('only allows :write scopes for client-chosen AI field scopes', () => {
    expect(AI_ACTION_SCOPES.filter(s => !s.endsWith(':write'))).toEqual([])
  })

  it('reads a meaningful number of routes (guards the glob)', () => {
    expect(glob.sync('controller-service/src/app/api/\\(admin\\)/admin/**/route.ts', { cwd: process.cwd() }).length).toBeGreaterThanOrEqual(339)
  })
})
