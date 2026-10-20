import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listCategories } from '../../src/api/categories'
import { listProducts } from '../../src/api/products'
import TopNav from '../../src/components/layout/TopNav'
import ProductCard from '../../src/components/product/ProductCard'
import Spinner from '../../src/components/ui/Spinner'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const CATEGORY_ICONS: Record<string, IoniconName> = {
  fasteners:               'attach-outline',
  'power-transmission':    'settings-outline',
  'tools-equipment':       'build-outline',
  'tools-and-equipment':   'build-outline',
  'welding-supplies':      'flame-outline',
  'electrical-cables':     'flash-outline',
  'electrical-and-cables': 'flash-outline',
  'industrial-components': 'cog-outline',
  'material-handling':     'cube-outline',
  abrasives:               'disc-outline',
  'safety-equipment':      'shield-checkmark-outline',
  'lubricants-chemicals':  'water-outline',
  'lubricants-and-chemicals': 'water-outline',
  'hand-tools':            'hammer-outline',
  'power-tools':           'battery-charging-outline',
  'measuring-tools':       'resize-outline',
  'cutting-tools':         'cut-outline',
  'drill-bits':            'aperture-outline',
  nuts:                    'ellipse-outline',
  bolts:                   'git-commit-outline',
  washers:                 'radio-button-off-outline',
  screws:                  'git-commit-outline',
  chains:                  'link-outline',
  bearings:                'radio-button-on-outline',
  valves:                  'funnel-outline',
  default:                 'layers-outline',
}

function getCategoryIcon(slug: string): IoniconName {
  const key = slug.toLowerCase()
  if (CATEGORY_ICONS[key]) return CATEGORY_ICONS[key]
  for (const k of Object.keys(CATEGORY_ICONS)) {
    if (key.includes(k) || k.includes(key)) return CATEGORY_ICONS[k]
  }
  return CATEGORY_ICONS.default
}

const STATS = [
  { val: '500+', label: 'Products' },
  { val: '50+', label: 'Brands' },
  { val: '24/7', label: 'Support' },
]

const FEATURES = [
  { icon: 'flash-outline' as const, title: 'Fast Delivery', desc: 'Prompt dispatch and reliable delivery to your doorstep across India.' },
  { icon: 'cube-outline' as const, title: 'Wide Product Range', desc: 'Fasteners, power tools, electrical, welding, and hundreds of industrial categories.' },
  { icon: 'time-outline' as const, title: '24/7 Support', desc: 'Our expert team is always available to help you source the right product.' },
]

