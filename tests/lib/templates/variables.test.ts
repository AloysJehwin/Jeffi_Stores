import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStoreIdentity: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  currentBrandNameAsync: vi.fn(async () => 'Brand Fallback'),
  storeBaseUrlAsync: vi.fn(async () => 'https://acme.jeffistores.in'),
}))

import { queryMany, queryOne } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import {
  resolveTemplateVariables,
  listTemplateVariables,
  createTemplateVariableResolver,
  guardTemplateTokens,
} from '@/lib/templates/variables'

const IDENTITY = { name: 'Acme Tools', email: 'hi@acme.in', phone: '+91 90000 11111', web: 'acme.in', logoUrl: '' }
const CUSTOM = [
  { id: 'v1', key: 'support_hours', label: 'Support hours', description: '', value: '9–6 IST', is_enabled: true },
  { id: 'v2', key: 'old_promo', label: 'Old', description: '', value: 'gone', is_enabled: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStoreIdentity).mockResolvedValue(IDENTITY)
  vi.mocked(queryMany).mockResolvedValue(CUSTOM as any)
})

describe('resolveTemplateVariables', () => {
  it('loads store identity itself when store is omitted', async () => {
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in', first_name: 'Asha', last_name: 'R' } })
    expect(v.store_name).toBe('Acme Tools')
    expect(v.store_email).toBe('hi@acme.in')
    expect(v.store_phone).toBe('+91 90000 11111')
    expect(v.store_web).toBe('acme.in')
    expect(v.customer_name).toBe('Asha R')
    expect(v.customer_first_name).toBe('Asha')
  })

  it('fills only the blank store fields from identity', async () => {
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in' }, store: { web: 'biz.acme.in' } })
    expect(v.store_web).toBe('biz.acme.in')
    expect(v.store_name).toBe('Acme Tools')
  })

  it('never leaves store_name blank on a configured store', async () => {
    vi.mocked(getStoreIdentity).mockResolvedValue({ ...IDENTITY, name: '', web: '' })
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in' } })
    expect(v.store_name).toBe('Brand Fallback')
    expect(v.store_web).toBe('acme.jeffistores.in')
  })

  it('merges enabled custom variables only', async () => {
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in' } })
    expect(v.support_hours).toBe('9–6 IST')
    expect(v.old_promo).toBeUndefined()
  })

  it('lets extra win over built-ins and custom values', async () => {
    const v = await resolveTemplateVariables({
      recipient: { email: 'a@b.in' },
      extra: { order_number: 'ORD-1', support_hours: 'override', store_name: 'X' },
    })
    expect(v.order_number).toBe('ORD-1')
    expect(v.support_hours).toBe('override')
    expect(v.store_name).toBe('X')
  })

  it('still resolves built-ins when the custom table is unavailable', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('relation does not exist'))
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in' } })
    expect(v.store_name).toBe('Acme Tools')
  })

  it('falls back to "there" for a missing first name', async () => {
    const v = await resolveTemplateVariables({ recipient: { email: 'a@b.in' } })
    expect(v.customer_first_name).toBe('there')
  })
})

describe('listTemplateVariables', () => {
  it('returns built-ins plus enabled custom ones', async () => {
    const list = await listTemplateVariables()
    expect(list.find(v => v.key === 'store_name')?.builtIn).toBe(true)
    const custom = list.find(v => v.key === 'support_hours')
    expect(custom).toMatchObject({ group: 'custom', builtIn: false })
    expect(list.find(v => v.key === 'old_promo')).toBeUndefined()
  })
})

describe('createTemplateVariableResolver', () => {
  it('loads once and resolves per recipient', async () => {
    const resolve = await createTemplateVariableResolver()
    expect(resolve({ recipient: { email: 'x@y.in', first_name: 'Ravi' } }).customer_first_name).toBe('Ravi')
    expect(resolve({ recipient: { email: 'z@y.in' } }).customer_email).toBe('z@y.in')
    expect(getStoreIdentity).toHaveBeenCalledTimes(1)
  })
})

describe('guardTemplateTokens', () => {
  it('returns the mail unchanged when no token is present', async () => {
    const mail = { subject: 'Hello', html: '<p>x</p>' }
    expect(await guardTemplateTokens(mail, { to: 'a@b.in' })).toBe(mail)
    expect(getStoreIdentity).not.toHaveBeenCalled()
  })

  it('substitutes leaked registered tokens in every part and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(queryOne).mockResolvedValue({ first_name: 'Asha', last_name: null } as any)
    const out = await guardTemplateTokens(
      {
        subject: 'News from {store_name}',
        html: '<b>{{ store_name }}</b> {support_hours} {keep_me}',
        amp: '<div>{store_name}</div>',
        text: 'Hi {customer_first_name}',
      },
      { to: 'a@b.in', userId: 'u1', templateName: 'campaign' }
    )
    expect(out.subject).toBe('News from Acme Tools')
    expect(out.html).toBe('<b>Acme Tools</b> 9–6 IST {keep_me}')
    expect(out.amp).toBe('<div>Acme Tools</div>')
    expect(out.text).toBe('Hi Asha')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('leaves unregistered tokens alone without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mail = { subject: 'x', html: '{not_a_var}' }
    expect(await guardTemplateTokens(mail, { to: 'a@b.in' })).toBe(mail)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
