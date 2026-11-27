import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ getVersion: vi.fn(), getContact: vi.fn(), known: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/catalog', async () => await import('../../../../../../lib/outreach/agent/skill-fake-catalog'))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({ getVersion: m.getVersion }))
vi.mock('@controller/lib/outreach/contacts', () => ({ getContact: m.getContact }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: m.known }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: m.query }) }))

import { POST } from '@controller/app/api/(admin)/admin/ecom/outreach/skills/preview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const CONTENT = '---\nname: demo\ntools:\n  voice: [markOutcome]\n---\n## Voice\nPitch: {{pitch}}\n## WhatsApp\nwa text'
const VID = '22222222-2222-4222-8222-222222222222'
const CID = '55555555-5555-4555-8555-555555555555'
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/admin/ecom/outreach/skills/preview', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'administrator', scopes: [] } as any)
  vi.mocked(isPlatformAdmin).mockReturnValue(true)
  m.known.mockResolvedValue({ whatTheyDo: 'Sweets' })
  m.query.mockResolvedValue({ rows: [] })
  m.getContact.mockResolvedValue({
    id: CID, business_name: 'Ravi Stores', owner_name: 'Ravi', category: 'Grocery', city: 'Chennai', status: 'interested', language: 'hi', consent_whatsapp_at: '2026-11-20T00:00:00Z', showcase_site_id: null,
  })
})

describe('/api/admin/ecom/outreach/skills/preview', () => {
  it('401 / 403 gates', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post({ content: CONTENT, channel: 'voice' })).status).toBe(401)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await post({ content: CONTENT, channel: 'voice' })).status).toBe(403)
  })

  it('400 without content or versionId, and on a bad channel', async () => {
    expect((await post({ channel: 'voice' })).status).toBe(400)
    expect((await post({ content: CONTENT, channel: 'sms' })).status).toBe(400)
  })

  it('unparsable content answers 200 with the validation and an empty prompt', async () => {
    const res = await post({ content: '---\nname: x\n', channel: 'voice' })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ systemPrompt: '', greeting: null, tools: [] })
    expect(j.validation.ok).toBe(false)
  })

  it('a sample lead on voice: prompt, greeting and the allowed tools (plus the mandatory ones)', async () => {
    const j = await (await post({ content: CONTENT, channel: 'voice' })).json()
    expect(j.language).toBe('en')
    expect(j.systemPrompt).toContain('This is an outbound call to Sri Lakshmi Sweets (owner: Lakshmi), Sweet shop, Madurai.')
    expect(j.systemPrompt).toContain('Pitch: We make free websites for local businesses. I can build one for Sri Lakshmi Sweets')
    expect(j.systemPrompt).toContain('Script version: demo@preview.')
    expect(j.greeting).toContain('Priya')
    expect(j.greeting).toContain('Sri Lakshmi Sweets')
    expect(j.tools.map((t: { name: string }) => t.name).sort()).toEqual(['handOff', 'markOutcome', 'optOut'])
    expect(j.tools[0]).toHaveProperty('input_schema')
    expect(j.validation.ok).toBe(true)
    expect(m.getContact).not.toHaveBeenCalled()
  })

  it('whatsapp and follow-up have no greeting; the language follows the body', async () => {
    const wa = await (await post({ content: CONTENT, channel: 'whatsapp', language: 'ta' })).json()
    expect(wa.greeting).toBeNull()
    expect(wa.language).toBe('ta')
    expect(wa.systemPrompt).toContain('You are the WhatsApp assistant of Jeffi Stores, chatting with Lakshmi')
    expect(wa.systemPrompt).toContain('wa text')
    const fu = await (await post({ content: CONTENT, channel: 'follow_up' })).json()
    expect(fu.greeting).toBeNull()
    expect(fu.systemPrompt).toContain('You are not in a conversation')
  })

  it('loads a stored version by id; 404 when it is gone', async () => {
    m.getVersion.mockResolvedValueOnce({ id: VID, content: CONTENT })
    expect((await (await post({ versionId: VID, channel: 'voice' })).json()).systemPrompt).toContain('Sri Lakshmi Sweets')
    expect(m.getVersion).toHaveBeenCalledWith(VID)
    m.getVersion.mockResolvedValueOnce(null)
    expect((await post({ versionId: VID, channel: 'voice' })).status).toBe(404)
  })

  it('a real contact: its details, language and known brief; a continuing call after an answered one', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const j = await (await post({ content: CONTENT, channel: 'voice', contactId: CID })).json()
    expect(m.getContact).toHaveBeenCalledWith(CID)
    expect(m.known).toHaveBeenCalledWith(CID)
    expect(j.language).toBe('hi')
    expect(j.systemPrompt).toContain('Ravi Stores (owner: Ravi), Grocery, Chennai')
    expect(j.systemPrompt).toContain('You have spoken with them before')
    expect(j.systemPrompt).toContain('- WhatsApp consent: already given')
    expect(j.systemPrompt).toContain('- What they do: Sweets')
    expect(j.greeting).toContain('फिर से')
    expect(j.greeting).not.toContain('Ravi Stores')
    m.getContact.mockResolvedValueOnce(null)
    expect((await post({ content: CONTENT, channel: 'voice', contactId: CID })).status).toBe(404)
  })
})
