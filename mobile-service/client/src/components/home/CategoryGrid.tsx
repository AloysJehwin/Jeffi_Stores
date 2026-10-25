import { View } from 'react-native'
import { Card, Text } from '../../ui'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import {
  Anchor, Aperture, Bolt, Boxes, Cable, Cog, Cpu, Disc, Drill, Factory, Filter, Flame, FlaskConical, Gauge, Grip,
  Hammer, Hexagon, Link, Link2, Magnet, Nut, Package, PaintRoller, Paintbrush, PlugZap, Ruler, ScanLine, Scissors,
  Shield, Toolbox, Truck, Waves, Wrench, Zap, type LucideIcon,
} from 'lucide-react-native'
import { Carousel, Grid, SectionHeading } from './layout'
import { primary } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CategoryGrid.tsx (+ CategoryIcon's name resolution).

const ICONS: Record<string, LucideIcon> = {
  Anchor, Aperture, Bolt, Boxes, Cable, Cog, Cpu, Disc, Drill, Factory, Filter, Flame, FlaskConical, Gauge, Grip,
  Hammer, Hexagon, Link, Link2, Magnet, Nut, Package, PaintRoller, Paintbrush, PlugZap, Ruler, ScanLine, Scissors,
  Shield, Toolbox, Truck, Waves, Wrench, Zap,
}

const NAME_MAP: Record<string, string> = {
  bolt: 'Bolt',
  bolts: 'Bolt',
  screw: 'Cog',
  screws: 'Cog',
  screwdriver: 'Wrench',
  nut: 'Nut',
  nuts: 'Nut',
  washer: 'Disc',
  washers: 'Disc',
  drill: 'Drill',
  hammer: 'Hammer',
  hammers: 'Hammer',
  wrench: 'Wrench',
  wrenches: 'Wrench',
  torque: 'Wrench',
  adjustable: 'Wrench',
  plier: 'Grip',
  pliers: 'Grip',
  socket: 'Hexagon',
  sockets: 'Hexagon',
  hand: 'Toolbox',
  measuring: 'Ruler',
  measure: 'Ruler',
  gauge: 'Gauge',
  meter: 'Gauge',
  cutting: 'Scissors',
  blade: 'Scissors',
  saw: 'Scissors',
  cutter: 'Scissors',
  abrasive: 'ScanLine',
  abrasives: 'ScanLine',
  grinding: 'ScanLine',
  sandpaper: 'ScanLine',
  welding: 'Flame',
  weld: 'Flame',
  aluminum: 'Flame',
  belt: 'Link',
  belts: 'Link',
  chain: 'Link2',
  chains: 'Link2',
  coupling: 'Boxes',
  couplings: 'Boxes',
  threaded: 'Anchor',
  rod: 'Anchor',
  rods: 'Anchor',
  anchor: 'Anchor',
  anchors: 'Anchor',
  hose: 'Waves',
  clamp: 'Waves',
  clamps: 'Waves',
  clip: 'Waves',
  crimping: 'Zap',
  terminal: 'Zap',
  terminals: 'Zap',
  cable: 'Cable',
  wire: 'Cable',
  electrical: 'PlugZap',
  electric: 'PlugZap',
  bearing: 'Aperture',
  bearings: 'Aperture',
  pulley: 'Disc',
  wheel: 'Disc',
  wheels: 'Disc',
  transmission: 'Cog',
  drive: 'Cog',
  fastener: 'Bolt',
  fasteners: 'Bolt',
  safety: 'Shield',
  protective: 'Shield',
  protection: 'Shield',
  lubricant: 'FlaskConical',
  lubricants: 'FlaskConical',
  chemical: 'FlaskConical',
  chemicals: 'FlaskConical',
  oil: 'FlaskConical',
  grease: 'FlaskConical',
  handling: 'Truck',
  lifting: 'Truck',
  trolley: 'Truck',
  pipe: 'Filter',
  pipes: 'Filter',
  plumbing: 'Filter',
  valve: 'Filter',
  valves: 'Filter',
  fitting: 'Filter',
  fittings: 'Filter',
  motor: 'Cpu',
  motors: 'Cpu',
  engine: 'Cpu',
  pneumatic: 'Cpu',
  hydraulic: 'Cpu',
  cylinder: 'Cpu',
  paint: 'Paintbrush',
  coating: 'PaintRoller',
  brush: 'Paintbrush',
  spring: 'Magnet',
  springs: 'Magnet',
  coil: 'Magnet',
  tool: 'Wrench',
  tools: 'Wrench',
  equipment: 'Toolbox',
  industrial: 'Factory',
  component: 'Boxes',
  components: 'Boxes',
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

export function CategoryIcon({ categoryName = '', size = 24, color }: { categoryName?: string; size?: number; color: string }) {
  const Icon = ICONS[resolveByName(categoryName)] ?? Package
  return <Icon size={size} color={color} />
}

export default function CategoryGrid({ section, data }: SectionProps) {
  const router = useRouter()
  const dark = useColorScheme().colorScheme === 'dark'
  const categories = data.mainCategories
  if (categories.length === 0) return null

  const items = categories.map(category => (
    <Card key={category.id} onPress={() => router.push(`/category/${category.slug}`)} accessibilityLabel={category.name} padded={false} className="items-center gap-2.5 p-3">
      <View className="h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/25">
        <CategoryIcon categoryName={category.name} color={dark ? primary[400] : primary[600]} />
      </View>
      <View className="min-h-[36px] min-w-0 items-center justify-center px-0.5">
        <Text numberOfLines={2} className="text-center text-xs font-bold text-foreground" style={{ lineHeight: 15 }}>
          {category.name}
        </Text>
      </View>
    </Card>
  ))

  // "View All" is hidden below sm on the web.
  return (
    <View className="bg-surface px-4 pb-12 pt-8">
      <SectionHeading eyebrow={section.copy.eyebrow} title={section.copy.title} eyebrowClassName="text-primary-500" />
      {section.layout === 'carousel' ? <Carousel>{items}</Carousel> : <Grid cols={2} gap={10}>{items}</Grid>}
    </View>
  )
}
