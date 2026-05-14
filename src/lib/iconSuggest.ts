import OpenAI from 'openai'

export const ICON_OPTIONS = [
  'Wrench', 'Bolt', 'Drill', 'Hammer', 'Nut', 'Scissors', 'Anchor', 'Link',
  'Zap', 'Cog', 'Settings', 'Layers', 'Box', 'Package', 'Shield', 'Flame',
  'Gauge', 'Ruler', 'Pipette', 'Plug', 'PlugZap', 'Cable', 'CircuitBoard',
  'Cpu', 'Truck', 'Filter', 'Disc', 'Grip', 'Axe', 'Pickaxe', 'Shovel',
  'Paintbrush', 'PaintRoller', 'SprayCan', 'FlaskConical', 'Magnet',
  'Battery', 'Thermometer', 'Wind', 'Waves', 'Satellite', 'Flashlight',
  'Microchip', 'Toolbox', 'ToolCase', 'Hexagon', 'Boxes', 'PencilRuler',
  'ScanLine', 'Antenna', 'Aperture', 'Archive', 'Factory',
  'Forklift', 'HardHat', 'TestTube', 'Timer',
  'Tractor', 'Unplug', 'Warehouse', 'Weight',
]

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

export async function suggestIcon(categoryName: string): Promise<string> {
  try {
    const openai = getClient()

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an icon selector for an industrial hardware store. Given a product category name, pick the single most appropriate icon from this exact list: ${ICON_OPTIONS.join(', ')}. You MUST respond with valid JSON in this exact format: {"iconName":"<chosen icon>"}. No other text.`,
        },
        {
          role: 'user',
          content: categoryName,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 30,
      temperature: 0,
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw) as { iconName?: string }
    const suggested = parsed.iconName?.trim() ?? ''
    return ICON_OPTIONS.includes(suggested) ? suggested : 'Package'
  } catch {
    return 'Package'
  }
}
