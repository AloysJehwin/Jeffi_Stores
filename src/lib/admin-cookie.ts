import { cookieDomainOption } from './cookie-domain'

const PLATFORM_NAME = 'admin_sid'
const TENANT_NAME = 'admin_sid_t'

export const ADMIN_COOKIE_NAMES = [PLATFORM_NAME, TENANT_NAME] as const

function isTenantAdminHost(host: string): boolean {
  return /^admin-[^.]+\./.test(host.toLowerCase().split(':')[0].trim())
}

/**
 * A tenant admin host gets its own cookie, host-scoped and separately named. admin_sid is
 * issued for .jeffistores.in, so without this a tenant login overwrites the platform
 * operator's session and vice versa.
 */
export function adminCookieNameForHost(host: string): string {
  return isTenantAdminHost(host) ? TENANT_NAME : PLATFORM_NAME
}

export function adminCookieDomainForHost(host: string): { domain?: string } {
  return isTenantAdminHost(host) ? {} : cookieDomainOption()
}

async function requestHost(): Promise<string> {
  const { headers } = await import('next/headers')
  const h = await headers()
  return h.get('x-forwarded-host') ?? h.get('host') ?? ''
}

export async function adminCookieName(): Promise<string> {
  try {
    return adminCookieNameForHost(await requestHost())
  } catch {
    return PLATFORM_NAME
  }
}

export async function adminCookieDomain(): Promise<{ domain?: string }> {
  try {
    return adminCookieDomainForHost(await requestHost())
  } catch {
    return cookieDomainOption()
  }
}

export async function readAdminSid(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get(await adminCookieName())?.value ?? null
  } catch {
    return null
  }
}