export default function HomeScreen() {
  const router = useRouter()

  const { data: categoriesData } = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const { data: featuredData, isLoading } = useQuery({
    queryKey: ['products', 'home'],
    queryFn: () => listProducts({ page: 1 }),
  })

  const allCategories = categoriesData || []
  const categories = allCategories
    .filter((c) => c.parent_category_id === null)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999))
  const featured = featuredData?.products?.slice(0, 6) || []

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Hero — amber gradient matching website */}
        <View style={{ backgroundColor: '#f59e0b' }} className="px-5 pt-8 pb-0">
            <View className="self-start bg-white/20 border border-white/30 rounded-full px-3 py-1 mb-4">
              <Text className="text-white text-[10px] font-bold uppercase tracking-widest">
                Hardware &amp; Industrial Tools
              </Text>
            </View>

            <Text
              className="text-white font-black leading-none mb-3"
              style={{ fontSize: 44, fontStyle: 'italic' }}
            >
              Jeffi{' '}
              <Text style={{ color: '#1a1b23', fontStyle: 'italic' }}>Stores</Text>
            </Text>

            <Text className="text-white/90 text-sm leading-relaxed mb-5 max-w-xs">
              Industrial machinery parts, tools, and hardware — for manufacturing, construction, and repairs.
            </Text>

            <View className="flex-row gap-3 mb-6">
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/products')}
                className="bg-secondary-500 px-6 py-3 rounded-xl"
              >
                <Text className="text-white font-bold">Shop Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/products')}
                className="bg-white/20 border border-white/40 px-6 py-3 rounded-xl"
              >
                <Text className="text-white font-semibold">Browse</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row items-center pt-4 pb-5 border-t border-white/30">
              {STATS.map((s, i) => (
                <View key={s.label} className="flex-row items-center">
                  <View className="mr-6">
                    <Text className="text-white font-black text-2xl leading-none">{s.val}</Text>
                    <Text className="text-white/70 text-xs font-medium mt-0.5">{s.label}</Text>
                  </View>
                  {i < STATS.length - 1 && <View className="w-px h-8 bg-white/30 mr-6" />}
                </View>
              ))}
            </View>

            {/* Welcome image sits at the bottom of the hero, cut off like the website */}
            <View className="items-center -mb-2">
              <Image
                source={{ uri: 'https://www.jeffistores.in/images/Welcome.png' }}
                style={{ width: 280, height: 200 }}
                contentFit="contain"
              />
            </View>
        </View>

        {/* Categories — 4-col grid matching website */}
        {categories.length > 0 && (
          <View className="mt-6 px-4">
            <View className="flex-row justify-between items-end mb-3">
              <View>
                <Text className="text-accent-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Browse</Text>
                <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Shop by Category</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/categories' as any)}>
                <Text className="text-accent-500 text-sm font-semibold flex-row items-center">View All →</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row flex-wrap gap-3">
              {categories.slice(0, 8).map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => router.push(`/category/${cat.slug}`)}
                  style={{ width: '22%' }}
                  className="items-center"
                >
                  <View className="w-full aspect-square bg-amber-50 dark:bg-amber-900/20 rounded-xl items-center justify-center mb-1.5 border border-amber-100 dark:border-amber-900/30">
                    <Ionicons name={getCategoryIcon(cat.slug)} size={26} color="#f59e0b" />
                  </View>
                  <Text
                    className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 text-center leading-tight"
                    numberOfLines={2}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Featured Products */}
        <View className="mt-8 px-4">
          <View className="flex-row justify-between items-end mb-4">
            <View>
              <Text className="text-accent-500 text-[10px] font-bold uppercase tracking-widest mb-0.5">Handpicked</Text>
              <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Featured Products</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/products')}>
              <Text className="text-accent-500 text-sm font-semibold">View All →</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <Spinner />
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {featured.map((product) => (
                <View key={product.id} style={{ width: '47.5%' }}>
                  <ProductCard product={product} />
                </View>
              ))}
            </View>
          )}

          {!isLoading && featured.length > 0 && (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/products')}
              className="mt-5 bg-primary-500 py-3.5 rounded-xl items-center flex-row justify-center gap-2"
            >
              <Text className="text-white font-bold">View All Products</Text>
              <Ionicons name="arrow-forward" size={16} color="white" />
            </TouchableOpacity>
          )}
        </View>

        {/* Built for Industry */}
        <View className="mt-10 px-4">
          <View className="items-center mb-5">
            <Text className="text-accent-500 text-[10px] font-bold uppercase tracking-widest mb-1">Why choose us</Text>
            <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">Built for Industry</Text>
          </View>
          <View className="gap-3">
            {FEATURES.map((f) => (
              <View
                key={f.title}
                className="flex-row items-start gap-4 bg-white dark:bg-[#24252f] rounded-xl border border-gray-100 dark:border-[#3f4150] p-4"
              >
                <View className="w-12 h-12 bg-primary-50 dark:bg-primary-900/20 rounded-xl items-center justify-center shrink-0">
                  <Ionicons name={f.icon} size={24} color="#f59e0b" />
                </View>
                <View className="flex-1 pt-0.5">
                  <Text className="font-bold text-gray-900 dark:text-gray-100 mb-1">{f.title}</Text>
                  <Text className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* About Us */}
        <View className="mt-10 mx-4 mb-8 bg-white dark:bg-[#24252f] rounded-2xl border border-gray-100 dark:border-[#3f4150] overflow-hidden">
          <Image
            source={{ uri: 'https://www.jeffistores.in/images/Working.png' }}
            style={{ width: '100%', height: 180 }}
            contentFit="cover"
          />
          <View className="p-5">
            <Text className="text-accent-500 text-[10px] font-bold uppercase tracking-widest mb-1">About Us</Text>
            <Text className="text-xl font-extrabold text-gray-900 dark:text-gray-100 mb-2 leading-snug">
              Your Trusted{'\n'}Hardware Partner
            </Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
              Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.
            </Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-5">
              We combine product breadth with expert service so your operations stay seamless and efficient.
            </Text>
            <View className="flex-row gap-3 mb-5">
              {[{ val: '10+', label: 'Years in Business' }, { val: '1000+', label: 'Happy Customers' }].map((s) => (
                <View key={s.label} className="flex-1 bg-gray-50 dark:bg-[#1a1b23] rounded-xl border border-gray-100 dark:border-[#3f4150] p-3">
                  <Text className="text-2xl font-black text-primary-500">{s.val}</Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity className="bg-primary-500 py-3 rounded-xl items-center flex-row justify-center gap-2">
              <Text className="text-white font-bold">Learn More About Us</Text>
              <Ionicons name="arrow-forward" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </View>
  )
}
