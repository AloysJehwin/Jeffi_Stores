import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pollDevice, startDevice } from '../src/auth/device'
import { credentialsPath, loadConfig, loadCredentials, saveCredentials } from '../src/config'
import { JSON_HEADERS, run, testIo, tmpDir } from './helpers'

const ADMIN = 'http://admin-acme.localhost:3000'
const PUBLIC = 'http://public-acme.localhost:3000'
const DEVICE = `${PUBLIC}/v1/admin/cli-auth`
const mode = (f: string) => fs.statSync(f).mode & 0o777

describe('credentials file', () => {
  it('is written 0600 in a 0700 directory, even over a looser file', () => {
    const dir = `${tmpDir()}/cfg`
    fs.mkdirSync(dir)
    fs.writeFileSync(credentialsPath(dir), '{}', { mode: 0o644 })
    saveCredentials(dir, { default: { token: 'jfc_x' } })
    expect(mode(credentialsPath(dir))).toBe(0o600)
    expect(loadCredentials(dir).default.token).toBe('jfc_x')
  })

  it('profiles add --service-account stores the key 0600 and the profile without it', async () => {
    const dir = tmpDir()
    const t = testIo(dir)
    await run(t.io, ['profiles', 'add', 'bot', '--store', 'acme', '--service-account', 'jsa_secret'])
    expect(mode(credentialsPath(dir))).toBe(0o600)
    expect(loadCredentials(dir).bot.token).toBe('jsa_secret')
    expect(loadConfig(dir)).toEqual({ current: 'bot', profiles: { bot: { store: 'acme', kind: 'service_account' } } })
    expect(fs.readFileSync(`${dir}/config.json`, 'utf8')).not.toContain('jsa_')
    await expect(run(t.io, ['profiles', 'add', 'bad', '--service-account', 'jfc_wrong'])).rejects.toThrow('jsa_')
  })
})

describe('device login (RFC 8628)', () => {
  it('waits through authorization_pending and slow_down, then returns the token', async () => {
    const t = testIo(tmpDir())
    const pool = t.agent.get(PUBLIC)
    pool.intercept({ path: '/v1/admin/cli-auth/start', method: 'POST' }).reply(200, { device_code: 'dc1', user_code: 'ABCD-EFGH', verification_uri: `${ADMIN}/admin/cli/authorize`, interval: 5, expires_in: 600 }, JSON_HEADERS)
    const poll = { path: '/v1/admin/cli-auth/poll', method: 'POST', body: (b: string) => JSON.parse(b).device_code === 'dc1' }
    pool.intercept(poll).reply(400, { error: 'authorization_pending' }, JSON_HEADERS)
    pool.intercept(poll).reply(400, { error: 'slow_down' }, JSON_HEADERS)
    pool.intercept(poll).reply(200, { access_token: 'jfc_new', expires_at: '2026-11-07T00:00:00Z', scopes: ['products:read'] }, JSON_HEADERS)
    const start = await startDevice(DEVICE, {}, { dispatcher: t.agent })
    expect(start.user_code).toBe('ABCD-EFGH')
    const tok = await pollDevice(DEVICE, start, { dispatcher: t.agent, sleep: t.io.sleep, now: () => 0 })
    expect(tok).toEqual({ token: 'jfc_new', expiresAt: '2026-11-07T00:00:00Z', scopes: ['products:read'] })
    expect(t.sleeps).toEqual([5000, 5000, 10000])
  })

  it('stops on access_denied and expired_token', async () => {
    for (const error of ['access_denied', 'expired_token']) {
      const t = testIo(tmpDir())
      t.agent.get(PUBLIC).intercept({ path: '/v1/admin/cli-auth/poll', method: 'POST' }).reply(400, { error }, JSON_HEADERS)
      await expect(pollDevice(DEVICE, { device_code: 'd', user_code: 'u', verification_uri: 'x', interval: 1 }, { dispatcher: t.agent, sleep: t.io.sleep, now: () => 0 })).rejects.toThrow(error === 'access_denied' ? 'denied' : 'expired')
    }
  })

  it('jeffi login runs on the public API, approves on the admin host, and saves the token', async () => {
    const dir = tmpDir()
    const t = testIo(dir)
    const pool = t.agent.get(PUBLIC)
    pool.intercept({ path: '/v1/admin/cli-auth/start', method: 'POST' }).reply(200, { device_code: 'dc2', user_code: 'WXYZ-1234', verification_uri: '/admin/cli/authorize', interval: 1 }, JSON_HEADERS)
    pool.intercept({ path: '/v1/admin/cli-auth/poll', method: 'POST' }).reply(200, { access_token: 'jfc_saved', expires_in: 3600 }, JSON_HEADERS)
    await run(t.io, ['login', '--store', 'acme', '--local', '--no-browser'])
    expect(t.err.join('\n')).toContain(`${ADMIN}/admin/cli/authorize?code=WXYZ-1234`)
    expect(loadConfig(dir).profiles.default).toEqual({ store: 'acme', kind: 'person', local: true })
    expect(loadCredentials(dir).default.token).toBe('jfc_saved')
    expect(mode(credentialsPath(dir))).toBe(0o600)
  })
})
