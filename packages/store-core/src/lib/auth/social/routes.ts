import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { bp, isBusinessHost } from '@/lib/shared/business-path'
import { isSafeTargetPath } from '@/lib/vault/sso'
import { listSignInMethods, readSocialCredentials } from './config'
import { SOCIAL_PROVIDER_MODULES } from './providers'
import { completeSocialSignup, findSocialUser, signInSocialUser } from './account'
import { randomToken, sha256url, signSocialToken, verifySocialToken } from './tokens'
import { isSocialProvider, type SocialPortal, type SocialProfile, type SocialProvider } from './types'

// Customer social sign-in with the store's own OAuth apps. The whole flow stays on the host it
// started on, so the redirect URI is https://<that host>/api/auth/oauth/<provider>/callback.

const TX_COOKIE = 'oauth_tx'
const PENDING_COOKIE = 'oauth_pending'
const COOKIE_PATH = '/api/auth/oauth'
const STATE_TTL_S = 600
const PENDING_TTL_S = 20 * 60

interface StateToken {
  p: SocialProvider
  portal: SocialPortal
  r: string
  n: string
}
interface TxToken {
  n: string
  v: string
}
interface PendingToken {
  p: SocialProvider
  portal: SocialPortal
  r: string
  profile: SocialProfile
}

type Ctx = { params: Promise<{ provider: string }> }

