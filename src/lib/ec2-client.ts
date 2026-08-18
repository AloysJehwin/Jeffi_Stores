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
    method: 'POST', protocol: 'https:', hostname: EC2_HOST, path: '/',
    headers: { host: EC2_HOST, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const signer = new SignatureV4({ service: 'ec2', region: 'us-east-1', credentials: defaultProvider(), sha256: Sha256 })
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

export interface InstanceState { instanceType: string; state: string }

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

/** Poll DescribeInstances until the instance reaches `want` (or times out). */
export async function waitForState(instanceId: string, want: string, timeoutMs = 240000): Promise<void> {
  const start = Date.now()
  // Date.now in a route is fine (not a workflow); simple bounded poll.
  while (Date.now() - start < timeoutMs) {
    const { state } = await describeInstance(instanceId)
    if (state === want) return
    await new Promise((r) => setTimeout(r, 8000))
  }
  throw new Error(`EC2 ${instanceId} did not reach '${want}' within ${timeoutMs}ms`)
}
