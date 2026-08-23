import type { ProvisioningProvider } from './provider'
import { StubProvisioningProvider } from './stub-provider'
import { AwsProvisioningProvider } from './aws-provider'

// Provider selector. PROVISIONING_PROVIDER=aws → real @aws-sdk provider (needs live
// AWS + RDS_MASTER_PASSWORD + certs/global-bundle.pem). Anything else → stub (no infra).
//
// Both providers are statically imported: a lazy `require('./aws-provider')` broke under the
// Next server bundler (ESM/CJS interop returned an object whose AwsProvisioningProvider was not
// a constructor). A static import is handled reliably; the AWS SDK is tree-shaken/loaded either
// way on the server, so the old lazy optimization isn't worth the interop hazard.
let cached: ProvisioningProvider | null = null

export function getProvisioningProvider(): ProvisioningProvider {
  if (cached) return cached
  cached = process.env.PROVISIONING_PROVIDER === 'aws'
    ? new AwsProvisioningProvider()
    : new StubProvisioningProvider()
  return cached
}
