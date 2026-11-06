import type { NextRequest } from 'next/server'
import { verifyToken, verifyExtensionToken, type AdminJWTPayload } from '@/lib/auth/jwt'
import { effectiveScopes, type SessionSignals } from '@/lib/auth/auth-sessions'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { adminCookieNameForHost } from '@/lib/auth/admin-cookie'
import { getScopeForPath, hasScope, isPlatformAdmin, SUPER_ROLES } from '@/lib/auth/scopes'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { queryOne } from '@/lib/shared/db'
import { GATEWAY_HEADER, verifyGatewayToken } from '@jeffi/service-auth'
import { ALL_SCOPES, isApiToken, isApiTokenLive, resolveApiToken, storeTenantId, type ApiTokenKind } from '@/lib/auth/api-tokens'

// One admin identity for every caller of the admin API: the public gateway's signed header, a jfc_/jsa_
// token, a cookie or bearer session, the legacy extension JWT, or a service account's client certificate.
// A gateway header decides alone; otherwise bearer, cookie, then cert, and the first that resolves wins.

export type AdminPrincipalKind = 'session' | 'extension' | 'service_account' | 'cli' | 'gateway'

export interface AdminPrincipal extends AdminJWTPayload {
  kind: AdminPrincipalKind
  credential: 'cookie' | 'bearer' | 'cert' | 'gateway'
  tenantId: string | null
  /** gateway: the kind of token behind it. */
  via?: ApiTokenKind
  /** admin_api_tokens.id of a jfc_/jsa_ token (direct or through the gateway). */
  tokenId?: string
  authCertCN?: string
  displayName?: string
  serviceAccountId?: string
  serviceAccountName?: string
  certSerial?: string
}

export interface ResolvePrincipalOptions {
  signals?: SessionSignals
  /** false for passive calls (session checks, polls): the session's last_seen_at is not bumped. */
  touch?: boolean
  /** Defaults to the request's tenant (ALS, then the x-tenant-id header middleware set). */
  tenantId?: string | null
  /** Defaults to the x-client-cert-serial header middleware forwarded. */
  certSerial?: string | null
  cookieName?: string
  /** Middleware: resolve only; no shadow-admin creation and no last_used_at write. */
  lookupOnly?: boolean
}

interface ResolveContext {
  req: NextRequest
  opts: ResolvePrincipalOptions
  tenantId: string | null
  signals: SessionSignals
}

// undefined: no credential of this kind. null: a credential was presented and failed.
type Resolver = (ctx: ResolveContext) => Promise<AdminPrincipal | null | undefined>

function bearerOf(req: NextRequest): string | null {
  const h = req.headers.get('authorization')
  return h && h.toLowerCase().startsWith('bearer ') ? h.slice(7) : null
}

function sessionPrincipal(s: Awaited<ReturnType<typeof verifyToken>>, credential: 'cookie' | 'bearer', tenantId: string | null): AdminPrincipal | null {
  if (!s) return null
  return {
    kind: 'session',
    credential,
    adminId: s.adminId,
    email: s.email,
    role: s.role,
    scopes: s.scopes,
    sid: s.sid,
    sessionId: s.sessionId,
    deadlineAt: s.deadlineAt,
    expiresAt: s.expiresAt,
    authCertCN: s.authCertCN,
    displayName: s.displayName,
    tenantId: s.tenantId ?? tenantId,
  }
}

// A bearer is a jfc_/jsa_ token, else a session token (today's bearer-as-sid), else a legacy extension JWT.
const fromBearer: Resolver = async ctx => {
  const { req, opts, tenantId, signals } = ctx
  const bearer = bearerOf(req)
  if (!bearer) return undefined
  if (/^(jfc|jsa)_/.test(bearer)) {
    if (!isApiToken(bearer)) return null
    const t = await resolveApiToken(bearer, { touch: !opts.lookupOnly }).catch(() => null)
    // Issued on another store: never valid here, whatever the token's scopes.
    if (!t || t.tenantId !== storeTenantId(tenantId)) return null
    return principalFromToken(ctx, { tokenId: t.id, kind: t.kind, adminId: t.adminId, serviceAccountId: t.serviceAccountId, scopes: t.scopes }, 'bearer')
  }
  const s = await verifyToken(bearer, signals, { touch: opts.touch !== false })
  if (s) return sessionPrincipal(s, 'bearer', tenantId)
  const ext = await verifyExtensionToken(bearer)
  if (!ext) return null
  return { ...ext, kind: 'extension', credential: 'bearer', tenantId }
}

