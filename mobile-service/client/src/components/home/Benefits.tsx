import type { ComponentType } from 'react'
import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'
import {
  Award, BadgeCheck, Banknote, Boxes, Clock, CreditCard, Factory, FileText, Globe, Headphones, Heart, Lock, MapPin,
  MessageCircle, Package, PackageCheck, Percent, Phone, Receipt, Rocket, RotateCcw, ShieldCheck, Star, Tag, ThumbsUp,
  TrendingDown, Truck, Users, Wallet, Warehouse, Wrench, Zap, type LucideProps,
} from 'lucide-react-native'
import { accent } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/Benefits.tsx.

// The web's IconByName resolves any lucide name; the admin picker (icon-options.ts) offers these.
const ICONS: Record<string, ComponentType<LucideProps>> = {
  Truck, Package, Boxes, PackageCheck, ShieldCheck, BadgeCheck, Award, Star, ThumbsUp, Heart, Clock, Zap, Rocket,
  Headphones, MessageCircle, Phone, Users, Receipt, FileText, Wallet, CreditCard, Banknote, TrendingDown, Percent, Tag,
  RotateCcw, Wrench, Factory, Warehouse, MapPin, Globe, Lock,
}

/** IconByName: unknown names fall back to Package, like the web. */
export function IconByName({ name, size, color }: { name?: string | null; size: number; color: string }) {
  const Icon = (name && ICONS[name]) || Package
  return <Icon size={size} color={color} />
}

interface BenefitItem {
  icon: string
  title: string
  sub: string
}

const DEFAULT_ITEMS: BenefitItem[] = [
  { icon: 'Receipt', title: 'Save up to 18% with GST', sub: 'Claim input tax credit on every purchase with a valid GSTIN invoice' },
  { icon: 'CreditCard', title: 'Bulk order discounts', sub: 'Special pricing for businesses ordering in volume — contact us for a quote' },
  { icon: 'Clock', title: 'Dedicated account manager', sub: 'Registered businesses get priority support and a personal account manager' },
]

export default function Benefits({ section }: SectionProps) {
  const { title, eyebrow } = section.copy
  const items = section.items as BenefitItem[] | null
  const tiles = items && items.length > 0 ? items : DEFAULT_ITEMS

  return (
    <View className="border-y border-border-default bg-surface px-4 py-8">
      {title || eyebrow ? (
        <View className="mb-6 items-center">
          {eyebrow ? (
            <Overline className="mb-2 text-center text-accent-500" style={{ letterSpacing: 2 }}>
              {eyebrow}
            </Overline>
          ) : null}
          {title ? (
            <Text accessibilityRole="header" className="text-center font-display text-2xl font-extrabold tracking-tight text-foreground">
              {title}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className="gap-4">
        {tiles.map((item, i) => (
          <Card key={i} className="flex-row items-start gap-3">
            <View className="h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10">
              <IconByName name={item.icon} size={20} color={accent[500]} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-foreground">{item.title}</Text>
              <Text className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">{item.sub}</Text>
            </View>
          </Card>
        ))}
      </View>
    </View>
  )
}
