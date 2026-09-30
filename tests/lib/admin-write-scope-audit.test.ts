import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'
import { AI_ACTION_SCOPES } from '@/lib/ai-scope'

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
  'mfa/enroll-start',
  'mfa/enroll-confirm',
  'mfa/verify',
  'mfa/recovery-codes',
  'sessions/[id]/revoke',
  'sessions/revoke-all',
  'access-request',
  // Self-service: a member marking their own notification bell read, not a scoped action.
  'notifications/read',
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
  // Hard-delete of a deprovisioned tenant — gated on isPlatformAdmin (platform super-admin),
  // which is strictly stronger than any :write scope, so a read-only member can never reach it.
  'ecom/customers/[id]/purge',
  // Signature-verified webhook, not an admin action.
  'financial/payables/webhook',
  // Renders a preview; writes nothing.
  'orders/[id]/send-customer-mail/preview',
  // Pre-auth: proves identity before any session exists.
  'auth/google',
  // Mints a token whose scopes are filtered to a subset of the caller's own — cannot escalate.
  'token/generate',
])

function mutatingRoutesWithoutWriteScope(): string[] {
  const files = glob.sync('src/app/api/admin/**/route.ts', { cwd: process.cwd() })
  const offenders: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    if (!/export async function (POST|PATCH|PUT|DELETE)\b/.test(src)) continue
    // Gates: hasScope(...), requireAdminScope(req, '...:write'), and aiDenial(role, scopes, '...:write'),
    // or aiDenial on a resolveAiScope() result, which only yields AI_ACTION_SCOPES (all :write).
    if (/hasScope\([^)]*:write'\)|requireAdminScope\([^)]*:write'\)|aiDenial\([^)]*:write'\)/.test(src)) continue
    if (/aiDenial\(/.test(src) && /resolveAiScope\(/.test(src)) continue
    if (/CRON_SECRET|verifyCronRequest|authenticateServiceAccount/.test(src)) continue
    const route = f.replace('src/app/api/admin/', '').replace('/route.ts', '')
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
  'src/app/api/brands/route.ts',
  'src/app/api/brands/[id]/route.ts',
  'src/app/api/categories/[id]/route.ts',
  'src/app/api/categories/reorder/route.ts',
  'src/app/api/upload/route.ts',
  'src/app/api/gallery/upload/route.ts',
  'src/app/api/generate-image/route.ts',
  'src/app/api/orders/[id]/refund/route.ts',
  'src/app/api/orders/[id]/cancel-review/route.ts',
  'src/app/api/orders/[id]/return-review/route.ts',
  'src/app/api/orders/[id]/route.ts',
  'src/app/api/razorpay/payment-link/route.ts',
  'src/app/api/products/[id]/route.ts',
]

// products/[id] DELETE is a hard 405 that mutates nothing, so it needs no scope; the file's
// PATCH is what carries products:write.
const MUTATING_WITHOUT_SCOPE_OK = new Set(['src/app/api/products/[id]/route.ts'])

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
    expect(glob.sync('src/app/api/admin/**/route.ts', { cwd: process.cwd() }).length).toBeGreaterThanOrEqual(339)
  })
})
