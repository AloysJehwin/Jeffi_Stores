import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Caption, Chip, ChipGroup, IconButton, Text } from '../../ui'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import {
  Anchor, Anvil, Aperture, Axe, Battery, BatteryCharging, Bolt, Box, Boxes, Brush, Cable, CircuitBoard, Cog, Cpu,
  Disc, Disc2, Drill, Filter, Flame, Flashlight, FlaskConical, Forklift, Gauge, Grip, Hammer, HardHat, Hexagon,
  Layers, Link, Link2, Magnet, Microchip, Nut, Package, Paintbrush, PaintRoller, PencilRuler, Pickaxe, Pipette, Plug,
  PlugZap, Ruler, Satellite, ScanLine, Scissors, Settings, Shield, Shovel, Spade, SprayCan, TestTube, Thermometer,
  ToolCase, Toolbox, Truck, Warehouse, Weight, Wind, Wrench, Zap, ChevronDown, ChevronUp, type LucideIcon,
} from 'lucide-react-native'
import { CategoryIcon as NamedCategoryIcon } from '../home/CategoryGrid'
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
    <View className="rounded-field border border-border-default bg-surface">
      <View className="flex-row items-center gap-4 p-4">
        <View className="h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-100 dark:bg-accent-900/30">
          <OfferIcon iconName={cat.icon_name} name={cat.name} />
        </View>
        <Pressable accessibilityRole="button" onPress={() => go(cat.slug)} className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-foreground">
            {cat.name}
          </Text>
          {hasSubs ? <Caption>{cat.subcategories.length} subcategories</Caption> : null}
        </Pressable>
        {hasSubs ? (
          <IconButton
            icon={open ? ChevronUp : ChevronDown}
            label={open ? `Collapse ${cat.name}` : `Expand ${cat.name}`}
            size="sm"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(o => !o)}
          />
        ) : null}
      </View>

      {hasSubs && open ? (
        <View className="border-t border-border-default px-4 pb-4 pt-1">
          <ChipGroup className="pt-3">
            {cat.subcategories.map(sub => (
              <Chip key={sub.id} size="sm" label={sub.name} onPress={() => go(sub.slug)} />
            ))}
          </ChipGroup>
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