const fromCookie: Resolver = async ({ req, opts, tenantId, signals }) => {
  const name = opts.cookieName ?? adminCookieNameForHost(req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
  const sid = req.cookies.get(name)?.value
  if (!sid) return undefined
  return sessionPrincipal(await verifyToken(sid, signals, { touch: opts.touch !== false }), 'cookie', tenantId)
}

/** Proxies print the minimal hex (no leading 00 bytes); stored serials keep the full 16 bytes. */
export function normaliseCertSerial(raw: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s || !/^[0-9a-fA-F]+$/.test(s)) return null
  return s.toLowerCase().replace(/^0+/, '') || '0'
}

export function serviceAccountEmail(name: string): string {
  return `svc-${name}@service-accounts.invalid`
}

/**
 * The admins row a service account acts as, so created_by FKs and the audit trail work unchanged.
 * Inactive (users and admins), role service_account: never listed, never signs in.
 */
export async function ensureServiceAccountAdmin(sa: { id: string; name: string; allowed_scopes: string[] | null }): Promise<string | null> {
  const row = await queryOne<{ admin_id: string | null }>(
    `WITH u AS (
       INSERT INTO users (email, first_name, user_type, is_active)
       VALUES ($1, $2, 'service_account', false)
       ON CONFLICT (email, user_type) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id
     ), a AS (
       INSERT INTO admins (user_id, role, scopes, is_active)
       SELECT id, 'service_account', $3::jsonb, false FROM u
       ON CONFLICT (user_id) DO UPDATE SET role = 'service_account', scopes = EXCLUDED.scopes
       RETURNING id
     )
     UPDATE service_accounts SET admin_id = COALESCE(service_accounts.admin_id, (SELECT id FROM a))
      WHERE id = $4
      RETURNING admin_id`,
    [serviceAccountEmail(sa.name), `svc-${sa.name}`, JSON.stringify(sa.allowed_scopes ?? []), sa.id]
  )
  return row?.admin_id ?? null
}

// When no bearer or cookie resolved. The serial is the one middleware verified or the edge proxy set;
// inbound client copies are stripped before they reach here.
const fromServiceAccountCert: Resolver = async ({ req, opts, tenantId }) => {
  const serial = normaliseCertSerial(opts.certSerial !== undefined ? opts.certSerial : req.headers.get('x-client-cert-serial'))
  if (!serial) return undefined
  let sa: { id: string; name: string; allowed_scopes: string[] | null; admin_id: string | null } | null = null
  try {
    sa = await queryOne(
      `SELECT id, name, allowed_scopes, admin_id FROM service_accounts
        WHERE LTRIM(LOWER(serial_number), '0') = $1 AND is_revoked = false`,
      [serial]
    )
  } catch {
    return null
  }
  if (!sa) return null
  let adminId = sa.admin_id
  if (!opts.lookupOnly) {
    if (!adminId) adminId = await ensureServiceAccountAdmin(sa).catch(() => null)
    if (!adminId) return null
    void Promise.resolve(queryOne(`UPDATE service_accounts SET last_used_at = NOW() WHERE id = $1`, [sa.id])).catch(() => {})
  }
  const scopes = await effectiveScopes(tenantId, Array.isArray(sa.allowed_scopes) ? sa.allowed_scopes : [], 'service_account')
  return {
    kind: 'service_account',
    credential: 'cert',
    adminId: adminId ?? '',
    email: serviceAccountEmail(sa.name),
    first_name: `svc-${sa.name}`,
    role: 'service_account',
    scopes,
    tenantId,
    serviceAccountId: sa.id,
    serviceAccountName: sa.name,
    certSerial: serial,
  }
}

interface TokenGrant {
  tokenId: string
  kind: ApiTokenKind
  adminId?: string | null
  serviceAccountId?: string | null
  scopes: string[]
}

/** A role that never bypasses a scope check: what a narrowed token of an owner acts as. */
const SCOPED_ROLE = 'admin'

/**
 * The principal behind a token, from the holder's CURRENT grant in this store's DB: a token's scopes are
 * an upper bound (["*"] = everything the holder has), so a demotion, deactivation or revoked service
 * account applies at once. A narrowed token of an owner drops the owner role, which would bypass scopes.
 */
