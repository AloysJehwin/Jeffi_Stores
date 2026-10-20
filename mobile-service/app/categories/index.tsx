import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listCategories } from '../../src/api/categories'
import TopNav from '../../src/components/layout/TopNav'
import Spinner from '../../src/components/ui/Spinner'
import type { Category } from '../../src/types'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const CATEGORY_ICONS: Record<string, IoniconName> = {
  fasteners:                  'attach-outline',
  'power-transmission':       'settings-outline',
  'tools-equipment':          'build-outline',
  'tools-and-equipment':      'build-outline',
  'welding-supplies':         'flame-outline',
  'electrical-cables':        'flash-outline',
  'electrical-and-cables':    'flash-outline',
  'industrial-components':    'cog-outline',
  'material-handling':        'cube-outline',
  abrasives:                  'disc-outline',
  'safety-equipment':         'shield-checkmark-outline',
  'lubricants-chemicals':     'water-outline',
  'lubricants-and-chemicals': 'water-outline',
  'hand-tools':               'hammer-outline',
  'power-tools':              'battery-charging-outline',
  'measuring-tools':          'resize-outline',
  'cutting-tools':            'cut-outline',
  'drill-bits':               'aperture-outline',
  nuts:                       'ellipse-outline',
  bolts:                      'git-commit-outline',
  washers:                    'radio-button-off-outline',
  screws:                     'git-commit-outline',
  'threaded-rods':            'remove-outline',
  'v-belts':                  'repeat-outline',
  'timing-belts':             'repeat-outline',
  chains:                     'link-outline',
  couplings:                  'link-outline',
  bearings:                   'radio-button-on-outline',
  valves:                     'funnel-outline',
  default:                    'layers-outline',
}

function getCategoryIcon(slug: string): IoniconName {
  const key = slug.toLowerCase()
  if (CATEGORY_ICONS[key]) return CATEGORY_ICONS[key]
  for (const k of Object.keys(CATEGORY_ICONS)) {
    if (key.includes(k) || k.includes(key)) return CATEGORY_ICONS[k]
  }
  return CATEGORY_ICONS.default
}

const SUBCATEGORY_LIMIT = 4

export default function CategoriesScreen() {
  const router = useRouter()

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  })

  const allCategories: Category[] = data || []

  const parents = allCategories
    .filter((c) => c.parent_category_id === null)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999))

  const childrenByParentId: Record<string, Category[]> = {}
  allCategories
    .filter((c) => c.parent_category_id !== null)
    .forEach((c) => {
      const pid = c.parent_category_id!
      if (!childrenByParentId[pid]) childrenByParentId[pid] = []
      childrenByParentId[pid].push(c)
    })

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />

      {/* Header */}
      <View className="bg-white dark:bg-[#24252f] border-b border-gray-100 dark:border-[#3f4150] px-4 py-4">
        <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100" style={{ fontStyle: 'italic' }}>
          All Categories
        </Text>
        <Text className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Browse our complete range of product categories
        </Text>
      </View>

      {isLoading ? (
        <Spinner />
      ) : parents.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="layers-outline" size={64} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 text-lg font-bold mt-4">No categories found</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {parents.map((cat) => {
            const icon = getCategoryIcon(cat.slug)
            const subcats = childrenByParentId[cat.id] || []
            const visibleSubs = subcats.slice(0, SUBCATEGORY_LIMIT)
            const extraCount = subcats.length - SUBCATEGORY_LIMIT

            return (
              <TouchableOpacity
                key={cat.id}
                onPress={() => router.push(`/category/${cat.slug}` as any)}
                activeOpacity={0.85}
              >
                <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4">
                  <View className="flex-row items-center gap-4">
                    {/* Icon square — amber bg matching website */}
                    <View className="w-14 h-14 bg-amber-50 dark:bg-amber-900/20 rounded-xl items-center justify-center shrink-0">
                      <Ionicons name={icon} size={28} color="#f59e0b" />
                    </View>

                    {/* Name + subcategory chips */}
                    <View className="flex-1">
                      <Text className="font-bold text-gray-900 dark:text-gray-100 text-base leading-snug">
                        {cat.name}
                      </Text>

                      {subcats.length > 0 && (
                        <View className="flex-row flex-wrap gap-1.5 mt-2">
                          {visibleSubs.map((sub) => (
                            <View
                              key={sub.id}
                              className="bg-gray-100 dark:bg-[#2e303b] rounded-full px-2.5 py-0.5"
                            >
                              <Text className="text-xs text-gray-600 dark:text-gray-400">{sub.name}</Text>
                            </View>
                          ))}
                          {extraCount > 0 && (
                            <View className="bg-accent-50 dark:bg-accent-900/20 rounded-full px-2.5 py-0.5">
                              <Text className="text-xs text-accent-600 dark:text-accent-400 font-semibold">
                                +{extraCount} more
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                  </View>

                  <View className="mt-3 pt-3 border-t border-gray-100 dark:border-[#3f4150]">
                    <Text className="text-accent-600 dark:text-accent-400 text-sm font-semibold">
                      Browse Products →
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}
