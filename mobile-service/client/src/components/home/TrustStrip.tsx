import { View } from 'react-native'
import { Text } from '../../ui'
import {
  Award, BadgeCheck, Banknote, Boxes, Clock, CreditCard, Factory, FileText, Globe, Headphones, Heart, Lock,
  MapPin, MessageCircle, Package, PackageCheck, Percent, Phone, Receipt, Rocket, RotateCcw, ShieldCheck, Star,
  Tag, ThumbsUp, TrendingDown, Truck, Users, Wallet, Warehouse, Wrench, Zap, type LucideIcon,
} from 'lucide-react-native'
import { accent } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/TrustStrip.tsx at the mobile breakpoint.

// The admin icon picker's options (editors/icon-options.ts); IconByName falls back to Package.
const ICONS: Record<string, LucideIcon> = {
  Award, BadgeCheck, Banknote, Boxes, Clock, CreditCard, Factory, FileText, Globe, Headphones, Heart, Lock,
  MapPin, MessageCircle, Package, PackageCheck, Percent, Phone, Receipt, Rocket, RotateCcw, ShieldCheck, Star,
  Tag, ThumbsUp, TrendingDown, Truck, Users, Wallet, Warehouse, Wrench, Zap,
}

const DEFAULT_TILES = [
  { icon: 'Truck', label: 'Free delivery above {amount}' },
  { icon: 'Receipt', label: 'GST invoice on every order' },
  { icon: 'Boxes', label: '10,000+ products in stock' },
  { icon: 'CreditCard', label: 'Cash on delivery available' },
]

export default function TrustStrip({ section, data }: SectionProps) {
  const amount = `₹${Number(data.freeShippingThreshold).toLocaleString('en-IN')}`
  const tiles = (section.items && section.items.length > 0 ? section.items : DEFAULT_TILES).map(item => ({
    icon: item.icon,
    label: (item.label ?? '').replace(/\{amount\}/g, amount),
  }))

  return (
    <View className="border-b border-border-default bg-surface-elevated px-4">
      <View className="flex-row flex-wrap">
        {tiles.map((item, i) => {
          const Icon = ICONS[item.icon] ?? Package
          return (
            // divide-y: every tile after the first gets a top border
            <View
              key={i}
              className={`flex-row items-center gap-2 px-3 py-3 ${i > 0 ? 'border-t border-border-default' : ''}`}
              style={{ width: '50%' }}
            >
              <Icon size={20} color={accent[500]} />
              <Text className="shrink text-xs font-semibold leading-tight text-foreground-secondary">{item.label}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
