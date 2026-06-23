import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock openai before any imports
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(function (this: any) {
    this.chat = {
      completions: {
        create: mockCreate,
      },
    }
  })
  return { default: MockOpenAI }
})

import { suggestIcon, ICON_OPTIONS, __resetClientForTests } from '@/lib/iconSuggest'

function makeOpenAIResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  }
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
    __resetClientForTests()
  })

  it('returns a valid icon from ICON_OPTIONS on success', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify({ iconName: 'Wrench' })))
    const result = await suggestIcon('Spanners and Wrenches')
    expect(ICON_OPTIONS).toContain(result)
    expect(result).toBe('Wrench')
  })

  it('returns Package when suggested icon is not in ICON_OPTIONS', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify({ iconName: 'InvalidIcon' })))
    const result = await suggestIcon('Unknown Category')
    expect(result).toBe('Package')
  })

  it('returns Package when OpenAI throws an error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'))
    const result = await suggestIcon('Some Category')
    expect(result).toBe('Package')
  })

  it('returns Package when response has no choices', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] })
    const result = await suggestIcon('Empty choices')
    expect(result).toBe('Package')
  })

  it('returns Package when response content is invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse('not-json'))
    const result = await suggestIcon('Bad JSON')
    expect(result).toBe('Package')
  })

  it('returns Package when iconName field is missing', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse('{}'))
    const result = await suggestIcon('No icon name')
    expect(result).toBe('Package')
  })

  it('calls OpenAI with gpt-4o-mini model', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify({ iconName: 'Box' })))
    await suggestIcon('Boxes')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' })
    )
  })

  it('passes the categoryName as user message', async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify({ iconName: 'Truck' })))
    await suggestIcon('Logistics')
    const call = mockCreate.mock.calls[0][0] as any
    const userMsg = call.messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toBe('Logistics')
  })
})
