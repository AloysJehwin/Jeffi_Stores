import type { ProvisioningProvider } from './provider'
import { StubProvisioningProvider } from './stub-provider'

// Provider selector. Until the real @aws-sdk implementation is wired + verified,
// this returns the stub (no real infra). Flip via env once the real provider
// lands: PROVISIONING_PROVIDER=aws. Kept as a single seam so nothing else changes.
let cached: ProvisioningProvider | null = null

export function getProvisioningProvider(): ProvisioningProvider {
  if (cached) return cached
  // if (process.env.PROVISIONING_PROVIDER === 'aws') { cached = new AwsProvisioningProvider(); return cached }
  cached = new StubProvisioningProvider()
  return cached
}
