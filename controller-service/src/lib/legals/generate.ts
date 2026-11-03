import type { Policy } from '@/lib/legals/policies'
import { POLICY_VERSION } from '@/lib/legals/policies'
import { generatePolicyPDF } from '@/lib/documents/policy-pdf'
import type { TenantLegalInfo } from '@/lib/legals/template'

// The templating lives in store-core (lib/legals/template.ts) so the storefront renders each
// store's policies at request time; re-exported here for the control plane.
export { applyReplacements, buildTenantPolicies, type TenantLegalInfo } from '@/lib/legals/template'
export { POLICY_VERSION }

async function toImageBuffer(src?: string): Promise<Buffer | undefined> {
  if (!src || !/^https?:\/\//i.test(src)) return undefined
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return undefined
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return undefined
  }
}

export async function generateTenantPolicyPdf(policy: Policy, info: TenantLegalInfo): Promise<Buffer> {
  const [logo, seal] = await Promise.all([toImageBuffer(info.logoUrl), toImageBuffer(info.sealUrl)])
  // A tenant without a seal gets none — never the platform's.
  return generatePolicyPDF(policy, { logo, seal: seal ?? null })
}
