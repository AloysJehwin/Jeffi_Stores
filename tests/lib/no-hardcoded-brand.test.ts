import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Guard (#486): tenant-facing code must not hardcode the platform brand ("Jeffi …"). A tenant store
// rendering "Jeffi Stores" on its label/slip/invoice/email/SMS/AI/page title is a branding leak.
// Resolve the store name from tenant settings instead — currentBrandName()/currentBrandNameAsync()
// / getStoreIdentity() / platformBrandName() (the last is the platform DEFAULT, allowed).
//
// This fails on any NEW hardcoded "Jeffi" literal under src/ except:
//   - platform-only surfaces (ecom portal, marketing site, platform admin ops) — ALLOW_PREFIXES
//   - specific files that legitimately name the platform entity (brand/default helpers, legal docs,
//     platform infra/creds, carrier/CA identity) — ALLOW_FILES
// Adding a tenant-facing file here instead of fixing the leak defeats the guard — don't.

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

// Matches the platform brand as a literal word, not substrings like "jeffistores.in" domains
// (those are covered by host/env config, not brand strings) — we match "Jeffi" followed by a
// space or quote/apostrophe, i.e. the human-readable name.
const BRAND_RE = /Jeffi(?:\s|&amp;|'|’|")/

// Platform-only surfaces: Jeffi branding here is correct.
const ALLOW_PREFIXES = [
  'src/app/(ecom)/',
  'src/app/(marketing)/',
  'src/app/(portal)/',
  'src/lib/provisioning/',
  'src/lib/legals/',
  'src/lib/amazon/',
  'src/lib/merchant/',
  'src/lib/social/',
  'src/lib/payments/',
  'src/lib/tenancy/certificates.ts',
  'src/lib/tenancy/tenant-ca.ts',
  'src/lib/tenant-registry/social.ts',
  'src/lib/integrations/resolve.ts',
  'src/lib/shared/ecom-emails.ts',
]

// Specific files allowed to name the platform entity.
const ALLOW_FILES = new Set<string>([
  'src/lib/catalog/brand.ts', // defines platformBrandName() — the platform default lives here
  'src/lib/catalog/site-controls.ts', // DEFAULTS block (tenant-overridable platform defaults)
  'src/lib/auth/mfa.ts', // PLATFORM_ISSUER fallback (used only when no tenant brand resolves)
  'src/lib/shared/daily-briefing.ts', // operator ops briefing (platform admin)
  'src/lib/shared/mail-audit.ts', // literal only appears in a comment (default now tenant-resolved)
  'src/lib/email/certificates.ts', // ecom/platform-admin cert mail; tenant branch already uses tenant.storeName
  'src/app/api/(admin)/admin/access-request/route.ts', // operator alert to the platform admin
  'src/app/api/(admin)/admin/users/route.ts', // last-resort fallback for a null tenant (platform)
  'src/components/admin/AdminSupportChat.tsx', // operator-side chat label, not customer-facing
  'src/components/admin/ExtensionTokenCard.tsx', // "Jeffi Gallery Uploader" — product proper noun
  'src/components/visitor/SupportChat.tsx', // widget mounts on platform (marketing/business) hosts
])

function isAllowed(rel: string): boolean {
  const p = rel.split(sep).join('/')
  if (ALLOW_FILES.has(p)) return true
  return ALLOW_PREFIXES.some(prefix => p.startsWith(prefix))
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
}

describe('no hardcoded platform brand in tenant-facing code (#486)', () => {
  const files: string[] = []
  walk(SRC, files)

  const offenders: { file: string; line: number; text: string }[] = []
  for (const full of files) {
    const rel = relative(ROOT, full)
    if (isAllowed(rel)) continue
    const src = readFileSync(full, 'utf8')
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      // Skip comment lines: a mention in a `//` or `*` comment is documentation, not emitted output.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (BRAND_RE.test(line)) offenders.push({ file: rel.split(sep).join('/'), line: i + 1, text: trimmed })
    })
  }

  it('has no hardcoded "Jeffi …" brand literal in a tenant-reachable file', () => {
    const report = offenders.map(o => `  ${o.file}:${o.line}  ${o.text.slice(0, 100)}`).join('\n')
    expect(
      offenders,
      offenders.length
        ? `Hardcoded platform brand in tenant-facing code — resolve from store settings instead ` +
            `(see this test's header). If the surface is genuinely platform-only, add it to ALLOW_* here:\n${report}`
        : ''
    ).toHaveLength(0)
  })
})
