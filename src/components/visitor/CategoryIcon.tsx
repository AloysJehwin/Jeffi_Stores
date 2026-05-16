'use client'

import * as Icons from 'lucide-react'

interface CategoryIconProps {
  iconName?: string | null
  categoryName?: string
  className?: string
}

const NAME_MAP: Record<string, string> = {
  bolt: 'Bolt', bolts: 'Bolt',
  screw: 'Cog', screws: 'Cog', screwdriver: 'Wrench',
  nut: 'Nut', nuts: 'Nut',
  washer: 'Disc', washers: 'Disc',
  drill: 'Drill',
  hammer: 'Hammer', hammers: 'Hammer',
  wrench: 'Wrench', wrenches: 'Wrench', torque: 'Wrench', adjustable: 'Wrench',
  plier: 'Grip', pliers: 'Grip',
  socket: 'Hexagon', sockets: 'Hexagon',
  hand: 'Toolbox',
  measuring: 'Ruler', measure: 'Ruler', gauge: 'Gauge', meter: 'Gauge',
  cutting: 'Scissors', blade: 'Scissors', saw: 'Scissors', cutter: 'Scissors',
  abrasive: 'ScanLine', abrasives: 'ScanLine', grinding: 'ScanLine', sandpaper: 'ScanLine',
  welding: 'Flame', weld: 'Flame', aluminum: 'Flame',
  belt: 'Link', belts: 'Link',
  chain: 'Link2', chains: 'Link2',
  coupling: 'Boxes', couplings: 'Boxes',
  threaded: 'Anchor', rod: 'Anchor', rods: 'Anchor', anchor: 'Anchor', anchors: 'Anchor',
  hose: 'Waves', clamp: 'Waves', clamps: 'Waves', clip: 'Waves',
  crimping: 'Zap', terminal: 'Zap', terminals: 'Zap', cable: 'Cable', wire: 'Cable', electrical: 'PlugZap', electric: 'PlugZap',
  bearing: 'Aperture', bearings: 'Aperture',
  pulley: 'Disc', wheel: 'Disc', wheels: 'Disc',
  transmission: 'Cog', drive: 'Cog',
  fastener: 'Bolt', fasteners: 'Bolt',
  safety: 'Shield', protective: 'Shield', protection: 'Shield',
  lubricant: 'FlaskConical', lubricants: 'FlaskConical', chemical: 'FlaskConical', chemicals: 'FlaskConical', oil: 'FlaskConical', grease: 'FlaskConical',
  handling: 'Truck', lifting: 'Truck', trolley: 'Truck',
  pipe: 'Filter', pipes: 'Filter', plumbing: 'Filter', valve: 'Filter', valves: 'Filter', fitting: 'Filter', fittings: 'Filter',
  motor: 'Cpu', motors: 'Cpu', engine: 'Cpu', pneumatic: 'Cpu', hydraulic: 'Cpu', cylinder: 'Cpu',
  paint: 'Paintbrush', coating: 'PaintRoller', brush: 'Paintbrush',
  spring: 'Magnet', springs: 'Magnet', coil: 'Magnet',
  tool: 'Wrench', tools: 'Wrench', equipment: 'Toolbox',
  industrial: 'Factory', component: 'Boxes', components: 'Boxes',
}

function resolveByName(name: string): string {
  const lower = name.toLowerCase()
  const words = lower.split(/[\s\-_&]+/)
  for (const word of words) {
    if (NAME_MAP[word]) return NAME_MAP[word]
  }
  for (const [key, val] of Object.entries(NAME_MAP)) {
    if (lower.includes(key)) return val
  }
  return 'Package'
}

export default function CategoryIcon({ iconName, categoryName = '', className = 'w-8 h-8' }: CategoryIconProps) {
  const name = iconName || resolveByName(categoryName)
  const Icon = (Icons as any)[name] as React.FC<{ className?: string }> | undefined
  if (!Icon) {
    const Fallback = (Icons as any)['Package'] as React.FC<{ className?: string }>
    return <Fallback className={className} />
  }
  return <Icon className={className} />
}
