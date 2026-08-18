import type { ProvisioningProvider } from './provider'
import { StubProvisioningProvider } from './stub-provider'

// Provider selector. PROVISIONING_PROVIDER=aws → real @aws-sdk provider (needs live
// AWS + RDS_MASTER_PASSWORD + certs/global-bundle.pem). Anything else → stub (no infra).
let cached: ProvisioningProvider | null = null

export function getProvisioningProvider(): ProvisioningProvider {
  if (cached) return cached
  if (process.env.PROVISIONING_PROVIDER === 'aws') {
    // Lazy require so the AWS SDK isn't loaded in stub/dev mode
    const { AwsProvisioningProvider } = require('./aws-provider')
    cached = new AwsProvisioningProvider()
    return cached!
  }
  cached = new StubProvisioningProvider()
  return cached
}
