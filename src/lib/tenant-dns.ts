import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Sha256 } from '@aws-crypto/sha256-js'

/**
 * Minimal Route53 client (SigV4-signed REST) — the app's npm registry can't fetch
 * @aws-sdk/client-route53, so we sign the ChangeResourceRecordSets REST call directly with
 * the SigV4 + credential libs already installed (used by rds-signer). Route53 is a global
 * service signed in us-east-1.
 *
 * Used by the provisioning `configure_dns` step to point tenant subdomains at the shared
 * app host (same A-record pattern as admin./business.), and by deprovision to remove them.
 */

const ROUTE53_HOST = 'route53.amazonaws.com'
const HOSTED_ZONE_ID = process.env.PLATFORM_HOSTED_ZONE_ID || 'Z08094881XKVZ9XSGBKG1'
const TARGET_IP = process.env.TENANT_APP_TARGET_IP || '32.196.38.130'

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))
}

async function changeRecordSets(action: 'UPSERT' | 'DELETE', hostnames: string[]): Promise<void> {
  if (hostnames.length === 0) return
  const changes = hostnames.map((h) => `
    <Change>
      <Action>${action}</Action>
      <ResourceRecordSet>
        <Name>${xmlEscape(h)}</Name>
        <Type>A</Type>
        <TTL>300</TTL>
        <ResourceRecords><ResourceRecord><Value>${TARGET_IP}</Value></ResourceRecord></ResourceRecords>
      </ResourceRecordSet>
    </Change>`).join('')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch><Changes>${changes}</Changes></ChangeBatch>
</ChangeResourceRecordSetsRequest>`

  const path = `/2013-04-01/hostedzone/${HOSTED_ZONE_ID}/rrset`
  const request = new HttpRequest({
    method: 'POST', protocol: 'https:', hostname: ROUTE53_HOST, path,
    headers: { host: ROUTE53_HOST, 'content-type': 'application/xml' },
    body,
  })
  const signer = new SignatureV4({
    service: 'route53', region: 'us-east-1', credentials: defaultProvider(), sha256: Sha256,
  })
  const signed = await signer.sign(request)
  const url = `https://${ROUTE53_HOST}${path}`
  const res = await fetch(url, { method: 'POST', headers: signed.headers as any, body })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // DELETE of a non-existent record → treat as success (idempotent teardown).
    if (action === 'DELETE' && /InvalidChangeBatch|not found|does not exist/i.test(text)) return
    throw new Error(`Route53 ${action} failed (${res.status}): ${text.slice(0, 300)}`)
  }
}

/** Create/point tenant subdomains at the shared app host (idempotent UPSERT). */
export async function upsertTenantDns(hostnames: string[]): Promise<void> {
  await changeRecordSets('UPSERT', hostnames)
}

/** Remove tenant subdomains on deprovision (idempotent). */
export async function deleteTenantDns(hostnames: string[]): Promise<void> {
  await changeRecordSets('DELETE', hostnames)
}
