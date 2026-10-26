import { useCallback, useMemo } from 'react'
import { RefreshControl, View, type ListRenderItem } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useQuery } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'
import TopNav from '../../src/components/layout/TopNav'
import { FeedItemView, feedItems, type FeedItem } from '../../src/components/home/SectionRenderer'
import { HomeScrollContext } from '../../src/components/home/scroll-context'
import { HomeSkeleton, Screen, setFeedScrolling, useBottomInset } from '../../src/ui'
import { getHome } from '../../src/api/home'
import { useTokens } from '../../src/theme'

const scrolling = () => setFeedScrolling(true)
const settled = () => setFeedScrolling(false)

// The storefront home: the admin-configured sections from GET /api/home, rendered like the web's page.
export default function HomeScreen() {
  const bottomInset = useBottomInset(0)
  const t = useTokens()
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: getHome,
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
  const renderItem = useCallback<ListRenderItem<FeedItem>>(({ item }) => (data ? <FeedItemView item={item} data={data.data} /> : null), [data])

  // A failed load gets a retry and pull to refresh (Screen's scroll mode), with the generic connection message.
  if (!isLoading && (isError || !data)) {
    return <Screen header={<TopNav />} error onRetry={refetch} refreshing={isRefetching} onRefresh={refetch} />
  }

  return (
    <Screen header={<TopNav />} mode="none" loading={isLoading} skeleton={<View className="flex-1 overflow-hidden"><HomeSkeleton /></View>}>
      {data ? (
        <HomeScrollContext.Provider value={scrollY}>
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
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
            }
          />
        </HomeScrollContext.Provider>
      ) : null}
    </Screen>
  )
}
