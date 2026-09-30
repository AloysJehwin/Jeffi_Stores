import { signedAwsFetch } from '@/lib/aws-signing'

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

/**
 * Resolve the DNS target tenant subdomains point at. MUST be an explicit, stable value —
 * there is deliberately NO hardcoded default. A stale literal default (previously the app
 * EC2's then-current public IP) wrote zombie A-records to a dead address once that IP
 * changed (EIP move), so provisioned tenants silently failed to serve. Set
 * TENANT_APP_TARGET_IP to a STABLE target: an attached Elastic IP, or use an ALIAS to a
 * stable name. Throws if unset so misconfiguration fails fast at provision time rather
 * than producing healthy-looking records pointing nowhere.
 */
function targetIp(): string {
  const ip = process.env.TENANT_APP_TARGET_IP
  if (!ip || !ip.trim()) {
    throw new Error(
      'TENANT_APP_TARGET_IP is not set — required (a stable/attached IP) for tenant DNS. Refusing to write records to a placeholder.'
    )
  }
  return ip.trim()
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

async function route53(
  method: string,
  path: string,
  body?: string
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await signedAwsFetch({
    service: 'route53',
    region: 'us-east-1',
    method,
    hostname: ROUTE53_HOST,
    path,
    headers: { host: ROUTE53_HOST, ...(body ? { 'content-type': 'application/xml' } : {}) },
    ...(body ? { body } : {}),
  })
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, text }
}

async function upsert(hostnames: string[], overrideIp?: string): Promise<void> {
  if (hostnames.length === 0) return
  const ip = overrideIp && overrideIp.trim() ? overrideIp.trim() : targetIp()
  const changes = hostnames
    .map(
      h => `
    <Change>
      <Action>UPSERT</Action>
      <ResourceRecordSet>
        <Name>${xmlEscape(h)}</Name>
        <Type>A</Type>
        <TTL>300</TTL>
        <ResourceRecords><ResourceRecord><Value>${xmlEscape(ip)}</Value></ResourceRecord></ResourceRecords>
      </ResourceRecordSet>
    </Change>`
    )
    .join('')
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch><Changes>${changes}</Changes></ChangeBatch>
</ChangeResourceRecordSetsRequest>`
  const r = await route53('POST', `/2013-04-01/hostedzone/${HOSTED_ZONE_ID}/rrset`, body)
  if (!r.ok) throw new Error(`Route53 UPSERT failed (${r.status}): ${r.text.slice(0, 300)}`)
}

/**
 * Delete each hostname's record by first READING the record as it currently exists,
 * then issuing a DELETE that echoes its real Type/TTL/Value. Route53 DELETE requires an
 * exact match of the live record; rebuilding the payload from the current TARGET_IP broke
 * teardown after the target IP changed (mismatch → InvalidChangeBatch → stale records left).
 * Reading first makes teardown value-agnostic and truly idempotent. A record that doesn't
 * exist is simply skipped.
 */
async function deleteRecords(hostnames: string[]): Promise<void> {
  for (const h of hostnames) {
    const name = h.endsWith('.') ? h : `${h}.`
    const list = await route53(
      'GET',
      `/2013-04-01/hostedzone/${HOSTED_ZONE_ID}/rrset?name=${encodeURIComponent(name)}&type=A&maxitems=1`
    )
    if (!list.ok) throw new Error(`Route53 list failed for ${h} (${list.status}): ${list.text.slice(0, 200)}`)
    // Parse the returned record set; only delete if the Name matches exactly (Route53
    // returns the next record alphabetically if ours doesn't exist).
    const nameMatch = new RegExp(`<Name>${name.replace(/[.]/g, '\\.')}</Name>`, 'i').test(list.text)
    if (!nameMatch) continue // record doesn't exist → nothing to delete
    const ttl = (list.text.match(/<TTL>(\d+)<\/TTL>/) || [])[1] || '300'
    const values = [...list.text.matchAll(/<Value>([^<]+)<\/Value>/g)].map(m => m[1])
    if (values.length === 0) continue
    const recs = values.map(v => `<ResourceRecord><Value>${xmlEscape(v)}</Value></ResourceRecord>`).join('')
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch><Changes><Change>
    <Action>DELETE</Action>
    <ResourceRecordSet><Name>${xmlEscape(name)}</Name><Type>A</Type><TTL>${ttl}</TTL><ResourceRecords>${recs}</ResourceRecords></ResourceRecordSet>
  </Change></Changes></ChangeBatch>
</ChangeResourceRecordSetsRequest>`
    const del = await route53('POST', `/2013-04-01/hostedzone/${HOSTED_ZONE_ID}/rrset`, body)
    if (!del.ok && !/not found|does not exist/i.test(del.text)) {
      throw new Error(`Route53 DELETE failed for ${h} (${del.status}): ${del.text.slice(0, 300)}`)
    }
  }
}

/** Create/point tenant subdomains at a serving host (idempotent UPSERT). targetIp overrides the
 * env default — pass a dedicated instance IP for higher-plan tenants, or omit for the pool. */
export async function upsertTenantDns(hostnames: string[], targetIp?: string): Promise<void> {
  await upsert(hostnames, targetIp)
}

/** Remove tenant subdomains on deprovision (idempotent, value-agnostic). */
export async function deleteTenantDns(hostnames: string[]): Promise<void> {
  await deleteRecords(hostnames)
}
