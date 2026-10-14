import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Sha256 } from '@aws-crypto/sha256-js'

// Shared SigV4 signing for the minimal REST clients (ec2-client, ssm-client,
// tenant-dns). Each avoids the matching @aws-sdk/client-* package (version skew
// against the installed 3.477 SDK) and signs the REST call directly with the
// SigV4 + credential libs already installed for rds-signer.

export interface SignedAwsRequest {
  service: string
  region: string
  method: string
  hostname: string
  path: string
  headers: Record<string, string>
  body?: string
}

// Build an HttpRequest, SigV4-sign it, and fetch it. Returns the raw Response so
// each caller keeps its own status/body handling. Behaviour is identical to the
// per-module inline signing this replaces.
export async function signedAwsFetch(req: SignedAwsRequest): Promise<Response> {
  const request = new HttpRequest({
    method: req.method,
    protocol: 'https:',
    hostname: req.hostname,
    path: req.path,
    headers: req.headers,
    ...(req.body !== undefined ? { body: req.body } : {}),
  })
  const signer = new SignatureV4({
    service: req.service,
    region: req.region,
    credentials: defaultProvider(),
    sha256: Sha256,
  })
  const signed = await signer.sign(request)
  return fetch(`https://${req.hostname}${req.path}`, {
    method: req.method,
    headers: signed.headers as any,
    ...(req.body !== undefined ? { body: req.body } : {}),
  })
}
