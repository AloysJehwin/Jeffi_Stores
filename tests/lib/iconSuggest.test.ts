import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAiChat } = vi.hoisted(() => ({ mockAiChat: vi.fn() }))

vi.mock('@/lib/ai-client', () => ({ aiChat: mockAiChat }))

import { suggestIcon, ICON_OPTIONS } from '@/lib/iconSuggest'

function makeAiResponse(content: string) {
  return { content, provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false }
}

describe('ICON_OPTIONS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(ICON_OPTIONS)).toBe(true)
    expect(ICON_OPTIONS.length).toBeGreaterThan(0)
    ICON_OPTIONS.forEach(icon => expect(typeof icon).toBe('string'))
  })

  it('contains Package as a fallback icon', () => {
    expect(ICON_OPTIONS).toContain('Package')
  })

  it('contains common hardware icons', () => {
    expect(ICON_OPTIONS).toContain('Wrench')
    expect(ICON_OPTIONS).toContain('Hammer')
    expect(ICON_OPTIONS).toContain('Drill')
  })
})

describe('suggestIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a valid icon from ICON_OPTIONS on success', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse(JSON.stringify({ iconName: 'Wrench' })))
    const result = await suggestIcon('Spanners and Wrenches')
    expect(ICON_OPTIONS).toContain(result)
    expect(result).toBe('Wrench')
  })

  it('returns Package when suggested icon is not in ICON_OPTIONS', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse(JSON.stringify({ iconName: 'InvalidIcon' })))
    const result = await suggestIcon('Unknown Category')
    expect(result).toBe('Package')
  })

  it('returns Package when the gateway call throws', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('API error'))
    const result = await suggestIcon('Some Category')
    expect(result).toBe('Package')
  })

  it('returns Package when the response content is empty', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse(''))
    const result = await suggestIcon('Empty content')
    expect(result).toBe('Package')
  })

  it('returns Package when response content is invalid JSON', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse('not-json'))
    const result = await suggestIcon('Bad JSON')
    expect(result).toBe('Package')
  })

  it('returns Package when iconName field is missing', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse('{}'))
    const result = await suggestIcon('No icon name')
    expect(result).toBe('Package')
  })

  it('tolerates prose around the JSON object', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse('Here you go: {"iconName":"Truck"}'))
    const result = await suggestIcon('Logistics')
    expect(result).toBe('Truck')
  })

  it('calls the gateway in JSON mode with the fast model hint', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse(JSON.stringify({ iconName: 'Box' })))
    await suggestIcon('Boxes')
    expect(mockAiChat).toHaveBeenCalledWith(
      expect.objectContaining({ modelHint: 'fast', jsonMode: true, temperature: 0 })
    )
  })

  it('passes the categoryName as user message', async () => {
    mockAiChat.mockResolvedValueOnce(makeAiResponse(JSON.stringify({ iconName: 'Truck' })))
    await suggestIcon('Logistics')
    const call = mockAiChat.mock.calls[0][0] as any
    const userMsg = call.messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toBe('Logistics')
  })
})
