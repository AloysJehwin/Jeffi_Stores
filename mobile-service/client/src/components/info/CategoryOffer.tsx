import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import {
  Anchor, Anvil, Aperture, Axe, Battery, BatteryCharging, Bolt, Box, Boxes, Brush, Cable, CircuitBoard, Cog, Cpu,
  Disc, Disc2, Drill, Filter, Flame, Flashlight, FlaskConical, Forklift, Gauge, Grip, Hammer, HardHat, Hexagon,
  Layers, Link, Link2, Magnet, Microchip, Nut, Package, Paintbrush, PaintRoller, PencilRuler, Pickaxe, Pipette, Plug,
  PlugZap, Ruler, Satellite, ScanLine, Scissors, Settings, Shield, Shovel, Spade, SprayCan, TestTube, Thermometer,
  ToolCase, Toolbox, Truck, Warehouse, Weight, Wind, Wrench, Zap, type LucideIcon,
} from 'lucide-react-native'
import { CategoryIcon as NamedCategoryIcon } from '../home/CategoryGrid'
import { Glyph, CHEVRON_DOWN } from './Glyph'
import { accent } from '../../theme'
import type { OfferCategory } from '../../api/info'

// Mirror of controller-service components/visitor/CategoryOffer.tsx (grid-cols-1 at the mobile breakpoint).

// The admin category icon picker's options (admin/CategoryForm ICON_OPTIONS).
const ICONS: Record<string, LucideIcon> = {
  Anchor, Anvil, Aperture, Axe, Battery, BatteryCharging, Bolt, Box, Boxes, Brush, Cable, CircuitBoard, Cog, Cpu,
  Disc, Disc2, Drill, Filter, Flame, Flashlight, FlaskConical, Forklift, Gauge, Grip, Hammer, HardHat, Hexagon,
  Layers, Link, Link2, Magnet, Microchip, Nut, Package, Paintbrush, PaintRoller, PencilRuler, Pickaxe, Pipette, Plug,
  PlugZap, Ruler, Satellite, ScanLine, Scissors, Settings, Shield, Shovel, Spade, SprayCan, TestTube, Thermometer,
  ToolCase, Toolbox, Truck, Warehouse, Weight, Wind, Wrench, Zap,
}

/** CategoryIcon: the admin-set icon name, else resolved from the category name. */
function OfferIcon({ iconName, name }: { iconName: string | null; name: string }) {
  const { colorScheme } = useColorScheme()
  const color = colorScheme === 'dark' ? accent[400] : accent[600]
  const Icon = iconName ? ICONS[iconName] : undefined
  return Icon ? <Icon size={24} color={color} /> : <NamedCategoryIcon categoryName={name} size={24} color={color} />
}

function CategoryCard({ cat }: { cat: OfferCategory }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const hasSubs = cat.subcategories.length > 0
  const go = (slug: string | null) => (slug ? router.push(`/category/${slug}`) : router.push('/categories'))

  return (
    <View className="rounded-xl border border-border-default bg-surface">
      <View className="flex-row items-center gap-4 p-4">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-100 dark:bg-accent-900/30">
          <OfferIcon iconName={cat.icon_name} name={cat.name} />
        </View>
        <Pressable onPress={() => go(cat.slug)} className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-foreground">
            {cat.name}
          </Text>
          {hasSubs ? <Text className="text-xs text-foreground-muted">{cat.subcategories.length} subcategories</Text> : null}
        </Pressable>
        {hasSubs ? (
          <Pressable
            accessibilityLabel={open ? `Collapse ${cat.name}` : `Expand ${cat.name}`}
            onPress={() => setOpen(o => !o)}
            className="h-8 w-8 shrink-0 items-center justify-center rounded-lg active:bg-surface-secondary"
          >
            <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
              <Glyph d={CHEVRON_DOWN} size={16} className="text-foreground-muted" />
            </View>
          </Pressable>
        ) : null}
      </View>

      {hasSubs && open ? (
        <View className="border-t border-border-default px-4 pb-4 pt-1">
          <View className="flex-row flex-wrap gap-2 pt-3">
            {cat.subcategories.map(sub => (
              <Pressable
                key={sub.id}
                onPress={() => go(sub.slug)}
                className="flex-row items-center rounded-full border border-border-default px-2.5 py-1 active:border-accent-400 active:bg-surface-secondary"
              >
                <Text className="text-xs text-foreground-secondary">{sub.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default function CategoryOffer({ categories }: { categories: OfferCategory[] }) {
  return (
    <View className="gap-4">
      {categories.map(cat => (
        <CategoryCard key={cat.id} cat={cat} />
      ))}
    </View>
  )
}