async function principalFromToken(ctx: ResolveContext, t: TokenGrant, credential: 'bearer' | 'gateway'): Promise<AdminPrincipal | null> {
  const { tenantId, opts } = ctx
  const all = t.scopes.includes(ALL_SCOPES)
  const narrow = (base: string[], role: string) => (all ? base : t.scopes.filter(s => s !== ALL_SCOPES && hasScope(role, base, s)))
  const kind: AdminPrincipalKind = credential === 'gateway' ? 'gateway' : t.kind
  try {
    if (t.kind === 'service_account') {
      if (!t.serviceAccountId) return null
      const sa = await queryOne<{ id: string; name: string; allowed_scopes: string[] | null; admin_id: string | null }>(
        `SELECT id, name, allowed_scopes, admin_id FROM service_accounts WHERE id = $1 AND is_revoked = false`,
        [t.serviceAccountId]
      )
      if (!sa) return null
      let adminId = sa.admin_id
      if (!adminId && !opts.lookupOnly) adminId = await ensureServiceAccountAdmin(sa).catch(() => null)
      if (!adminId && !opts.lookupOnly) return null
      if (!opts.lookupOnly) void Promise.resolve(queryOne(`UPDATE service_accounts SET last_used_at = NOW() WHERE id = $1`, [sa.id])).catch(() => {})
      const base = await effectiveScopes(tenantId, Array.isArray(sa.allowed_scopes) ? sa.allowed_scopes : [], 'service_account')
      return {
        kind,
        via: 'service_account',
        credential,
        tokenId: t.tokenId,
        adminId: adminId ?? '',
        email: serviceAccountEmail(sa.name),
        first_name: `svc-${sa.name}`,
        role: 'service_account',
        scopes: narrow(base, 'service_account'),
        tenantId,
        serviceAccountId: sa.id,
        serviceAccountName: sa.name,
      }
    }
    if (!t.adminId) return null
    const a = await queryOne<{ id: string; role: string; scopes: string[] | null; is_active: boolean; email: string | null; first_name: string | null; last_name: string | null }>(
      `SELECT a.id, a.role, a.scopes, a.is_active, u.email, u.first_name, u.last_name
         FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
      [t.adminId]
    )
    if (!a || !a.is_active || a.role === 'service_account') return null
    const base = await effectiveScopes(tenantId, Array.isArray(a.scopes) ? a.scopes : [], a.role)
    const role = all || !(SUPER_ROLES as readonly string[]).includes(a.role) ? a.role : SCOPED_ROLE
    const scopes = all ? base : await effectiveScopes(tenantId, narrow(base, a.role), role)
    return {
      kind,
      via: t.kind,
      credential,
      tokenId: t.tokenId,
      adminId: a.id,
      email: a.email ?? undefined,
      first_name: a.first_name ?? undefined,
      last_name: a.last_name ?? undefined,
      role,
      scopes,
      tenantId,
    }
  } catch {
    return null
  }
}

const hostOf = (req: NextRequest) => (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')

/** The gateway's signed header, verified for this store, this host, and the platform/store API it named. */
export function verifiedGatewayClaims(req: NextRequest, tenantId: string | null) {
  const raw = req.headers.get(GATEWAY_HEADER)
  if (!raw) return undefined
  let c: ReturnType<typeof verifyGatewayToken> = null
  try {
    c = verifyGatewayToken(raw)
  } catch {
    return null
  }
  if (!c || c.tenantId !== storeTenantId(tenantId)) return null
  if (c.host.toLowerCase().replace(/:\d+$/, '') !== hostOf(req)) return null
  const path = req.nextUrl?.pathname
  if (path && path.startsWith('/api/admin') && !!c.platform !== path.startsWith('/api/admin/ecom')) return null
  return c
}

// Only public-api-service can sign it (ADMIN_GATEWAY_SECRET); middleware strips any copy that fails this.
// The token it names must still be live here, so a revoke applies within seconds through the gateway too.
const fromGateway: Resolver = async ctx => {
  const c = verifiedGatewayClaims(ctx.req, ctx.tenantId)
  if (c === undefined) return undefined
  if (!c) return null
  if (!(await isApiTokenLive(c.tokenId, ctx.tenantId).catch(() => false))) return null
  return principalFromToken(ctx, { tokenId: c.tokenId, kind: c.kind, adminId: c.adminId, serviceAccountId: c.serviceAccountId, scopes: c.scopes }, 'gateway')
}

const FALLTHROUGH: Resolver[] = [fromBearer, fromCookie, fromServiceAccountCert]

export async function resolveAdminPrincipal(req: NextRequest, opts: ResolvePrincipalOptions = {}): Promise<AdminPrincipal | null> {
  const tenantId = opts.tenantId !== undefined ? opts.tenantId : (getCurrentTenant()?.tenantId ?? req.headers.get('x-tenant-id') ?? null)
  const ctx: ResolveContext = { req, opts, tenantId, signals: opts.signals ?? extractSessionSignals(req) }
  const g = await fromGateway(ctx)
  if (g !== undefined) return g
  for (const resolve of FALLTHROUGH) {
    const p = await resolve(ctx)
    if (p) return p
  }
  return null
}

/** The signed-in person behind a browser session, or null for any token, key, cert or gateway caller. */
export async function signedInAdmin(req: NextRequest): Promise<AdminPrincipal | null> {
  const p = await resolveAdminPrincipal(req)
  return p && p.kind === 'session' && p.adminId ? p : null
}

/** Any principal, held to its deny list (the route's own scope check follows). */
export async function gatedPrincipal(req: NextRequest): Promise<AdminPrincipal | null> {
  const p = await resolveAdminPrincipal(req)
  if (!p) return null
  return principalDenied(p, req.nextUrl.pathname, req.method || 'GET') ? null : p
}

/** Whether a credential of this kind was presented at all (bearer, cookie, or a cert serial). */
export function presentedCredential(req: NextRequest, opts: Pick<ResolvePrincipalOptions, 'cookieName' | 'certSerial'> = {}): 'bearer' | 'cookie' | 'cert' | null {
  if (bearerOf(req)) return 'bearer'
  const name = opts.cookieName ?? adminCookieNameForHost(req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
  if (req.cookies.get(name)?.value) return 'cookie'
  if (normaliseCertSerial(opts.certSerial !== undefined ? opts.certSerial : req.headers.get('x-client-cert-serial'))) return 'cert'
  return null
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')

// Credentials, sessions and sign-in: no token or service account reaches them.
const SIGN_IN = ['token', 'sessions', 'session', 'mfa', 'account', 'auth', 'certificates', 'refresh', 'logout', 'check-session', 'access-request']
// A service account also never manages people or CLI logins.
const SA_DENY = [...SIGN_IN, 'users', 'cli'].map(s => `/api/admin/${s}`)
const TOKEN_DENY = SIGN_IN.map(s => `/api/admin/${s}`)
// The one CLI route a service-account key may call, and the ones a person's token may.
const CLI_SELF_SA = ['/api/admin/cli/whoami']
const CLI_SELF_TOKEN = ['/api/admin/cli/whoami', '/api/admin/cli/logout']

/** Why this kind of principal may not call this route at all, or null. Sessions are never denied here. */
export function principalDenied(p: Pick<AdminPrincipal, 'kind'> & { via?: ApiTokenKind }, path: string, method: string): string | null {
  if (p.kind === 'session') return null
  const kind = p.kind === 'gateway' ? (p.via ?? 'cli') : p.kind
  const m = (method || 'GET').toUpperCase()
  const saWrite = under(path, '/api/admin/service-accounts') && (m !== 'GET' || /\/download\/?$/.test(path))
  if (kind === 'service_account') {
    if (CLI_SELF_SA.some(d => under(path, d))) return null
    const hit = SA_DENY.find(d => under(path, d))
    if (hit) return `service_account:${hit}`
    if (saWrite) return 'service_account:service-accounts'
    return null
  }
  const hit = TOKEN_DENY.find(d => under(path, d))
  if (hit) return `${kind}:${hit}`
  if (under(path, '/api/admin/cli') && !CLI_SELF_TOKEN.some(d => under(path, d))) return `${kind}:/api/admin/cli`
  if (saWrite) return `${kind}:service-accounts`
  if (under(path, '/api/admin/users') && (m !== 'GET' || /\/resend-certificate\/?$/.test(path))) return `${kind}:/api/admin/users`
  return null
}

export interface GateVerdict {
  status: 401 | 403
  error: string
  reason: string
}

/** Deny list, then the path's scope, then the platform-admin-only ecom API. */
export function principalGate(
  p: Pick<AdminPrincipal, 'kind' | 'role' | 'scopes' | 'via'>,
  path: string,
  method: string,
  opts: { scope?: boolean; platform?: boolean } = {}
): GateVerdict | null {
  const denied = principalDenied(p, path, method)
  if (denied) return { status: 403, error: 'Not available to this credential', reason: denied }
  if (opts.scope !== false) {
    const scope = getScopeForPath(path)
    if (scope && !hasScope(p.role, p.scopes || [], scope)) return { status: 403, error: 'Insufficient permissions', reason: `scope:${scope}` }
  }
  if (opts.platform !== false && path.startsWith('/api/admin/ecom') && !isPlatformAdmin(p.role)) {
    return { status: 403, error: 'Insufficient permissions', reason: 'platform_admin' }
  }
  return null
}

/** The fields authenticateAdmin has always returned, per kind. */
export function toAdminPayload(p: AdminPrincipal): AdminJWTPayload {
  if (p.kind === 'session') {
    return {
      adminId: p.adminId,
      email: p.email,
      role: p.role,
      scopes: p.scopes,
      sid: p.sid,
      sessionId: p.sessionId,
      deadlineAt: p.deadlineAt,
      expiresAt: p.expiresAt,
    }
  }
  return { adminId: p.adminId, email: p.email, first_name: p.first_name, last_name: p.last_name, role: p.role, scopes: p.scopes }
}
