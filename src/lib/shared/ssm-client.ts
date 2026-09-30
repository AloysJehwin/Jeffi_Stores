import { signedAwsFetch } from '@/lib/shared/aws-signing'

/**
 * Minimal SSM client (SigV4-signed AWS-JSON-1.1) — mirrors ec2-client.ts. Avoids adding
 * @aws-sdk/client-ssm, which would version-skew against the installed 3.477 SDK. Only
 * SendCommand, the one action the fleet mTLS refresh needs. Region-pinned to us-east-1.
 */

const SSM_HOST = 'ssm.us-east-1.amazonaws.com'

async function ssm(target: string, payload: Record<string, unknown>): Promise<any> {
  const body = JSON.stringify(payload)
  const res = await signedAwsFetch({
    service: 'ssm',
    region: 'us-east-1',
    method: 'POST',
    hostname: SSM_HOST,
    path: '/',
    headers: {
      host: SSM_HOST,
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AmazonSSM.${target}`,
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SSM ${target} failed (${res.status}): ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : {}
}

/** Run a shell command on the given instances via AWS-RunShellScript. Returns the command id
 * (null if SSM answered without one) so callers can log it; does not wait for completion. */
export async function sendShellCommand(
  instanceIds: string[],
  commands: string[],
  comment?: string
): Promise<{ commandId: string | null }> {
  if (instanceIds.length === 0) return { commandId: null }
  const out = await ssm('SendCommand', {
    InstanceIds: instanceIds,
    DocumentName: 'AWS-RunShellScript',
    ...(comment ? { Comment: comment.slice(0, 100) } : {}),
    Parameters: { commands },
  })
  return { commandId: out?.Command?.CommandId ?? null }
}
