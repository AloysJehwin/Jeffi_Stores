import OpenAI from 'openai'

const ICON_OPTIONS = [
  'Wrench', 'Bolt', 'Drill', 'Hammer', 'Nut', 'Scissors', 'Anchor', 'Link',
  'Zap', 'Cog', 'Settings', 'Layers', 'Box', 'Package', 'Shield', 'Flame',
  'Gauge', 'Ruler', 'Pipette', 'Plug', 'PlugZap', 'Cable', 'CircuitBoard',
  'Cpu', 'Truck', 'Filter', 'Disc', 'Grip', 'Axe', 'Pickaxe', 'Shovel',
  'Paintbrush', 'PaintRoller', 'SprayCan', 'FlaskConical', 'Magnet',
  'Battery', 'Thermometer', 'Wind', 'Waves', 'Satellite', 'Flashlight',
  'Microchip', 'Toolbox', 'ToolCase', 'Hexagon', 'Boxes', 'PencilRuler',
  'ScanLine', 'Antenna', 'Aperture', 'Archive', 'Cylinder', 'Factory',
  'Forklift', 'HardHat', 'InspectionPanel', 'Milestone', 'Mountain',
  'Radar', 'RadioTower', 'Server', 'Sparkles', 'TestTube', 'Timer',
  'TowerControl', 'Tractor', 'Unplug', 'Warehouse', 'Weight',
]

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
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
          content: `You are an icon selector for an industrial hardware store.
Given a product category name, pick the single most appropriate icon from this list: ${ICON_OPTIONS.join(', ')}.
Respond with ONLY the icon name — no explanation, no punctuation, just the name.`,
        },
        {
          role: 'user',
          content: categoryName,
        },
      ],
      max_tokens: 20,
      temperature: 0,
    })

    const suggested = response.choices[0]?.message?.content?.trim() ?? ''
    return ICON_OPTIONS.includes(suggested) ? suggested : 'Package'
  } catch {
    return 'Package'
  }
}