const hostOf = (req: NextRequest) => (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim()
const isLocal = (host: string) => /^(?:[a-z0-9-]+\.)*localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/.test(host)

export function socialRedirectUri(host: string, provider: SocialProvider): string {
  return `${isLocal(host) ? 'http' : 'https'}://${host}/api/auth/oauth/${provider}/callback`
}

const portalOf = (v: string | null, host: string): SocialPortal =>
  v === 'business' || v === 'store' ? v : isBusinessHost(host) ? 'business' : 'store'

function pages(portal: SocialPortal, host: string) {
  return portal === 'business'
    ? { login: bp('/business/signin', host), signup: bp('/business/signup', host), home: bp('/business', host), pending: bp('/business/pending', host) }
    : { login: '/login', signup: '/signup', home: '/', pending: '/' }
}

const withQuery = (path: string, q: Record<string, string | undefined>) => {
  const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString()
  return qs ? `${path}?${qs}` : path
}

// A plain 3xx after Apple's cross-site POST would carry no Lax cookies; navigating from a page does.
function go(path: string, viaPage = false): NextResponse {
  if (!viaPage) return new NextResponse(null, { status: 302, headers: { Location: path, 'Cache-Control': 'no-store' } })
  const attr = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const js = JSON.stringify(path).replace(/</g, '\\u003c')
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
    `<meta http-equiv="refresh" content="0;url=${attr}"><title>Signing you in</title></head>` +
    `<body><script>location.replace(${js})</script><a href="${attr}">Continue</a></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function fail(portal: SocialPortal, host: string, code: string, r?: string, viaPage = false): NextResponse {
  const p = pages(portal, host)
  return go(withQuery(p.login, { oauth_error: code, redirect: r && r !== p.home ? r : undefined }), viaPage)
}

export async function socialMethodsGET(): Promise<NextResponse> {
  const providers = await listSignInMethods(await credentialOwnerId()).catch(() => [])
  return NextResponse.json({ providers }, { headers: { 'Cache-Control': 'private, max-age=30' } })
}

export async function socialStartGET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const host = hostOf(req)
  const sp = req.nextUrl.searchParams
  const portal = portalOf(sp.get('portal'), host)
  const { provider } = await ctx.params
  const wanted = sp.get('redirect')
  const r = isSafeTargetPath(wanted) ? wanted : pages(portal, host).home
  if (!isSocialProvider(provider)) return fail(portal, host, 'not_available', r)
  try {
    const creds = await readSocialCredentials(await credentialOwnerId(), provider)
    if (!creds) return fail(portal, host, 'not_available', r)
    const mod = SOCIAL_PROVIDER_MODULES[provider]
    const nonce = randomToken()
    const verifier = randomToken(48)
    const state = signSocialToken('state', { p: provider, portal, r, n: nonce } satisfies StateToken, STATE_TTL_S)
    const url = mod.authorizeUrl({
      creds,
      redirectUri: socialRedirectUri(host, provider),
      state,
      codeChallenge: sha256url(verifier),
      nonce: sha256url(`nonce:${nonce}`),
    })
    // Binds the flow to this browser. Apple returns by cross-site POST, which only a SameSite=None cookie survives.
    ;(await cookies()).set(TX_COOKIE, signSocialToken('tx', { n: nonce, v: verifier } satisfies TxToken, STATE_TTL_S), {
      httpOnly: true,
      secure: mod.formPost ? true : process.env.NODE_ENV === 'production',
      sameSite: mod.formPost ? 'none' : 'lax',
      maxAge: STATE_TTL_S,
      path: COOKIE_PATH,
    })
    return go(url)
  } catch (err) {
    console.error('[social-oauth] start', provider, err)
    return fail(portal, host, 'failed', r)
  }
}

async function callback(req: NextRequest, ctx: Ctx, params: URLSearchParams, viaPage: boolean): Promise<NextResponse> {
  const host = hostOf(req)
  const { provider } = await ctx.params
  const state = verifySocialToken<StateToken>('state', params.get('state'))
  const portal = state?.portal ?? portalOf(null, host)
  if (!state || !isSocialProvider(provider) || state.p !== provider) return fail(portal, host, 'expired', undefined, viaPage)
  const r = isSafeTargetPath(state.r) ? state.r : pages(portal, host).home
  const p = pages(portal, host)

  const jar = await cookies()
  const tx = verifySocialToken<TxToken>('tx', jar.get(TX_COOKIE)?.value)
  jar.set(TX_COOKIE, '', { httpOnly: true, maxAge: 0, path: COOKIE_PATH })
  if (!tx || tx.n !== state.n) return fail(portal, host, 'expired', r, viaPage)
  if (params.get('error')) return fail(portal, host, 'cancelled', r, viaPage)
  const code = params.get('code')
  if (!code) return fail(portal, host, 'provider', r, viaPage)

  let profile: SocialProfile
  try {
    const creds = await readSocialCredentials(await credentialOwnerId(), provider)
    if (!creds) return fail(portal, host, 'not_available', r, viaPage)
    profile = await SOCIAL_PROVIDER_MODULES[provider].exchange({
      creds,
      redirectUri: socialRedirectUri(host, provider),
      code,
      codeVerifier: tx.v,
      nonce: sha256url(`nonce:${tx.n}`),
      userField: params.get('user'),
    })
  } catch (err: any) {
    console.error('[social-oauth] exchange', provider, err?.message || err)
    return fail(portal, host, 'provider', r, viaPage)
  }

  try {
    const user = await findSocialUser(portal, provider, profile)
    if (!user) {
      jar.set(PENDING_COOKIE, signSocialToken('pending', { p: provider, portal, r, profile } satisfies PendingToken, PENDING_TTL_S), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: PENDING_TTL_S,
        path: COOKIE_PATH,
      })
      return go(withQuery(p.signup, { oauth: provider, from: 'login', redirect: r !== p.home ? r : undefined }), viaPage)
    }
    const res = await signInSocialUser(req, portal, provider, profile, user)
    if (res.status === 'inactive') return fail(portal, host, 'inactive', r, viaPage)
    if (res.status === 'approval') {
      return go(res.approvalStatus === 'rejected' ? withQuery(p.login, { rejected: '1' }) : p.pending, viaPage)
    }
    // The login page finishes: phone / policy prompts, then on to the return path.
    return go(withQuery(p.login, { oauth: 'done', redirect: r !== p.home ? r : undefined }), viaPage)
  } catch (err) {
    console.error('[social-oauth] sign-in', provider, err)
    return fail(portal, host, 'failed', r, viaPage)
  }
}

export async function socialCallbackGET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return callback(req, ctx, req.nextUrl.searchParams, false)
}

export async function socialCallbackPOST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const params = new URLSearchParams(await req.text().catch(() => ''))
  return callback(req, ctx, params, true)
}

async function readPending(): Promise<PendingToken | null> {
  return verifySocialToken<PendingToken>('pending', (await cookies()).get(PENDING_COOKIE)?.value)
}

/** The half-finished sign-up the callback left for this browser. */
export async function socialPendingGET(): Promise<NextResponse> {
  const pending = await readPending()
  const headers = { 'Cache-Control': 'no-store' }
  if (!pending) return NextResponse.json({ pending: null }, { headers })
  const { profile } = pending
  const vouched = !!(profile.email && profile.emailVerified)
  return NextResponse.json(
    {
      pending: {
        provider: pending.p,
        portal: pending.portal,
        // An unverified address is only a suggestion: the form asks for one and proves it by OTP.
        needsEmail: !vouched,
        profile: { email: profile.email || '', firstName: profile.firstName, lastName: profile.lastName },
      },
    },
    { headers }
  )
}

export async function socialCompletePOST(req: NextRequest): Promise<NextResponse> {
  try {
    const pending = await readPending()
    if (!pending) return NextResponse.json({ error: 'Your sign-up session expired. Please sign in again.' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const result = await completeSocialSignup(req, pending.portal, pending.p, pending.profile, body || {})
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    ;(await cookies()).set(PENDING_COOKIE, '', { httpOnly: true, maxAge: 0, path: COOKIE_PATH })
    return NextResponse.json(result.body)
  } catch (err: any) {
    console.error('[social-oauth] complete', err)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
