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
const SRC = join(ROOT, 'controller-service/src')

// Matches the platform brand as a literal word, not substrings like "jeffistores.in" domains
// (those are covered by host/env config, not brand strings) — we match "Jeffi" followed by a
// space or quote/apostrophe, i.e. the human-readable name.
const BRAND_RE = /Jeffi(?:\s|&amp;|'|’|")/

// The flagship's home city/state. Hardcoding these as consignee/return-address defaults or inside
// an LLM prompt/tool-schema leaks the flagship's location into a tenant's ops/AI. Resolve the
// store's own location (storeOrigin() / site_settings business_city|business_state) instead.
const LOCATION_RE = /\b(Chhattisgarh|Raipur)\b/
// Only enforced on prompt + ops surfaces where a tenant store acts; platform-entity references
// (legal docs, Amazon LMPC contact, pincode reference tables, GST-code hints) live elsewhere.
const LOCATION_SCOPE_PREFIXES = [
  'controller-service/src/lib/admin-agent/',
  'controller-service/src/app/api/(admin)/',
  'controller-service/src/app/api/(public)/',
]
const LOCATION_ALLOW_FILES = new Set<string>([
  'controller-service/src/lib/admin-agent/tools/sales.ts', // description now neutral + default via storeOrigin(); keeps the word only in a comment
  'controller-service/src/app/api/(public)/orders/[id]/invoice/route.ts', // reads business_state (tenant), no literal
])

// Platform-only surfaces: Jeffi branding here is correct.
const ALLOW_PREFIXES = [
  'controller-service/src/app/(ecom)/',
  'controller-service/src/app/(marketing)/',
  'controller-service/src/app/(portal)/',
  'controller-service/src/lib/provisioning/',
  'controller-service/src/lib/legals/',
  'controller-service/src/lib/amazon/',
  'controller-service/src/lib/merchant/',
  'controller-service/src/lib/social/',
  'controller-service/src/lib/payments/',
  'controller-service/src/lib/tenancy/certificates.ts',
  'controller-service/src/lib/tenancy/tenant-ca.ts',
  'controller-service/src/lib/tenant-registry/social.ts',
  'controller-service/src/lib/integrations/resolve.ts',
  'controller-service/src/lib/shared/ecom-emails.ts',
]

// Specific files allowed to name the platform entity.
const ALLOW_FILES = new Set<string>([
  'controller-service/src/lib/catalog/brand.ts', // defines platformBrandName() — the platform default lives here
  'controller-service/src/lib/catalog/site-controls.ts', // DEFAULTS block (tenant-overridable platform defaults)
  'controller-service/src/lib/auth/mfa.ts', // PLATFORM_ISSUER fallback (used only when no tenant brand resolves)
  'controller-service/src/lib/shared/daily-briefing.ts', // operator ops briefing (platform admin)
  'controller-service/src/lib/shared/mail-audit.ts', // literal only appears in a comment (default now tenant-resolved)
  'controller-service/src/lib/email/certificates.ts', // ecom/platform-admin cert mail; tenant branch already uses tenant.storeName
  'controller-service/src/app/api/(admin)/admin/access-request/route.ts', // operator alert to the platform admin
  'controller-service/src/app/api/(admin)/admin/users/route.ts', // last-resort fallback for a null tenant (platform)
  'controller-service/src/components/admin/AdminSupportChat.tsx', // operator-side chat label, not customer-facing
  'controller-service/src/components/admin/ExtensionTokenCard.tsx', // "Jeffi Gallery Uploader" — product proper noun
  'controller-service/src/components/visitor/SupportChat.tsx', // widget mounts on platform (marketing/business) hosts
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

  const locationOffenders: { file: string; line: number; text: string }[] = []
  for (const full of files) {
    const rel = relative(ROOT, full).split(sep).join('/')
    if (!LOCATION_SCOPE_PREFIXES.some(p => rel.startsWith(p))) continue
    if (LOCATION_ALLOW_FILES.has(rel)) continue
    const src = readFileSync(full, 'utf8')
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (LOCATION_RE.test(line)) locationOffenders.push({ file: rel, line: i + 1, text: trimmed })
    })
  }

  it('has no hardcoded flagship city/state in a tenant prompt or ops surface', () => {
    const report = locationOffenders.map(o => `  ${o.file}:${o.line}  ${o.text.slice(0, 100)}`).join('\n')
    expect(
      locationOffenders,
      locationOffenders.length
        ? `Hardcoded flagship location (Raipur/Chhattisgarh) in a tenant prompt/ops surface — use ` +
            `storeOrigin() / the store's own address instead (see this test's header):\n${report}`
        : ''
    ).toHaveLength(0)
  })
})
