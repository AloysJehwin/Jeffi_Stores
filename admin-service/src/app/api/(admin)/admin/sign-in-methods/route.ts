import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { listSignInMethodsAdmin } from '@/lib/auth/social/config'
import { signInHosts, signInRedirectUris } from '@/lib/auth/social/hosts'

export const dynamic = 'force-dynamic'

// Customer sign-in methods for this store (Site Controls > Sign-in methods). Secrets are never returned.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  try {
    const [methods, hosts] = await Promise.all([listSignInMethodsAdmin(await credentialOwnerId()), signInHosts()])
    return NextResponse.json({ methods, redirectUris: signInRedirectUris(hosts) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
