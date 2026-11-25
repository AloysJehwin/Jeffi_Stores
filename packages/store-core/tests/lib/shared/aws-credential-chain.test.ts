// @vitest-environment node
// From Azure, AWS access comes from the cluster's service-account token (self-hosted IRSA):
// AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN, exchanged at STS. These run the real SDK chain against
// a local STS stand-in, so no instance metadata or static keys are involved.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { staticAwsCredentials } from '@/lib/shared/aws-credentials'

describe('staticAwsCredentials', () => {
  it('returns keys only when both are set', () => {
    expect(staticAwsCredentials({ AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK' })).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
    expect(staticAwsCredentials({ AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK', AWS_SESSION_TOKEN: 'T' })).toEqual({
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      sessionToken: 'T',
    })
  })

  it('is undefined (the default chain) when either is missing or blank, never blank keys', () => {
    expect(staticAwsCredentials({})).toBeUndefined()
    expect(staticAwsCredentials({ AWS_ACCESS_KEY_ID: 'AK' })).toBeUndefined()
    expect(staticAwsCredentials({ AWS_SECRET_ACCESS_KEY: 'SK' })).toBeUndefined()
    expect(staticAwsCredentials({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' })).toBeUndefined()
  })
})

describe('the default chain from a web identity token (self-hosted IRSA)', () => {
  let server: http.Server
  let stsCalls: string[] = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irsa-'))
  const ENV = { ...process.env }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        stsCalls.push(body)
        res.setHeader('content-type', 'text/xml')
        res.end(
          `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult>` +
            `<Credentials><AccessKeyId>ASIAIRSA</AccessKeyId><SecretAccessKey>irsa-secret</SecretAccessKey><SessionToken>irsa-session</SessionToken>` +
            `<Expiration>2099-01-01T00:00:00Z</Expiration></Credentials><AssumedRoleUser><Arn>arn:aws:sts::123456789012:assumed-role/jeffi-test/s</Arn>` +
            `<AssumedRoleId>AROA:s</AssumedRoleId></AssumedRoleUser></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`
        )
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    fs.writeFileSync(path.join(dir, 'token'), 'cluster.sa.jwt')
  })
  afterAll(() => {
    server.close()
  })
  beforeEach(() => {
    stsCalls = []
    vi.resetModules()
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE']) delete process.env[k]
    Object.assign(process.env, {
      AWS_CONFIG_FILE: path.join(dir, 'no-config'),
      AWS_SHARED_CREDENTIALS_FILE: path.join(dir, 'no-credentials'),
      AWS_WEB_IDENTITY_TOKEN_FILE: path.join(dir, 'token'),
      AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/jeffi-test',
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL_STS: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      AWS_EC2_METADATA_DISABLED: 'true',
    })
  })
  afterEach(() => {
    process.env = { ...ENV }
  })

  it('SigV4 REST clients (ec2, route53, ssm) get role credentials, assumed once and memoized', async () => {
    const { awsCredentialProvider } = await import('@/lib/shared/aws-signing')
    expect(awsCredentialProvider()).toBe(awsCredentialProvider())
    const creds = await awsCredentialProvider()()
    expect(creds).toMatchObject({ accessKeyId: 'ASIAIRSA', sessionToken: 'irsa-session' })
    await awsCredentialProvider()()
    expect(stsCalls).toHaveLength(1)
    const form = new URLSearchParams(stsCalls[0])
    expect(form.get('Action')).toBe('AssumeRoleWithWebIdentity')
    expect(form.get('RoleArn')).toBe('arn:aws:iam::123456789012:role/jeffi-test')
    expect(form.get('WebIdentityToken')).toBe('cluster.sa.jwt')
  })

  it('an S3 client without static keys resolves through the chain (no blank keys)', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({ region: 'us-east-1', credentials: staticAwsCredentials() })
    await expect(s3.config.credentials()).resolves.toMatchObject({ accessKeyId: 'ASIAIRSA' })
  })

  it('the Secrets Manager backend client resolves through the chain', async () => {
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
    const sm = new SecretsManagerClient({ region: 'us-east-1' })
    await expect(sm.config.credentials()).resolves.toMatchObject({ accessKeyId: 'ASIAIRSA' })
  })

  it('static keys, when set, still win and STS is not called', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIASTATIC'
    process.env.AWS_SECRET_ACCESS_KEY = 'static-secret'
    const { S3Client } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({ region: 'us-east-1', credentials: staticAwsCredentials() })
    await expect(s3.config.credentials()).resolves.toMatchObject({ accessKeyId: 'AKIASTATIC' })
    expect(stsCalls).toHaveLength(0)
  })
})
