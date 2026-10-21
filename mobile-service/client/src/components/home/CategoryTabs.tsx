import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Svg, { Path } from 'react-native-svg'
import ProductCard from '../product/ProductCard'
import { Grid } from './layout'
import { openHref } from '../../lib/links'
import { accent } from '../../theme'
import type { CategoryTab, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CategoryTabs.tsx.
export default function CategoryTabs({ section, data }: SectionProps) {
  const router = useRouter()
  const [active, setActive] = useState(0)
  const tabs = (data.extras[section.id] as CategoryTab[] | undefined) ?? []
  if (tabs.length === 0) return null
  const current = tabs[Math.min(active, tabs.length - 1)]

  return (
    <View className="bg-surface px-4 py-12">
      <View className="mb-6 gap-4">
        <View>
          <Text className="mb-1 text-[10px] font-black uppercase text-accent-500" style={{ letterSpacing: 2 }}>
            {section.copy.eyebrow}
          </Text>
          <Text className="text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
            {section.copy.title}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -4 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingBottom: 4 }}
        >
          {tabs.map((tab, i) => {
            const selected = tab.id === current.id
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActive(i)}
                className={
                  selected
                    ? 'shrink-0 rounded-full border border-accent-500 bg-accent-500 px-4 py-2'
                    : 'shrink-0 rounded-full border border-border-default bg-surface-elevated px-4 py-2'
                }
              >
                <Text className={selected ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-foreground'}>
                  {tab.name}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      <Grid cols={2} gap={12}>
        {current.products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Grid>
      <View className="mt-7 items-center">
        <Pressable
          className="flex-row items-center gap-1"
          onPress={() => openHref(router, `/products?category=${encodeURIComponent(current.slug)}`)}
        >
          <Text className="text-sm font-semibold text-accent-500">View all {current.name}</Text>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path d="M9 5l7 7-7 7" stroke={accent[500]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
    </View>
  )
}
