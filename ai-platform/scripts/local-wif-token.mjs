#!/usr/bin/env node
// Local-dev identity for Claude workload identity federation. A keypair on this machine stands in for
// the cluster's token signer: register its public key as an inline-JWKS issuer, then point the local
// gateway's ANTHROPIC_IDENTITY_TOKEN_FILE at the token this writes.
//   node ai-platform/scripts/local-wif-token.mjs jwk            public key to paste into the issuer
//   node ai-platform/scripts/local-wif-token.mjs mint [--watch]  write a 1h token (--watch: every 30 min)
// Tokens carry no jti, so the gateway's per-store clients can all exchange the same one.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = process.env.JEFFI_WIF_DIR || join(homedir(), '.jeffi', 'wif')
const KEY = join(DIR, 'local-issuer.pem')
const TOKEN = join(DIR, 'token')
export const ISSUER = 'https://wif-local.jeffistores.in'
export const SUBJECT = 'jeffi-local-gateway'
const AUDIENCE = 'https://api.anthropic.com'
const KID = 'jeffi-local-1'

function privateKey() {
  if (!existsSync(KEY)) {
    mkdirSync(DIR, { recursive: true, mode: 0o700 })
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return createPrivateKey(readFileSync(KEY))
}

const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

function mint() {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID })
  const body = b64({ iss: ISSUER, sub: SUBJECT, aud: AUDIENCE, iat: now, nbf: now - 30, exp: now + 3600 })
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey()).toString('base64url')
  writeFileSync(TOKEN, `${head}.${body}.${sig}`, { mode: 0o600 })
  chmodSync(TOKEN, 0o600)
  console.log(`token written to ${TOKEN} (expires ${new Date((now + 3600) * 1000).toLocaleTimeString()})`)
}

const [cmd, flag] = process.argv.slice(2)
if (cmd === 'jwk') {
  const jwk = createPublicKey(privateKey()).export({ format: 'jwk' })
  console.log(JSON.stringify({ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }))
} else if (cmd === 'mint') {
  mint()
  if (flag === '--watch') setInterval(mint, 30 * 60 * 1000)
} else {
  console.error('usage: local-wif-token.mjs jwk | mint [--watch]')
  process.exit(1)
}
