import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'

export const ICON_OPTIONS = [
  'Wrench',
  'Bolt',
  'Drill',
  'Hammer',
  'Nut',
  'Scissors',
  'Anchor',
  'Link',
  'Zap',
  'Cog',
  'Settings',
  'Layers',
  'Box',
  'Package',
  'Shield',
  'Flame',
  'Gauge',
  'Ruler',
  'Pipette',
  'Plug',
  'PlugZap',
  'Cable',
  'CircuitBoard',
  'Cpu',
  'Truck',
  'Filter',
  'Disc',
  'Grip',
  'Axe',
  'Pickaxe',
  'Shovel',
  'Paintbrush',
  'PaintRoller',
  'SprayCan',
  'FlaskConical',
  'Magnet',
  'Battery',
  'Thermometer',
  'Wind',
  'Waves',
  'Satellite',
  'Flashlight',
  'Microchip',
  'Toolbox',
  'ToolCase',
  'Hexagon',
  'Boxes',
  'PencilRuler',
  'ScanLine',
  'Antenna',
  'Aperture',
  'Archive',
  'Factory',
  'Forklift',
  'HardHat',
  'TestTube',
  'Timer',
  'Tractor',
  'Unplug',
  'Warehouse',
  'Weight',
]

export async function suggestIcon(categoryName: string): Promise<string> {
  try {
    const response = await aiChat({
      modelHint: 'fast',
      jsonMode: true,
      temperature: 0,
      maxTokens: 30,
      messages: [
        {
          role: 'system',
          content: `You are an icon selector for an online store. Given a product category name, pick the single most appropriate icon from this exact list: ${ICON_OPTIONS.join(', ')}. You MUST respond with valid JSON in this exact format: {"iconName":"<chosen icon>"}. No other text.`,
        },
        {
          role: 'user',
          content: categoryName,
        },
      ],
    })

    const suggested = parseAiJson<{ iconName?: string }>(response.content)?.iconName?.trim() ?? ''
    return ICON_OPTIONS.includes(suggested) ? suggested : 'Package'
  } catch (err) {
    console.error('[route]', err)
    return 'Package'
  }
}
