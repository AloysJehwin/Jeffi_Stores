import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { gatedPrincipal } from '@/lib/auth/admin-principal'
import { apiTokenExpiry, storeTenantId } from '@/lib/auth/api-tokens'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import { platformBrandName } from '@/lib/catalog/brand'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let cached: { file: string; mtimeMs: number; hash: string | null } | null = null

// The CLI's admin route manifest, to tell a CLI whose commands no longer match this server.
function serverManifestHash(): string | null {
  for (const dir of [path.join(process.cwd(), '..'), process.cwd()]) {
    const file = path.join(dir, 'packages/cli/manifest/admin-api.json')
    try {
      const { mtimeMs } = fs.statSync(file)
      if (cached?.file === file && cached.mtimeMs === mtimeMs) return cached.hash
      const m = fs.readFileSync(file, 'utf8').slice(0, 400).match(/"manifestHash"\s*:\s*"([0-9a-f]{16,128})"/)
      cached = { file, mtimeMs, hash: m ? m[1] : null }
      return cached.hash
    } catch {}
  }
  return null
}

// `jeffi whoami`: who this credential is, what it may do here, and whether the CLI is current.
export async function GET(request: NextRequest) {
  const p = await gatedPrincipal(request)
  if (!p) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const t = getCurrentTenant()
  const kind = p.kind === 'gateway' ? (p.via ?? 'cli') : p.kind
  const expiresAt = p.tokenId ? await apiTokenExpiry(p.tokenId) : (p.expiresAt ?? null)
  return NextResponse.json(
    {
      kind,
      email: p.email ?? null,
      name: p.serviceAccountName ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || null),
      role: p.role,
      scopes: p.scopes,
      tenant: { id: storeTenantId(p.tenantId), slug: t?.slug ?? null, name: t?.displayName ?? (p.tenantId ? (t?.slug ?? null) : platformBrandName()) },
      host: (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim(),
      expiresAt,
      server: {
        version: process.env.NEXT_PUBLIC_APP_VERSION || null,
        manifestHash: serverManifestHash(),
        minCli: process.env.CLI_MIN_VERSION || '0.1.0',
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  )
}
