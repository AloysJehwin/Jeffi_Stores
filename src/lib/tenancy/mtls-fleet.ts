import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { controlPlanePool } from '@/lib/tenant-registry'
import { describeRunningTenantInstanceIds } from '@/lib/shared/ec2-client'
import { sendShellCommand } from '@/lib/shared/ssm-client'

/**
 * Keep the fleet's client-CA bundle current so a freshly provisioned tenant's admin host
 * actually prompts for its certificate.
 *
 * nginx advertises client-cert issuers from a single ssl_client_certificate file (it takes no
 * variables, so it cannot pick a CA per tenant). A browser then offers ONLY certs issued by a
 * CA named in that CertificateRequest. A tenant CA that is in the DB but not in the published
 * bundle is invisible to the browser — no picker, and the panel 403s "client certificate
 * required". CI rebuilds the bundle on every deploy; this rebuilds it the moment a tenant is
 * provisioned so the gap between deploys does not strand a new store's admin login.
 *
 * Mirrors .github/scripts/build-client-ca-bundle.sh, but in-app: the control-plane pool and the
 * platform CA on disk are already here, so no psql/RDS-auth dance is needed.
 */

const FLEET_KEY = 'fleet/client-ca-bundle.pem'

function truststoreBucket(): string {
  return process.env.MTLS_TRUSTSTORE_BUCKET || 'jeffi-stores-mtls-truststore'
}

function platformCaPath(): string {
  return path.join(process.cwd(), 'certs', 'ca-cert.pem')
}

/** Rebuild the platform-CA + every tenant-CA bundle and publish it to the fleet S3 prefix.
 * Refuses to publish a bundle openssl cannot parse (a broken file breaks every admin host).
 * Returns the certificate count for the step summary. */
export async function rebuildAndPublishClientCaBundle(): Promise<{ count: number }> {
  const caPath = platformCaPath()
  if (!fs.existsSync(caPath)) {
    // nginx refuses an empty ssl_client_certificate, so the platform CA must always be present.
    throw new Error(`platform CA missing: ${caPath}`)
  }
  const platformCa = fs.readFileSync(caPath, 'utf8').trim()

  const { rows } = await controlPlanePool().query<{ ca_cert_pem: string }>(
    'SELECT ca_cert_pem FROM tenant_ca WHERE ca_cert_pem IS NOT NULL'
  )
  const parts = [platformCa, ...rows.map(r => r.ca_cert_pem.trim()).filter(Boolean)]
  const bundle = parts.join('\n') + '\n'

  const tmp = path.join(os.tmpdir(), `client-ca-bundle-${Date.now()}.pem`)
  try {
    fs.writeFileSync(tmp, bundle)
    try {
      execFileSync('openssl', ['crl2pkcs7', '-nocrl', '-certfile', tmp], { stdio: 'pipe' })
    } catch {
      throw new Error('refusing to publish an unparseable CA bundle')
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }

  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  await s3.send(
    new PutObjectCommand({
      Bucket: truststoreBucket(),
      Key: FLEET_KEY,
      Body: bundle,
      ContentType: 'application/x-pem-file',
    })
  )

  const count = (bundle.match(/BEGIN CERTIFICATE/g) ?? []).length
  return { count }
}

// Config-only fleet apply: refresh the bundle + reload nginx, no blue/green image roll.
function fleetReloadCommands(): string[] {
  return [
    'set -e',
    'aws s3 cp s3://jeffi-stores-mtls-truststore/fleet/fleet-apply.sh /tmp/fleet-apply.sh --only-show-errors',
    'FLEET_SKIP_APP=1 bash /tmp/fleet-apply.sh',
    'rm -f /tmp/fleet-apply.sh',
  ]
}

/** Rebuild+publish the bundle, then tell every running tenant box to pull it and reload nginx.
 * Fire-and-forget on the SSM side: returns once the command is sent, without waiting for the
 * per-box invocation to finish. */
export async function refreshTenantMtlsFleet(
  slug?: string
): Promise<{ count: number; commandId: string | null; targets: number }> {
  const { count } = await rebuildAndPublishClientCaBundle()

  const ids = await describeRunningTenantInstanceIds()
  if (ids.length === 0) return { count, commandId: null, targets: 0 }

  const { commandId } = await sendShellCommand(
    ids,
    fleetReloadCommands(),
    `mtls-bundle refresh${slug ? ` ${slug}` : ''}`
  )
  return { count, commandId, targets: ids.length }
}
