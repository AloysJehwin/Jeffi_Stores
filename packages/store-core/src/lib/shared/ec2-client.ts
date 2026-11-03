import { signedAwsFetch } from '@/lib/shared/aws-signing'

/**
 * Minimal EC2 Query-API client (SigV4-signed REST) — mirrors tenant-dns.ts. Avoids adding
 * @aws-sdk/client-ec2 (which would version-skew against the installed 3.477 SDK). Only the
 * few actions the pool resize controller needs. Region-pinned to us-east-1.
 */

const EC2_HOST = 'ec2.us-east-1.amazonaws.com'
const API_VERSION = '2016-11-15'

async function ec2(params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({ Version: API_VERSION, ...params }).toString()
  const res = await signedAwsFetch({
    service: 'ec2',
    region: 'us-east-1',
    method: 'POST',
    hostname: EC2_HOST,
    path: '/',
    headers: { host: EC2_HOST, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
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
  availabilityZone?: string
}

export async function describeInstance(instanceId: string): Promise<InstanceState> {
  const xml = await ec2({ Action: 'DescribeInstances', 'InstanceId.1': instanceId })
  return {
    instanceType: xmlTag(xml, 'instanceType') ?? '',
    state: xmlTag(xml, 'name') ?? '', // <instanceState><name>running</name>
    availabilityZone: xmlTag(xml, 'availabilityZone') ?? undefined, // <placement><availabilityZone>
  }
}

/** A live (not terminated) instance by its Name tag; null when there is none. */
export async function findInstanceByName(name: string): Promise<{ instanceId: string; state: string; availabilityZone: string } | null> {
  const xml = await ec2({
    Action: 'DescribeInstances',
    'Filter.1.Name': 'tag:Name',
    'Filter.1.Value.1': name,
    'Filter.2.Name': 'instance-state-name',
    'Filter.2.Value.1': 'pending',
    'Filter.2.Value.2': 'running',
    'Filter.2.Value.3': 'stopping',
    'Filter.2.Value.4': 'stopped',
  })
  const instanceId = xmlTag(xml, 'instanceId')
  if (!instanceId) return null
  return { instanceId, state: xmlTag(xml, 'name') ?? '', availabilityZone: xmlTag(xml, 'availabilityZone') ?? '' }
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

export interface BlockDeviceMapping {
  deviceName: string // e.g. /dev/sdf (surfaces as /dev/nvme1n1 on Nitro)
  volumeType?: string // gp3 by default
  sizeGb: number
  deleteOnTermination?: boolean
  encrypted?: boolean
}

export interface RunInstanceArgs {
  instanceType: string
  name: string
  userData?: string // shell/cloud-config; base64-encoded here
  // k8s nodes override the app-instance defaults (stock AL2023 AMI, node SG, node profile).
  imageId?: string
  securityGroupId?: string
  iamProfile?: string
  appTag?: string
  metadataHopLimit?: number
  tags?: Record<string, string>
  // Extra EBS volumes created with the instance. They carry no tags: a TagSpecification of type volume
  // would tag the root volume too (a store's database disk is created and tagged on its own instead).
  blockDeviceMappings?: BlockDeviceMapping[]
  availabilityZone?: string
}

/** Launch a new EC2 running the app image. Config (AMI, SG, subnet, key, IAM profile) from env,
 * mirroring how aws-provider reads RDS config. Returns the new instance id. */
export async function runInstance(args: RunInstanceArgs): Promise<{ instanceId: string }> {
  const ami = args.imageId || process.env.TENANT_APP_AMI_ID
  if (!ami) throw new Error('TENANT_APP_AMI_ID is not set — required to launch a tenant/pool app instance')
  const sg =
    args.securityGroupId || process.env.TENANT_APP_SECURITY_GROUP || process.env.TENANT_RDS_SECURITY_GROUP || ''
  const subnet = process.env.TENANT_APP_SUBNET_ID || ''
  const iamProfile = args.iamProfile || process.env.TENANT_APP_IAM_PROFILE || ''
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
    'TagSpecification.1.Tag.2.Value': args.appTag || 'jeffi-tenant',
  }
  Object.entries(args.tags ?? {}).forEach(([k, v], i) => {
    params[`TagSpecification.1.Tag.${i + 3}.Key`] = k
    params[`TagSpecification.1.Tag.${i + 3}.Value`] = v
  })
  if (args.metadataHopLimit) {
    params['MetadataOptions.HttpTokens'] = 'required'
    params['MetadataOptions.HttpPutResponseHopLimit'] = String(args.metadataHopLimit)
  }
  if (sg) params['SecurityGroupId.1'] = sg
  if (subnet) params['SubnetId'] = subnet
  if (keyName) params['KeyName'] = keyName
  if (iamProfile) params['IamInstanceProfile.Name'] = iamProfile
  if (args.availabilityZone) params['Placement.AvailabilityZone'] = args.availabilityZone
  if (args.userData) params['UserData'] = Buffer.from(args.userData, 'utf8').toString('base64')
  // Extra EBS data volumes (indexed from 2 — index 1 is the root volume AWS gives us).
  for (const [i, m] of (args.blockDeviceMappings ?? []).entries()) {
    const n = i + 2
    params[`BlockDeviceMapping.${n}.DeviceName`] = m.deviceName
    params[`BlockDeviceMapping.${n}.Ebs.VolumeSize`] = String(m.sizeGb)
    params[`BlockDeviceMapping.${n}.Ebs.VolumeType`] = m.volumeType || 'gp3'
    params[`BlockDeviceMapping.${n}.Ebs.DeleteOnTermination`] = String(m.deleteOnTermination ?? false)
    if (m.encrypted) params[`BlockDeviceMapping.${n}.Ebs.Encrypted`] = 'true'
  }

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

export interface TenantServer {
  id: string
  type: string
  state: string // pending | running | stopping | stopped
  az: string
  launchedAt: string | null
  name: string
}

/**
 * Every live k8s node instance (tag app=jeffi-k8s), one paginated DescribeInstances. Store servers carry
 * jeffi-tenant=<slug> (byTenant); the rest (core, pool-basic-N) are shared.
 */
export async function describeTenantServers(): Promise<{ byTenant: Record<string, TenantServer[]>; shared: TenantServer[] }> {
  const byTenant: Record<string, TenantServer[]> = {}
  const shared: TenantServer[] = []
  let token: string | null = null
  do {
    const xml = await ec2({
      Action: 'DescribeInstances',
      MaxResults: '1000',
      'Filter.1.Name': 'tag:app',
      'Filter.1.Value.1': 'jeffi-k8s',
      'Filter.2.Name': 'instance-state-name',
      'Filter.2.Value.1': 'pending',
      'Filter.2.Value.2': 'running',
      'Filter.2.Value.3': 'stopping',
      'Filter.2.Value.4': 'stopped',
      ...(token ? { NextToken: token } : {}),
    })
    // Instance items are the only <item>s that open with <instanceId>; each runs to the next one.
    const starts = [...xml.matchAll(/<item>\s*<instanceId>i-[0-9a-f]+<\/instanceId>/g)].map(m => m.index!)
    starts.forEach((at, i) => {
      const item = xml.slice(at, starts[i + 1] ?? xml.length)
      const tagSet = item.match(/<tagSet>([\s\S]*?)<\/tagSet>/)?.[1] ?? ''
      const tags = Object.fromEntries([...tagSet.matchAll(/<key>([^<]*)<\/key>\s*<value>([^<]*)<\/value>/g)].map(m => [m[1], m[2]]))
      const server: TenantServer = {
        id: xmlTag(item, 'instanceId')!,
        type: xmlTag(item, 'instanceType') ?? '',
        state: item.match(/<instanceState>[\s\S]*?<name>([^<]*)<\/name>/)?.[1] ?? '',
        az: item.match(/<placement>[\s\S]*?<availabilityZone>([^<]*)<\/availabilityZone>/)?.[1] ?? '',
        launchedAt: xmlTag(item, 'launchTime'),
        name: tags.Name ?? '',
      }
      const slug = tags['jeffi-tenant']
      if (slug) (byTenant[slug] ??= []).push(server)
      else shared.push(server)
    })
    token = xmlTag(xml, 'nextToken')
  } while (token)
  return { byTenant, shared }
}

/** Instance types of every running or pending instance in the account (for vCPU-quota headroom). */
export async function describeActiveInstanceTypes(): Promise<string[]> {
  const xml = await ec2({
    Action: 'DescribeInstances',
    'Filter.1.Name': 'instance-state-name',
    'Filter.1.Value.1': 'running',
    'Filter.1.Value.2': 'pending',
  })
  return xmlTagAll(xml, 'instanceType')
}

/** The instance's Name tag; null when the instance does not exist. */
export async function describeInstanceName(instanceId: string): Promise<string | null> {
  try {
    const xml = await ec2({ Action: 'DescribeInstances', 'InstanceId.1': instanceId })
    if (!xmlTag(xml, 'instanceId')) return null
    return xml.match(/<key>Name<\/key>\s*<value>([^<]*)<\/value>/)?.[1] ?? ''
  } catch (e) {
    if (isInstanceNotFound(e)) return null
    throw e
  }
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

// ── EBS data volumes (a store's on-node database disk, tagged and moved between its servers) ────

export interface EbsVolume {
  volumeId: string
  availabilityZone: string
  state: string // creating | available | in-use | deleting | ...
  sizeGb: number
  attachedInstanceId: string | null
  attachmentState: string | null // attaching | attached | detaching
}

export const DB_VOLUME_TAGS = (slug: string) => ({ Name: `jeffi-db-${slug}`, 'jeffi-tenant': slug, 'jeffi:role': 'db' })

/** Volume items of a DescribeVolumes answer (attachment items nest their own <volumeId>). */
function parseVolumes(xml: string): (EbsVolume & { device: string | null })[] {
  const starts = [...xml.matchAll(/<item>\s*<volumeId>vol-[0-9a-f]+<\/volumeId>\s*<size>/g)].map(m => m.index!)
  return starts.map((at, i) => {
    const item = xml.slice(at, starts[i + 1] ?? xml.length)
    const att = item.match(/<attachmentSet>([\s\S]*?)<\/attachmentSet>/)?.[1] ?? ''
    return {
      volumeId: xmlTag(item, 'volumeId')!,
      sizeGb: Number(xmlTag(item, 'size') ?? 0),
      availabilityZone: xmlTag(item, 'availabilityZone') ?? '',
      state: xmlTag(item.replace(att, ''), 'status') ?? '',
      attachedInstanceId: xmlTag(att, 'instanceId'),
      attachmentState: xmlTag(att, 'status'),
      device: xmlTag(att, 'device'),
    }
  })
}

/**
 * The store's database volume (tags jeffi:role=db + jeffi-tenant=slug); null when none. A disk on a
 * root device is skipped: earlier launches tagged every volume of the instance, the root one included.
 */
export async function describeTenantDbVolume(slug: string): Promise<EbsVolume | null> {
  const xml = await ec2({
    Action: 'DescribeVolumes',
    'Filter.1.Name': 'tag:jeffi:role',
    'Filter.1.Value.1': 'db',
    'Filter.2.Name': 'tag:jeffi-tenant',
    'Filter.2.Value.1': slug,
  })
  const vol = parseVolumes(xml).find(v => !['deleting', 'deleted', 'error'].includes(v.state) && !/^\/dev\/(xvda|sda1?)$/.test(v.device ?? ''))
  if (!vol) return null
  const { device: _d, ...rest } = vol
  return rest
}

/** One volume by id; null when it no longer exists. */
export async function describeVolume(volumeId: string): Promise<EbsVolume | null> {
  try {
    const vol = parseVolumes(await ec2({ Action: 'DescribeVolumes', 'VolumeId.1': volumeId }))[0]
    if (!vol) return null
    const { device: _d, ...rest } = vol
    return rest
  } catch (e: any) {
    if (/InvalidVolume\.NotFound/i.test(e?.message || '')) return null
    throw e
  }
}

/** Create the store's encrypted gp3 database volume, tagged at creation (only this volume). */
export async function createTenantDbVolume(args: { slug: string; availabilityZone: string; sizeGb: number }): Promise<string> {
  const params: Record<string, string> = {
    Action: 'CreateVolume',
    AvailabilityZone: args.availabilityZone,
    Size: String(args.sizeGb),
    VolumeType: 'gp3',
    Encrypted: 'true',
    'TagSpecification.1.ResourceType': 'volume',
  }
  Object.entries(DB_VOLUME_TAGS(args.slug)).forEach(([k, v], i) => {
    params[`TagSpecification.1.Tag.${i + 1}.Key`] = k
    params[`TagSpecification.1.Tag.${i + 1}.Value`] = v
  })
  const id = xmlTag(await ec2(params), 'volumeId')
  if (!id) throw new Error('CreateVolume returned no volumeId')
  return id
}

/**
 * Attach a volume to a running instance at `deviceName`. Already attached to that instance is success;
 * anything else (a pending instance, the volume on another one) throws so the caller retries.
 */
export async function attachVolume(volumeId: string, instanceId: string, deviceName: string): Promise<void> {
  try {
    await ec2({ Action: 'AttachVolume', VolumeId: volumeId, InstanceId: instanceId, Device: deviceName })
  } catch (e: any) {
    if (/VolumeInUse/i.test(e?.message || '') && (await describeVolume(volumeId))?.attachedInstanceId === instanceId) return
    throw e
  }
}

/** Detach a volume. Already detached is success. `force` only for a disk being retired. */
export async function detachVolume(volumeId: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    await ec2({ Action: 'DetachVolume', VolumeId: volumeId, ...(opts.force ? { Force: 'true' } : {}) })
  } catch (e: any) {
    if (/IncorrectState|InvalidAttachment\.NotFound|InvalidVolume\.NotFound/i.test(e?.message || '')) return
    throw e
  }
}

/** Grow a volume (EBS never shrinks). The filesystem is grown on the node (node-user-data.ts). */
export async function modifyVolumeSize(volumeId: string, sizeGb: number): Promise<void> {
  await ec2({ Action: 'ModifyVolume', VolumeId: volumeId, Size: String(sizeGb) })
}

/** Point-in-time snapshot of a volume, tagged for the tenant. Returns the snapshot id. */
export async function snapshotVolume(volumeId: string, slug: string, description?: string): Promise<string> {
  const xml = await ec2({
    Action: 'CreateSnapshot',
    VolumeId: volumeId,
    ...(description ? { Description: description } : {}),
    'TagSpecification.1.ResourceType': 'snapshot',
    'TagSpecification.1.Tag.1.Key': 'jeffi-tenant',
    'TagSpecification.1.Tag.1.Value': slug,
    'TagSpecification.1.Tag.2.Key': 'jeffi:role',
    'TagSpecification.1.Tag.2.Value': 'db',
  })
  const id = xmlTag(xml, 'snapshotId')
  if (!id) throw new Error(`CreateSnapshot returned no snapshotId: ${xml.slice(0, 300)}`)
  return id
}

/** pending | completed | error; null when the snapshot does not exist. */
export async function describeSnapshotState(snapshotId: string): Promise<string | null> {
  try {
    const xml = await ec2({ Action: 'DescribeSnapshots', 'SnapshotId.1': snapshotId })
    return xmlTag(xml, 'status')
  } catch (e: any) {
    if (/InvalidSnapshot\.NotFound/i.test(e?.message || '')) return null
    throw e
  }
}

/** Delete a snapshot. Idempotent: gone is success. */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  try {
    await ec2({ Action: 'DeleteSnapshot', SnapshotId: snapshotId })
  } catch (e: any) {
    if (/InvalidSnapshot\.NotFound/i.test(e?.message || '')) return
    throw e
  }
}

/**
 * Delete an EBS volume. Idempotent: gone is success. A volume still attached (its instance is shutting
 * down) is waited on until it is `available`, at most `waitMs`; past that it throws, never deletes.
 */
export async function deleteVolume(volumeId: string, opts: { waitMs?: number } = {}): Promise<void> {
  const until = Date.now() + (opts.waitMs ?? 5 * 60_000)
  for (;;) {
    const vol = await describeVolume(volumeId)
    if (!vol || vol.state === 'deleting' || vol.state === 'deleted') return
    if (vol.state === 'available') break
    if (Date.now() >= until) throw new Error(`volume ${volumeId} is still ${vol.state}${vol.attachedInstanceId ? ` on ${vol.attachedInstanceId}` : ''}; not deleted`)
    await new Promise(r => setTimeout(r, 5000))
  }
  try {
    await ec2({ Action: 'DeleteVolume', VolumeId: volumeId })
  } catch (e: any) {
    if (/InvalidVolume\.NotFound/i.test(e?.message || '')) return
    throw e
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
