import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ aiChat: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: h.aiChat }))

import { gatewayModel, getAgentModel, setAgentModel } from '@controller/lib/outreach/agent/model'
import type { AgentModelRequest } from '@controller/lib/outreach/agent/types'

const req = (o: Partial<AgentModelRequest> = {}): AgentModelRequest => ({
  system: 'You are the agent.',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [{ name: 'addDetails', description: 'Save details', input_schema: { type: 'object', properties: {} } }],
  channel: 'whatsapp',
  contactId: 'k1',
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  setAgentModel(null)
})

describe('gatewayModel', () => {
  it('calls the AI gateway as the outreach agent, unmetered by tenants and never cached', async () => {
    h.aiChat.mockResolvedValue({ content: 'Hi!', usage: { costInr: 0.0412 } })
    const r = await gatewayModel(req())
    expect(h.aiChat).toHaveBeenCalledWith({
      feature: 'outreach_agent',
      modelHint: 'agent',
      cacheNamespace: 'platform',
      noCache: true,
      temperature: 0.3,
      maxTokens: 600,
      messages: [
        { role: 'system', content: 'You are the agent.' },
        { role: 'user', content: 'hello' },
      ],
      tools: [{ type: 'function', function: { name: 'addDetails', description: 'Save details', parameters: { type: 'object', properties: {} } } }],
    })
    expect(r).toEqual({ content: 'Hi!', toolCalls: [], providerState: undefined, costPaise: 4 })
  })

  it('maps tool calls (ids filled in), provider state and the cost in paise back', async () => {
    const providerState = { provider: 'anthropic', content: [{ type: 'tool_use' }] }
    h.aiChat.mockResolvedValue({ content: '', toolCalls: [{ id: 't9', name: 'addDetails', arguments: { hours: '9' } }, { name: 'optOut', arguments: undefined }], providerState, usage: { costInr: 1.5 } })
    const r = await gatewayModel(req())
    expect(r.toolCalls).toEqual([
      { id: 't9', name: 'addDetails', arguments: { hours: '9' } },
      { id: 'call_1', name: 'optOut', arguments: {} },
    ])
    expect(r.providerState).toBe(providerState)
    expect(r.costPaise).toBe(150)
  })

  it('costs nothing when the gateway reports no usage', async () => {
    h.aiChat.mockResolvedValue({ content: 'ok' })
    expect((await gatewayModel(req())).costPaise).toBe(0)
  })

  it('replays an assistant tool turn and its result, with the provider state echoed', async () => {
    h.aiChat.mockResolvedValue({ content: 'done' })
    const providerState = { provider: 'anthropic', content: [] }
    await gatewayModel(
      req({
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'addDetails', arguments: { hours: '9' } }], providerState },
          { role: 'tool', content: '{"ok":true}', tool_call_id: 't1' },
        ],
      })
    )
    const sent = h.aiChat.mock.calls[0][0].messages
    expect(sent[2]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'addDetails', arguments: { hours: '9' } } }], providerState })
    expect(sent[3]).toEqual({ role: 'tool', content: '{"ok":true}', tool_call_id: 't1' })
  })

  it('offers no tools on the last turn', async () => {
    h.aiChat.mockResolvedValue({ content: 'bye' })
    await gatewayModel(req({ tools: [] }))
    expect(h.aiChat.mock.calls[0][0].tools).toBeUndefined()
  })
})

describe('setAgentModel / getAgentModel', () => {
  it('returns the gateway model unless a scripted one is injected', () => {
    expect(getAgentModel()).toBe(gatewayModel)
    const scripted = vi.fn()
    setAgentModel(scripted)
    expect(getAgentModel()).toBe(scripted)
    setAgentModel(null)
    expect(getAgentModel()).toBe(gatewayModel)
  })
})
