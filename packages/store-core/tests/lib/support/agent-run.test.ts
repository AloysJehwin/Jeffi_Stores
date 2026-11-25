import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  aiChat: vi.fn(),
  aiAllowed: vi.fn(),
  postMessage: vi.fn(async (input: any) => ({ id: 'm-out', ...input })),
  handOff: vi.fn(async () => null),
  botPayload: vi.fn(() => ({ type: 'text', text: 'menu reply' })),
  session: { id: 's-1', status: 'open', handler: 'ai', user_id: null, channel: 'web', customer_lang: null, contact_name: null },
}))

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(async () => null) }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: h.aiChat }))
vi.mock('@/lib/shared/redis', () => ({
  getRedisClient: () => ({ set: async () => 'OK', get: async () => null, del: async () => 1 }),
}))
vi.mock('@/lib/shared/storefront-ai', () => ({ storefrontAiAllowed: h.aiAllowed }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: async () => 'Halo' }))
vi.mock('@/lib/shared/support-bot', () => ({ fetchUserOrders: async () => [], getBotPayload: h.botPayload }))
vi.mock('@/lib/support/sessions', () => ({ getSessionRow: async () => h.session }))
vi.mock('@/lib/support/messages', () => ({
  listMessages: async () => [
    { message: { id: 'c1', sender: 'customer', text: 'Where is my order?', attachments: [], payloads: [] }, translations: {} },
  ],
  postMessage: h.postMessage,
}))
vi.mock('@/lib/support/events', () => ({ publishSupportEvent: async () => {} }))
vi.mock('@/lib/support/handoff', () => ({ handOffToHuman: h.handOff }))
vi.mock('@/lib/support/translate', () => ({ detectLang: () => 'en' }))
vi.mock('@/lib/support/agent/tools', () => ({ SUPPORT_TOOLS: [], runSupportTool: vi.fn() }))
vi.mock('@/lib/support/agent/actions', () => ({ attachActionsToMessage: vi.fn(), confirmCard: vi.fn(), createAction: vi.fn() }))

import { runSupportTurn, ASSISTANT_UNAVAILABLE_TEXT } from '@/lib/support/agent/run'

beforeEach(() => {
  vi.clearAllMocks()
  h.aiAllowed.mockResolvedValue(true)
})

describe('support assistant turn', () => {
  it('posts the model answer as the assistant', async () => {
    h.aiChat.mockResolvedValue({ content: 'It ships tomorrow.', provider: 'anthropic', model: 'm' })
    await runSupportTurn('s-1')
    expect(h.aiChat.mock.calls[0][0]).toMatchObject({ feature: 'support_agent', modelHint: 'agent' })
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ sender: 'ai', text: 'It ships tomorrow.' }))
    expect(h.botPayload).not.toHaveBeenCalled()
    expect(h.handOff).not.toHaveBeenCalled()
  })

  it('when no model can answer: says so and hands over to a person, never the keyword bot', async () => {
    h.aiChat.mockRejectedValue(new Error('AI gateway HTTP 503: all text providers failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await runSupportTurn('s-1')
    expect(h.botPayload).not.toHaveBeenCalled()
    expect(h.postMessage).toHaveBeenCalledTimes(1)
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ sender: 'system', text: ASSISTANT_UNAVAILABLE_TEXT }))
    expect(h.handOff).toHaveBeenCalledWith('s-1', 'Assistant unavailable', expect.stringContaining('Where is my order?'))
  })

  it("a plan without AI keeps the store's menu bot (no model involved)", async () => {
    h.aiAllowed.mockResolvedValue(false)
    await runSupportTurn('s-1')
    expect(h.aiChat).not.toHaveBeenCalled()
    expect(h.botPayload).toHaveBeenCalled()
    expect(h.postMessage).toHaveBeenCalledWith(expect.objectContaining({ sender: 'bot', text: 'menu reply' }))
  })
})
