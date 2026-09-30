import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Sha256 } from '@aws-crypto/sha256-js'

/**
 * Minimal EC2 Query-API client (SigV4-signed REST) — mirrors tenant-dns.ts. Avoids adding
 * @aws-sdk/client-ec2 (which would version-skew against the installed 3.477 SDK). Only the
 * few actions the pool resize controller needs. Region-pinned to us-east-1.
 */

const EC2_HOST = 'ec2.us-east-1.amazonaws.com'
const API_VERSION = '2016-11-15'

async function ec2(params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({ Version: API_VERSION, ...params }).toString()
  const request = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname: EC2_HOST,
    path: '/',
    headers: { host: EC2_HOST, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const signer = new SignatureV4({
    service: 'ec2',
    region: 'us-east-1',
    credentials: defaultProvider(),
    sha256: Sha256,
  })
  const signed = await signer.sign(request)
  const res = await fetch(`https://${EC2_HOST}/`, { method: 'POST', headers: signed.headers as any, body })
  const text = await res.text()
  if (!res.ok) throw new Error(`EC2 ${params.Action} failed (${res.status}): ${text.slice(0, 400)}`)
  return text
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : null
}

function xmlTagAll(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map(m => m[1])
}

export interface InstanceState {
  instanceType: string
  state: string
}

export async function describeInstance(instanceId: string): Promise<InstanceState> {
  const xml = await ec2({ Action: 'DescribeInstances', 'InstanceId.1': instanceId })
  return {
    instanceType: xmlTag(xml, 'instanceType') ?? '',
    state: xmlTag(xml, 'name') ?? '', // <instanceState><name>running</name>
  }
}

export async function stopInstance(instanceId: string): Promise<void> {
  await ec2({ Action: 'StopInstances', 'InstanceId.1': instanceId })
}

export async function startInstance(instanceId: string): Promise<void> {
  await ec2({ Action: 'StartInstances', 'InstanceId.1': instanceId })
}

export async function modifyInstanceType(instanceId: string, instanceType: string): Promise<void> {
  await ec2({ Action: 'ModifyInstanceAttribute', InstanceId: instanceId, 'InstanceType.Value': instanceType })
}

/**
 * EC2 is eventually consistent: an instance RunInstances just returned an id for is not
 * immediately visible to DescribeInstances, which answers InvalidInstanceID.NotFound for a few
 * seconds. Treating that as fatal killed provisioning runs whose instance had launched fine.
 */
export function isInstanceNotFound(e: unknown): boolean {
  return /InvalidInstanceID\.NotFound/i.test(e instanceof Error ? e.message : String(e))
}

/** Poll DescribeInstances until the instance reaches `want` (or times out). */
export async function waitForState(instanceId: string, want: string, timeoutMs = 240000): Promise<void> {
  const start = Date.now()
  let everSeen = false
  // Date.now in a route is fine (not a workflow); simple bounded poll.
  while (Date.now() - start < timeoutMs) {
    try {
      const { state } = await describeInstance(instanceId)
      everSeen = true
      if (state === want) return
    } catch (e) {
      // Not-yet-visible is expected right after launch; anything else is a real failure.
      if (!isInstanceNotFound(e)) throw e
      // Once the instance HAS been seen, a later NotFound means it went away — stop waiting
      // for a state it can never reach.
      if (everSeen) throw e
    }
    await new Promise(r => setTimeout(r, 8000))
  }
  throw new Error(
    `EC2 ${instanceId} did not reach '${want}' within ${timeoutMs}ms` +
      (everSeen ? '' : ' (never became visible to DescribeInstances)')
  )
}

// ── Instance lifecycle: launch / terminate / ip (tenant + pool provisioning) ──────

export interface RunInstanceArgs {
  instanceType: string
  name: string
  userData?: string // shell/cloud-config; base64-encoded here
}

/** Launch a new EC2 running the app image. Config (AMI, SG, subnet, key, IAM profile) from env,
 * mirroring how aws-provider reads RDS config. Returns the new instance id. */
export async function runInstance(args: RunInstanceArgs): Promise<{ instanceId: string }> {
  const ami = process.env.TENANT_APP_AMI_ID
  if (!ami) throw new Error('TENANT_APP_AMI_ID is not set — required to launch a tenant/pool app instance')
  const sg = process.env.TENANT_APP_SECURITY_GROUP || process.env.TENANT_RDS_SECURITY_GROUP || ''
  const subnet = process.env.TENANT_APP_SUBNET_ID || ''
  const iamProfile = process.env.TENANT_APP_IAM_PROFILE || ''
  const keyName = process.env.TENANT_APP_KEY_NAME || ''

  const params: Record<string, string> = {
    Action: 'RunInstances',
    ImageId: ami,
    InstanceType: args.instanceType,
    MinCount: '1',
    MaxCount: '1',
    'TagSpecification.1.ResourceType': 'instance',
    'TagSpecification.1.Tag.1.Key': 'Name',
    'TagSpecification.1.Tag.1.Value': args.name,
    'TagSpecification.1.Tag.2.Key': 'app',
    'TagSpecification.1.Tag.2.Value': 'jeffi-tenant',
  }
  if (sg) params['SecurityGroupId.1'] = sg
  if (subnet) params['SubnetId'] = subnet
  if (keyName) params['KeyName'] = keyName
  if (iamProfile) params['IamInstanceProfile.Name'] = iamProfile
  if (args.userData) params['UserData'] = Buffer.from(args.userData, 'utf8').toString('base64')

  const xml = await ec2(params)
  const instanceId = xmlTag(xml, 'instanceId')
  if (!instanceId) throw new Error(`RunInstances returned no instanceId: ${xml.slice(0, 300)}`)
  return { instanceId }
}

/** Public IP of an instance (once running), or null if not yet assigned. */
export async function getInstanceIp(instanceId: string): Promise<string | null> {
  try {
    const xml = await ec2({ Action: 'DescribeInstances', 'InstanceId.1': instanceId })
    return xmlTag(xml, 'ipAddress') // <ipAddress> is the public IP
  } catch (e) {
    // Same eventual-consistency window as waitForState; callers poll, so "not yet" is null.
    if (isInstanceNotFound(e)) return null
    throw e
  }
}

export async function terminateInstance(instanceId: string): Promise<void> {
  await ec2({ Action: 'TerminateInstances', 'InstanceId.1': instanceId })
}

/** Ids of every running box tagged app=jeffi-tenant — the pool that serves tenant stores and
 * whose nginx must be reloaded when the client-CA bundle changes. Tag-selected (not a fixed
 * list) so it tracks the pool as it scales; mirrors the CI deploy-fleet selection. */
export async function describeRunningTenantInstanceIds(): Promise<string[]> {
  const xml = await ec2({
    Action: 'DescribeInstances',
    'Filter.1.Name': 'tag:app',
    'Filter.1.Value.1': 'jeffi-tenant',
    'Filter.2.Name': 'instance-state-name',
    'Filter.2.Value.1': 'running',
  })
  return xmlTagAll(xml, 'instanceId')
}

/** True once the instance no longer exists or is terminated (teardown ordering). */
export async function isInstanceGone(instanceId: string): Promise<boolean> {
  try {
    const { state } = await describeInstance(instanceId)
    return state === 'terminated' || state === ''
  } catch (e: any) {
    // NotFound → gone.
    return /NotFound|InvalidInstanceID/i.test(e?.message || '')
  }
}

// ── Security-group ingress (LOCAL PROVISIONING TEST ONLY) ────────────────────────

/** This machine's current public IP, via AWS's own checkip endpoint. Null on any failure —
 * callers treat that as "can't self-authorize" and carry on. */
export async function currentPublicIp(): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch('https://checkip.amazonaws.com', { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const ip = (await res.text()).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null
  } catch {
    return null
  }
}

/** Authorize a single CIDR on a TCP port in a security group. Idempotent: an existing
 * identical rule (InvalidPermission.Duplicate) is treated as success. */
export async function authorizeSgIngress(args: {
  groupId: string
  cidr: string
  port: number
  description?: string
}): Promise<void> {
  try {
    await ec2({
      Action: 'AuthorizeSecurityGroupIngress',
      GroupId: args.groupId,
      'IpPermissions.1.IpProtocol': 'tcp',
      'IpPermissions.1.FromPort': String(args.port),
      'IpPermissions.1.ToPort': String(args.port),
      'IpPermissions.1.IpRanges.1.CidrIp': args.cidr,
      ...(args.description ? { 'IpPermissions.1.IpRanges.1.Description': args.description } : {}),
    })
  } catch (err: any) {
    if (/InvalidPermission\.Duplicate/i.test(err?.message || '')) return
    throw err
  }
}

/** Revoke a previously authorized CIDR/port. Idempotent: NotFound is success. */
export async function revokeSgIngress(args: { groupId: string; cidr: string; port: number }): Promise<void> {
  try {
    await ec2({
      Action: 'RevokeSecurityGroupIngress',
      GroupId: args.groupId,
      'IpPermissions.1.IpProtocol': 'tcp',
      'IpPermissions.1.FromPort': String(args.port),
      'IpPermissions.1.ToPort': String(args.port),
      'IpPermissions.1.IpRanges.1.CidrIp': args.cidr,
    })
  } catch (err: any) {
    if (/InvalidPermission\.NotFound|NotFound/i.test(err?.message || '')) return
    throw err
  }
}
