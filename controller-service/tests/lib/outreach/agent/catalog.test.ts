import { describe, it, expect, vi } from 'vitest'

// The handlers pull in the build and WhatsApp services; the catalog itself needs none of them.
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: vi.fn() }) }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {} }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ sendOutreachTemplate: vi.fn(), sendOutreachText: vi.fn(), windowOpen: vi.fn() }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: vi.fn(), readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/claim', () => ({ createClaimToken: vi.fn() }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: vi.fn() }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: vi.fn() }))

import { MANDATORY_TOOLS, TOOLS, TOOL_NAMES, allowedTools, catalogSummary, getTool, llmSchemas } from '@controller/lib/outreach/agent/catalog'
import { TOOL_MANIFEST } from '@controller/lib/outreach/agent/tool-manifest'
import * as prompt from '@controller/lib/outreach/prompt'
import type { AgentChannel } from '@controller/lib/outreach/agent/types'

const ALL: AgentChannel[] = ['voice', 'whatsapp', 'follow_up']
const V: AgentChannel[] = ['voice']
const VW: AgentChannel[] = ['voice', 'whatsapp']
const VWF = ALL
const WF: AgentChannel[] = ['whatsapp', 'follow_up']
// The contracts table: name -> channels, in catalog order.
const TABLE: [string, AgentChannel[]][] = [
  ['getLead', ALL], ['updateLead', ALL], ['recordConsent', VW], ['optOut', ALL], ['markOutcome', ALL], ['logOutcome', ALL], ['handOff', ALL],
  ['getSiteStatus', ALL], ['startPreview', VWF], ['addDetails', VW], ['requestChange', VW], ['publishSite', VW], ['sendLink', ALL],
  ['sendWhatsAppTemplate', ALL], ['sendWhatsAppText', WF], ['readMessages', ALL], ['placeCall', WF], ['scheduleCallback', VWF],
  ['scheduleFollowUp', ALL], ['endCall', V], ['switchLanguage', V],
  // task-agent tools: jobs (core) and the flagship store
  ['getJob', ALL], ['setOutcome', ALL], ['getOrder', ALL], ['findOrders', ALL], ['trackShipment', ALL],
  ['confirmCodOrder', ALL], ['sendReviewLink', ALL], ['recordRating', ALL], ['getReviewStatus', ALL], ['getAbandonedCheckout', ALL],
  ['sendCheckoutLink', ALL], ['sendPaymentLink', ALL], ['checkDelivery', ALL], ['searchProducts', ALL], ['getProduct', ALL],
  ['sendProductLink', ALL], ['getStoreInfo', ALL], ['createSupportTicket', ALL], ['createStaffTask', ALL], ['sendSms', ALL],
]

describe('catalog', () => {
  it('has every tool of the contract, in order, on the right channels', () => {
    expect(TOOL_NAMES).toEqual(TABLE.map(t => t[0]))
    for (const [name, channels] of TABLE) expect([...getTool(name)!.channels], name).toEqual(channels)
  })

  it('the dependency-free manifest validation uses equals the catalog, in order', () => {
    expect(Object.keys(TOOL_MANIFEST)).toEqual(TOOL_NAMES)
    for (const name of TOOL_NAMES) {
      const t = getTool(name)!
      expect(TOOL_MANIFEST[name], name).toEqual({ channels: [...t.channels], effect: t.effect, mandatory: !!t.mandatory, group: t.group ?? 'showcase' })
    }
  })

  it('optOut and handOff are the mandatory tools', () => {
    expect(MANDATORY_TOOLS).toEqual(['optOut', 'handOff'])
  })

  it('getTool is null for unknown names, including Object.prototype keys', () => {
    expect(getTool('nope')).toBeNull()
    expect(getTool('toString')).toBeNull()
    expect(getTool('constructor')).toBeNull()
  })

  it('every tool has a description, an object schema and a name that matches its key', () => {
    for (const [key, t] of Object.entries(TOOLS)) {
      expect(t.name).toBe(key)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe('object')
    }
  })

  it('every JSON Schema property is accepted by the zod args (and required ones are required)', () => {
    for (const t of Object.values(TOOLS)) {
      const props = Object.keys((t.inputSchema.properties as Record<string, unknown>) ?? {})
      const required = (t.inputSchema.required as string[] | undefined) ?? []
      const shape = (t.args as any).shape ?? (t.args as any)._def?.schema?.shape
      for (const p of props) expect(Object.keys(shape), `${t.name}.${p}`).toContain(p)
      for (const r of required) expect(t.args.safeParse({}).success, `${t.name} requires ${r}`).toBe(false)
    }
  })

  it('the 9 legacy voice tools keep prompt.ts schemas word for word', () => {
    const legacy = (prompt as { TOOL_SCHEMAS?: { name: string; description: string; input_schema: unknown }[] }).TOOL_SCHEMAS
    if (!legacy) return
    expect(legacy).toHaveLength(9)
    for (const l of legacy) {
      const t = getTool(l.name)!
      expect(t.description, l.name).toBe(l.description)
      expect(t.inputSchema, l.name).toEqual(l.input_schema)
    }
  })

  it('keeps the legacy wording of the voice tools', () => {
    expect(getTool('optOut')!.description).toBe('They asked not to be called or contacted again. Call immediately; the call ends.')
    expect(getTool('publishSite')!.description).toBe('Make their website live. Only after they say yes to making it live.')
    expect(getTool('markOutcome')!.inputSchema).toEqual({
      type: 'object',
      properties: { outcome: { type: 'string', enum: ['not_interested', 'wrong_number', 'other'] }, note: { type: 'string', description: 'a short reason', maxLength: 300 } },
      required: ['outcome'],
    })
    expect((getTool('switchLanguage')!.inputSchema.properties as any).language.enum).toHaveLength(9)
  })

  it('allowedTools intersects the allow-list with the channel and adds the mandatory tools', () => {
    const names = (c: AgentChannel, allow: string[]) => allowedTools(c, allow).map(t => t.name)
    expect(names('voice', ['startPreview', 'sendWhatsAppText', 'endCall', 'nope'])).toEqual(['optOut', 'handOff', 'startPreview', 'endCall'])
    expect(names('whatsapp', ['sendWhatsAppText', 'endCall', 'placeCall'])).toEqual(['optOut', 'handOff', 'sendWhatsAppText', 'placeCall'])
    expect(names('follow_up', [])).toEqual(['optOut', 'handOff'])
  })

  it('llmSchemas and catalogSummary expose the schemas', () => {
    const defs = allowedTools('voice', ['markOutcome'])
    expect(llmSchemas(defs).map(s => s.name)).toEqual(['optOut', 'markOutcome', 'handOff'])
    expect(llmSchemas(defs)[0]).toEqual({ name: 'optOut', description: TOOLS.optOut.description, input_schema: TOOLS.optOut.inputSchema })
    const sum = catalogSummary()
    expect(sum.map(s => s.name)).toEqual(TOOL_NAMES)
    expect(sum.find(s => s.name === 'handOff')).toMatchObject({ mandatory: true, effect: 'write', channels: ALL })
    expect(sum.find(s => s.name === 'sendLink')).toMatchObject({ mandatory: false, effect: 'send' })
  })
})
