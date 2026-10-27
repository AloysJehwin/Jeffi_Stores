import { useCallback, useMemo } from 'react'
import { RefreshControl, View, type ListRenderItem } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'
import TopNav from '../../src/components/layout/TopNav'
import { FeedItemView, feedItems, type FeedItem } from '../../src/components/home/SectionRenderer'
import { HomeScrollContext } from '../../src/components/home/scroll-context'
import { BusinessHomeContext, businessHomeParams } from '../../src/components/home/business/useBusinessHome'
import { useBusiness } from '../../src/components/account/hooks'
import { useAuthStore } from '../../src/stores/authStore'
import { HomeSkeleton, Screen, setFeedScrolling, useBottomInset } from '../../src/ui'
import { getHome } from '../../src/api/home'
import { useTokens } from '../../src/theme'

const scrolling = () => setFeedScrolling(true)
const settled = () => setFeedScrolling(false)

// The storefront home: the admin-configured sections from GET /api/home, rendered like the web's page.
// An approved business gets the business homepage (the store's until one is published).
export default function HomeScreen() {
  const bottomInset = useBottomInset(0)
  const t = useTokens()
  const qc = useQueryClient()
  // A business waits for its session (approval picks the homepage), so it doesn't get the store's page first;
  // the store only waits for the saved portal, read from storage at launch.
  const authLoading = useAuthStore(s => s.isLoading && s.savedPortal !== 'customer')
  const audience = useBusiness().approved ? 'business' : 'store'
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home', audience],
    queryFn: () => getHome('home', audience),
    enabled: !authLoading,
    staleTime: 120_000,
  })
  // Shared with sections that animate as they scroll into view (ProductSpotlight).
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y
  })

  // A fling cut short by leaving the tab may never report its end.
  useFocusEffect(useCallback(() => settled, []))

  const items = useMemo(() => (data ? feedItems(data.sections, data.data) : []), [data])
  // The business sections share one fetch of the business's own data.
  const businessParams = useMemo(() => (data ? businessHomeParams(data.sections, data.data) : null), [data])
  const onRefresh = useCallback(() => {
    refetch()
    if (businessParams) qc.invalidateQueries({ queryKey: ['business-home'] })
  }, [refetch, qc, businessParams])
  const renderItem = useCallback<ListRenderItem<FeedItem>>(({ item }) => (data ? <FeedItemView item={item} data={data.data} /> : null), [data])

  // A failed load gets a retry and pull to refresh (Screen's scroll mode), with the generic connection message.
  if (!authLoading && !isLoading && (isError || !data)) {
    return <Screen header={<TopNav />} error onRetry={refetch} refreshing={isRefetching} onRefresh={refetch} />
  }

  return (
    <Screen header={<TopNav />} mode="none" loading={authLoading || isLoading} skeleton={<View className="flex-1 overflow-hidden"><HomeSkeleton /></View>}>
      {data ? (
        <HomeScrollContext.Provider value={scrollY}>
          <BusinessHomeContext.Provider value={businessParams}>
            {/* Windowed: sections, and the card grids a row of two at a time, mount as they near the screen. */}
            <Animated.FlatList
              data={items}
              keyExtractor={it => it.key}
              renderItem={renderItem}
              initialNumToRender={3}
              maxToRenderPerBatch={2}
              windowSize={9}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onScrollBeginDrag={scrolling}
              onScrollEndDrag={settled}
              onMomentumScrollBegin={scrolling}
              onMomentumScrollEnd={settled}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: bottomInset }}
              refreshControl={
                <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
              }
            />
          </BusinessHomeContext.Provider>
        </HomeScrollContext.Provider>
      ) : null}
    </Screen>
  )
}
