import { View } from 'react-native'
import { Text } from '../../ui'
import { useColorScheme } from 'nativewind'
import { IconByName } from './Benefits'
import { accent, primary, secondary } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/WhyUs.tsx.

const COPY = { eyebrow: 'Why us', title: 'Built for Industry' }

interface WhyUsItem {
  icon: string
  title: string
  desc: string
  color: string
}

const DEFAULT_ITEMS: WhyUsItem[] = [
  { icon: 'Zap', title: 'Fast Delivery', desc: 'Prompt dispatch and reliable delivery to your doorstep across India.', color: 'primary' },
  { icon: 'Boxes', title: 'Wide Range', desc: 'Fasteners, power tools, electrical, welding, and hundreds of industrial categories.', color: 'accent' },
  { icon: 'Clock', title: '24/7 Support', desc: 'Expert team always available to help you source the right product fast.', color: 'secondary' },
]

const ICON_BG = {
  primary: 'bg-primary-100 dark:bg-primary-900/30',
  accent: 'bg-accent-100 dark:bg-accent-900/30',
  secondary: 'bg-secondary-100 dark:bg-secondary-800/50',
}

export default function WhyUs({ section }: SectionProps) {
  const { colorScheme } = useColorScheme()
  const dark = colorScheme === 'dark'
  const items = section.items as WhyUsItem[] | null
  const tiles = items && items.length > 0 ? items : DEFAULT_ITEMS

  // text-{c}-600 dark:text-{c}-400
  const iconColor = (c: string) => {
    const scale = c === 'primary' ? primary : c === 'accent' ? accent : secondary
    return dark ? scale[400] : scale[600]
  }

  return (
    <View className="bg-surface-secondary px-4 py-12">
      <View className="mb-10 items-center">
        <Text className="mb-2 text-center text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
          {section.copy.eyebrow || COPY.eyebrow}
        </Text>
        <Text className="text-center text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
          {section.copy.title || COPY.title}
        </Text>
      </View>

      <View className="gap-4">
        {tiles.map(item => (
          <View key={item.title} className="relative overflow-hidden rounded-2xl border border-border-default bg-surface-elevated p-6">
            <View
              className={`mb-5 h-12 w-12 items-center justify-center rounded-xl ${
                item.color === 'primary' ? ICON_BG.primary : item.color === 'accent' ? ICON_BG.accent : ICON_BG.secondary
              }`}
            >
              <IconByName name={item.icon} size={24} color={iconColor(item.color)} />
            </View>
            <Text className="mb-2 text-lg font-black text-foreground">{item.title}</Text>
            <Text className="text-sm leading-relaxed text-foreground-secondary">{item.desc}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
